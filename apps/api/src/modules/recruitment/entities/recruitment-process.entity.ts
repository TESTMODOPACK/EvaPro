import {
  Column, CreateDateColumn, UpdateDateColumn, Entity,
  PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

export enum ProcessType {
  EXTERNAL = 'external',
  INTERNAL = 'internal',
}

export enum ProcessStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CLOSED = 'closed',
}

@Entity('recruitment_processes')
@Index('idx_rp_tenant', ['tenantId'])
@Index('idx_rp_tenant_status', ['tenantId', 'status'])
export class RecruitmentProcess {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 20, name: 'process_type' })
  processType: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 100 })
  position: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  department: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', name: 'requirements', default: () => "'[]'" })
  requirements: Array<{ category: string; text: string }>;

  @Column({ type: 'boolean', name: 'require_cv_for_internal', default: false })
  requireCvForInternal: boolean;

  @Column({ type: 'enum', enum: ProcessStatus, default: ProcessStatus.DRAFT })
  status: ProcessStatus;

  @Column({ type: 'date', name: 'start_date', nullable: true })
  startDate: Date | null;

  @Column({ type: 'date', name: 'end_date', nullable: true })
  endDate: Date | null;

  @Column({ type: 'jsonb', name: 'scoring_weights', default: () => "'{\"history\": 40, \"interview\": 60}'" })
  scoringWeights: { history: number; interview: number };

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
