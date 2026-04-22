import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { MeetingLocation } from './meeting-location.entity';
import { DevelopmentPlan } from '../../development/entities/development-plan.entity';

export enum CheckInStatus {
  REQUESTED = 'requested',
  SCHEDULED = 'scheduled',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected',
}

@Entity('checkins')
@Index('idx_checkins_manager', ['managerId'])
@Index('idx_checkins_employee', ['employeeId'])
export class CheckIn {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'manager_id' })
  managerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'manager_id' })
  manager: User;

  @Column({ type: 'uuid', name: 'employee_id' })
  employeeId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'employee_id' })
  employee: User;

  @Column({ type: 'date', name: 'scheduled_date' })
  scheduledDate: Date;

  @Column({ type: 'time', name: 'scheduled_time', nullable: true, comment: 'Hora de la reuni\u00f3n HH:mm' })
  scheduledTime: string;

  @Column({ type: 'uuid', name: 'location_id', nullable: true })
  locationId: string;

  @ManyToOne(() => MeetingLocation, { nullable: true })
  @JoinColumn({ name: 'location_id' })
  location: MeetingLocation;

  @Column({ type: 'varchar', length: 300 })
  topic: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'jsonb', name: 'action_items', default: [] })
  actionItems: {
    text: string;
    completed: boolean;
    assigneeId?: string;
    assigneeName?: string;
    dueDate?: string;
  }[];

  @Column({ type: 'jsonb', name: 'agenda_topics', default: [] })
  agendaTopics: {
    text: string;
    addedBy: string;
    addedByName?: string;
    addedAt?: string;
  }[];

  /**
   * v3.1 F1 — Agenda Mágica: snapshot pre-generado que se consume al abrir
   * la página de preparación del 1:1. Poblado on-demand vía
   * `FeedbackService.generateMagicAgenda()`. Shape estable — cualquier
   * cambio requiere bump de `generatorVersion` + migración de datos.
   *
   * `aiSuggestedTopics` queda `[]` si el tenant no tiene plan AI_INSIGHTS
   * (degradación graceful).
   */
  @Column({ type: 'jsonb', name: 'magic_agenda', nullable: true })
  magicAgenda: {
    pendingFromPrevious: Array<{
      text: string;
      addedByUserId: string;
      addedByName?: string;
      previousCheckinId: string;
    }>;
    okrSnapshot: Array<{
      objectiveId: string;
      title: string;
      progress: number;
      status: string;
      targetDate: string | null;
      daysToTarget: number | null;
    }>;
    recentFeedback: Array<{
      feedbackId: string;
      fromUserId: string;
      fromName?: string;
      sentiment: string;
      messagePreview: string;
      createdAt: string;
    }>;
    recentRecognitions: Array<{
      recognitionId: string;
      valueId: string | null;
      valueName?: string;
      messagePreview: string;
      createdAt: string;
    }>;
    aiSuggestedTopics: Array<{
      id: string;
      topic: string;
      rationale: string;
      priority: 'high' | 'med' | 'low';
      dismissed?: boolean;
    }>;
    generatedAt: string;
    generatorVersion: string;
  } | null;

  /**
   * v3.1 F1 — Snapshot de actionItems del 1:1 previo entre este manager
   * y este employee que quedaron `completed=false`. Se rellena al
   * completar el check-in previo; se lee al generar la agenda mágica.
   */
  @Column({ type: 'jsonb', name: 'carried_over_action_items', default: [] })
  carriedOverActionItems: Array<{
    text: string;
    assigneeName?: string;
    dueDate?: string | null;
    previousCheckinId: string;
    previousCheckinDate: string;
  }>;

  @Column({
    type: 'enum',
    enum: CheckInStatus,
    default: CheckInStatus.SCHEDULED,
  })
  status: CheckInStatus;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date;

  @Column({ type: 'text', name: 'rejection_reason', nullable: true })
  rejectionReason: string;

  @Column({ type: 'uuid', name: 'rejected_by', nullable: true })
  rejectedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'rejected_by' })
  rejectedByUser: User | null;

  @Column({ type: 'uuid', name: 'development_plan_id', nullable: true, comment: 'Plan de desarrollo vinculado a este check-in' })
  developmentPlanId: string | null;

  @ManyToOne(() => DevelopmentPlan, { nullable: true })
  @JoinColumn({ name: 'development_plan_id' })
  developmentPlan: DevelopmentPlan;

  @Column({ type: 'text', nullable: true, comment: 'Minuta formal de la reunión (editable post-completar)' })
  minutes: string | null;

  @Column({ type: 'smallint', nullable: true, comment: 'Valoración del check-in 1-5 (1=poco productivo, 5=muy productivo)' })
  rating: number | null;

  @Column({ type: 'boolean', name: 'email_sent', default: false })
  emailSent: boolean;

  /**
   * v3.1 — true si el check-in fue auto-completado por el cron
   * `autoCompleteStaleCheckIns` (>5 días desde scheduledDate sin cierre
   * manual). Permite a la UI mostrar badge "Cerrado automáticamente" y
   * al manager agregar info retroactiva vía PATCH /retroactive-info.
   */
  @Column({ type: 'boolean', name: 'auto_completed', default: false })
  autoCompleted: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
