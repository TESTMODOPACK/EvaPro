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

export enum CycleType {
  DEGREE_90 = '90',
  DEGREE_180 = '180',
  DEGREE_270 = '270',
  DEGREE_360 = '360',
}

export enum CycleStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  CLOSED = 'closed',
  CANCELLED = 'cancelled',
}

export enum CyclePeriod {
  QUARTERLY = 'quarterly',
  BIANNUAL = 'biannual',
  ANNUAL = 'annual',
  CUSTOM = 'custom',
}

@Entity('evaluation_cycles')
@Index('idx_cycles_tenant', ['tenantId'])
@Index('idx_cycles_tenant_status', ['tenantId', 'status'])
export class EvaluationCycle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({
    type: 'enum',
    enum: CycleType,
    default: CycleType.DEGREE_90,
  })
  type: CycleType;

  @Column({
    type: 'enum',
    enum: CycleStatus,
    default: CycleStatus.DRAFT,
  })
  status: CycleStatus;

  @Column({
    type: 'enum',
    enum: CyclePeriod,
    default: CyclePeriod.ANNUAL,
  })
  period: CyclePeriod;

  @Column({ type: 'date', name: 'start_date' })
  startDate: Date;

  @Column({ type: 'date', name: 'end_date' })
  endDate: Date;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'uuid', name: 'template_id', nullable: true })
  templateId: string;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @Column({ type: 'jsonb', default: {}, name: 'settings' })
  settings: any;

  @Column({ type: 'int', default: 0, name: 'total_evaluated' })
  totalEvaluated: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
