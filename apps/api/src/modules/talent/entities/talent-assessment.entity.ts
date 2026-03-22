import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { EvaluationCycle } from '../../evaluations/entities/evaluation-cycle.entity';

@Entity('talent_assessments')
@Index('idx_talent_tenant_cycle', ['tenantId', 'cycleId'])
@Unique(['tenantId', 'cycleId', 'userId'])
export class TalentAssessment {
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

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'performance_score', default: 0 })
  performanceScore: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'potential_score', nullable: true })
  potentialScore: number | null;

  @Column({ type: 'int', name: 'nine_box_position', nullable: true })
  nineBoxPosition: number | null; // 1-9

  @Column({ type: 'varchar', length: 50, name: 'talent_pool', nullable: true })
  talentPool: string | null;
  // star | high_performer | core_player | inconsistent | developing | risk | underperformer | enigma | dysfunctional

  @Column({ type: 'varchar', length: 30, nullable: true })
  readiness: string | null; // ready_now | ready_1_year | ready_2_years | not_ready

  @Column({ type: 'varchar', length: 20, name: 'flight_risk', nullable: true })
  flightRisk: string | null; // high | medium | low

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'uuid', name: 'assessed_by', nullable: true })
  assessedBy: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'assessed_by' })
  assessor: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
