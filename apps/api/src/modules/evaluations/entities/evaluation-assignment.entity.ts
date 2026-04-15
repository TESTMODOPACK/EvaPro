import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { EvaluationCycle } from './evaluation-cycle.entity';
import { User } from '../../users/entities/user.entity';

export enum RelationType {
  SELF = 'self',
  MANAGER = 'manager',
  PEER = 'peer',
  DIRECT_REPORT = 'direct_report',
  EXTERNAL = 'external',
}

export enum AssignmentStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  /** Cancelada automáticamente por cascade de desvinculación (Stage B) o
   *  por acción administrativa. El metadata del audit log registra la razón. */
  CANCELLED = 'cancelled',
}

@Entity('evaluation_assignments')
@Unique('uq_assignment', ['cycleId', 'evaluateeId', 'evaluatorId', 'relationType'])
@Index('idx_assignments_cycle', ['cycleId'])
@Index('idx_assignments_evaluatee', ['evaluateeId'])
@Index('idx_assignments_evaluator', ['evaluatorId'])
@Index('idx_assignments_tenant_status', ['tenantId', 'status'])
export class EvaluationAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'cycle_id' })
  cycleId: string;

  @ManyToOne(() => EvaluationCycle)
  @JoinColumn({ name: 'cycle_id' })
  cycle: EvaluationCycle;

  @Column({ type: 'uuid', name: 'evaluatee_id' })
  evaluateeId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'evaluatee_id' })
  evaluatee: User;

  @Column({ type: 'uuid', name: 'evaluator_id' })
  evaluatorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'evaluator_id' })
  evaluator: User;

  @Column({
    type: 'enum',
    enum: RelationType,
    name: 'relation_type',
  })
  relationType: RelationType;

  @Column({
    type: 'enum',
    enum: AssignmentStatus,
    default: AssignmentStatus.PENDING,
  })
  status: AssignmentStatus;

  @Column({ type: 'date', name: 'due_date', nullable: true })
  dueDate: Date;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date;

  @Column({ type: 'int', name: 'reminder_count', default: 0 })
  reminderCount: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
