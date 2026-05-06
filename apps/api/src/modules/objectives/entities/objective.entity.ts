import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  OneToMany,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

export enum ObjectiveType {
  OKR = 'OKR',
  KPI = 'KPI',
  SMART = 'SMART',
}

export enum ObjectiveStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
  // T6 (Audit P1): vencido por fecha. Marcado por cron diario cuando
  // status=ACTIVE && targetDate < today. Es estado intermedio (no terminal):
  // si el owner extiende targetDate, vuelve a ACTIVE; si lo completa, a
  // COMPLETED; si lo abandona, a ABANDONED. NO se cuenta como completado
  // en el avg-progress, pero sí queda visible y filtrable como "vencido".
  OVERDUE = 'overdue',
  // T7 (Audit P1): cancelado por decisión de negocio (cambio de estrategia,
  // re-organización, scope-change). Reemplaza el uso anterior de ABANDONED
  // como cubo semántico. Tiene cancellationReason / cancelledBy /
  // cancelledAt obligatorios para trazabilidad.
  // ABANDONED queda reservado para soft-delete técnico admin.
  CANCELLED = 'cancelled',
}

@Entity('objectives')
@Index('idx_objectives_user', ['userId'])
@Index('idx_objectives_tenant', ['tenantId'])
export class Objective {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'enum', enum: ObjectiveType, default: ObjectiveType.OKR })
  type: ObjectiveType;

  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column({ type: 'date', name: 'target_date', nullable: true })
  targetDate: Date;

  @Column({
    type: 'enum',
    enum: ObjectiveStatus,
    default: ObjectiveStatus.DRAFT,
  })
  status: ObjectiveStatus;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
    comment: 'Peso relativo del objetivo (0-100%)',
  })
  weight: number;

  @Column({
    type: 'uuid',
    name: 'parent_objective_id',
    nullable: true,
    comment: 'Objetivo padre para alineación jerárquica (cascading OKR)',
  })
  parentObjectiveId: string | null;

  @ManyToOne(() => Objective, (obj) => obj.children, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parent_objective_id' })
  parent: Objective;

  @OneToMany(() => Objective, (obj) => obj.parent)
  children: Objective[];

  @Column({ type: 'uuid', name: 'cycle_id', nullable: true })
  cycleId: string;

  @Column({ type: 'text', name: 'rejection_reason', nullable: true })
  rejectionReason: string | null;

  // T7 (Audit P1): trazabilidad de cancelación por negocio. NULL si el
  // objetivo no fue cancelado vía POST /:id/cancel. Si status=CANCELLED,
  // todos estos campos están seteados.
  @Column({ type: 'text', name: 'cancellation_reason', nullable: true })
  cancellationReason: string | null;

  @Column({ type: 'uuid', name: 'cancelled_by', nullable: true })
  cancelledBy: string | null;

  @Column({ type: 'timestamptz', name: 'cancelled_at', nullable: true })
  cancelledAt: Date | null;

  // T11 (Audit P2): linaje de carry-over entre ciclos. Cuando un objetivo
  // se "lleva" al próximo ciclo (continuación de un OKR multi-período),
  // el nuevo objetivo apunta al original via este campo. Diferente de
  // parentObjectiveId (que es cascading OKR jerárquico).
  @Column({ type: 'uuid', name: 'carried_from_objective_id', nullable: true })
  carriedFromObjectiveId: string | null;

  @Column({ type: 'uuid', name: 'approved_by', nullable: true })
  approvedBy: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_by' })
  approver: User | null;

  @Column({ type: 'timestamptz', name: 'approved_at', nullable: true })
  approvedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  // Progress history and key results (eager: false, loaded via explicit relations)
  @OneToMany('ObjectiveUpdate', 'objective')
  updates: any[];

  @OneToMany('KeyResult', 'objective')
  keyResults: any[];
}
