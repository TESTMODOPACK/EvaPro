import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Custom KPI defined by each tenant.
 * These appear as configurable widgets on the reports/dashboard.
 *
 * Types:
 *  - cycle_completion: % of completed evaluations per cycle
 *  - avg_score: Average overall score per cycle
 *  - department_avg: Average score for a specific department
 *  - objective_completion: % of completed objectives
 *  - feedback_count: Total feedback given in period
 *  - custom_query: Raw SQL aggregation (super_admin only, future)
 */
export enum KpiType {
  CYCLE_COMPLETION = 'cycle_completion',
  AVG_SCORE = 'avg_score',
  DEPARTMENT_AVG = 'department_avg',
  OBJECTIVE_COMPLETION = 'objective_completion',
  FEEDBACK_COUNT = 'feedback_count',
  ACTIVE_USERS = 'active_users',
  AT_RISK_OBJECTIVES = 'at_risk_objectives',
}

@Entity('custom_kpis')
@Index('idx_custom_kpis_tenant', ['tenantId'])
export class CustomKpi {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'enum', enum: KpiType })
  type: KpiType;

  /** Optional config: department name, cycle type filter, etc. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  config: Record<string, any>;

  /** Display order on the dashboard (lower = first) */
  @Column({ type: 'int', default: 0, name: 'display_order' })
  displayOrder: number;

  /** Icon emoji or identifier */
  @Column({ type: 'varchar', length: 10, default: '' })
  icon: string;

  /** Target/goal value for the KPI (optional) */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  target: number | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
