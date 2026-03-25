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
import { EvaluationCycle } from '../../evaluations/entities/evaluation-cycle.entity';

@Entity('calibration_sessions')
@Index('idx_calib_tenant_cycle', ['tenantId', 'cycleId'])
export class CalibrationSession {
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

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 30, default: 'draft' })
  status: string; // draft | in_progress | completed

  @Column({ type: 'varchar', length: 100, nullable: true })
  department: string | null;

  @Column({ type: 'uuid', name: 'moderator_id' })
  moderatorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'moderator_id' })
  moderator: User;

  @Column({ type: 'int', name: 'min_quorum', default: 3, comment: 'Número mínimo de managers para completar la sesión' })
  minQuorum: number;

  @Column({ type: 'jsonb', name: 'expected_distribution', nullable: true, default: null, comment: 'Distribución esperada: { low: 10, midLow: 20, mid: 40, midHigh: 20, high: 10 }' })
  expectedDistribution: { low: number; midLow: number; mid: number; midHigh: number; high: number } | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
