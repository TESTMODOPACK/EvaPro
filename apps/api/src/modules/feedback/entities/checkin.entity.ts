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
  rejectedBy: string;

  @Column({ type: 'uuid', name: 'development_plan_id', nullable: true, comment: 'Plan de desarrollo vinculado a este check-in' })
  developmentPlanId: string | null;

  @ManyToOne(() => DevelopmentPlan, { nullable: true })
  @JoinColumn({ name: 'development_plan_id' })
  developmentPlan: DevelopmentPlan;

  @Column({ type: 'boolean', name: 'email_sent', default: false })
  emailSent: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
