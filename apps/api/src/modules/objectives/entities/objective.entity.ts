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

  @Column({ type: 'enum', enum: ObjectiveStatus, default: ObjectiveStatus.DRAFT })
  status: ObjectiveStatus;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0, comment: 'Peso relativo del objetivo (0-100%)' })
  weight: number;

  @Column({ type: 'uuid', name: 'parent_objective_id', nullable: true, comment: 'Objetivo padre para alineación jerárquica (cascading OKR)' })
  parentObjectiveId: string | null;

  @ManyToOne(() => Objective, (obj) => obj.children, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parent_objective_id' })
  parent: Objective;

  @OneToMany(() => Objective, (obj) => obj.parent)
  children: Objective[];

  @Column({ type: 'uuid', name: 'cycle_id', nullable: true })
  cycleId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
