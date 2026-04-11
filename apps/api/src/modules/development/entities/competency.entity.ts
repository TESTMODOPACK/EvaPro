import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

export enum CompetencyStatus {
  DRAFT = 'draft',
  PROPOSED = 'proposed',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('competencies')
@Index('idx_competency_tenant', ['tenantId'])
export class Competency {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 100 })
  category: string; // Tecnica | Blanda | Gestion | Liderazgo

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', nullable: true, name: 'expected_level' })
  expectedLevel: number | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  /** Timestamp of when this row was soft-deleted (isActive=false). Null while active. */
  @Column({ type: 'timestamptz', name: 'deactivated_at', nullable: true })
  deactivatedAt: Date | null;

  // ─── Workflow ────────────────────────────────────────────────────────

  @Column({ type: 'enum', enum: CompetencyStatus, default: CompetencyStatus.APPROVED })
  status: CompetencyStatus;

  @Column({ type: 'uuid', name: 'proposed_by', nullable: true })
  proposedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'proposed_by' })
  proposer: User;

  @Column({ type: 'uuid', name: 'reviewed_by', nullable: true })
  reviewedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer: User;

  @Column({ type: 'text', name: 'review_note', nullable: true })
  reviewNote: string | null;

  @Column({ type: 'timestamptz', name: 'reviewed_at', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
