import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  OneToMany, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { MeetingLocation } from '../../feedback/entities/meeting-location.entity';
import { TeamMeetingParticipant } from './team-meeting-participant.entity';

/**
 * v3.1 Tema B — Reuniones de equipo (N participantes).
 *
 * Entidad paralela a `CheckIn` (que queda como 1:1 puro). Comparte el
 * catálogo de `meeting_locations` para no duplicar infra.
 *
 * Diferencias clave con CheckIn:
 *   - `organizerId` (no `managerId`): quien convoca puede ser admin o
 *     manager, no necesariamente el jefe de los participantes.
 *   - Participantes en tabla pivote `team_meeting_participants` con
 *     estado de invitación (invited/accepted/declined/attended).
 *   - No tiene flujo de "requested" (employee no puede convocar
 *     reuniones de equipo — eso sigue siendo un 1:1).
 *   - Sin integración con AI_INSIGHTS por ahora (deferido — la prompt
 *     actual es 1:1).
 */
export enum TeamMeetingStatus {
  SCHEDULED = 'scheduled',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Entity('team_meetings')
@Index('idx_tm_tenant', ['tenantId'])
@Index('idx_tm_organizer', ['organizerId'])
@Index('idx_tm_tenant_status', ['tenantId', 'status'])
export class TeamMeeting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'organizer_id' })
  organizerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'organizer_id' })
  organizer: User;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'date', name: 'scheduled_date' })
  scheduledDate: Date;

  @Column({
    type: 'time',
    name: 'scheduled_time',
    nullable: true,
    comment: 'Hora HH:mm de la reunión',
  })
  scheduledTime: string | null;

  @Column({ type: 'uuid', name: 'location_id', nullable: true })
  locationId: string | null;

  @ManyToOne(() => MeetingLocation, { nullable: true })
  @JoinColumn({ name: 'location_id' })
  location: MeetingLocation | null;

  @Column({
    type: 'enum',
    enum: TeamMeetingStatus,
    default: TeamMeetingStatus.SCHEDULED,
  })
  status: TeamMeetingStatus;

  /** Temas propuestos por los participantes antes de la reunión. */
  @Column({ type: 'jsonb', name: 'agenda_topics', default: () => "'[]'" })
  agendaTopics: Array<{
    text: string;
    addedBy: string;
    addedByName?: string;
    addedAt?: string;
  }>;

  /** Acuerdos / compromisos — se ingresan al completar. */
  @Column({ type: 'jsonb', name: 'action_items', default: () => "'[]'" })
  actionItems: Array<{
    text: string;
    completed: boolean;
    assigneeId?: string;
    assigneeName?: string;
    dueDate?: string;
  }>;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({
    type: 'text',
    nullable: true,
    comment: 'Minuta formal post-reunión',
  })
  minutes: string | null;

  @Column({
    type: 'smallint',
    nullable: true,
    comment: 'Valoración 1-5 del organizador (opcional)',
  })
  rating: number | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'cancelled_at', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'text', name: 'cancel_reason', nullable: true })
  cancelReason: string | null;

  @Column({ type: 'boolean', name: 'email_sent', default: false })
  emailSent: boolean;

  /**
   * v3.1 — true si la reunión fue auto-completada por el cron
   * `autoCompleteStaleMeetings`. Mismo patrón que `CheckIn.autoCompleted`.
   */
  @Column({ type: 'boolean', name: 'auto_completed', default: false })
  autoCompleted: boolean;

  @OneToMany(() => TeamMeetingParticipant, (p) => p.meeting, { cascade: false })
  participants: TeamMeetingParticipant[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
