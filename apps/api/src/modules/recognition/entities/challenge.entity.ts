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

@Entity('challenges')
@Index('idx_challenge_tenant', ['tenantId'])
@Index('idx_challenge_active', ['tenantId', 'isActive'])
export class Challenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 50, comment: 'recognitions_sent | recognitions_received | total_points | feedback_given | objectives_completed' })
  criteriaType: string;

  @Column({ type: 'int', comment: 'Threshold to complete the challenge' })
  criteriaThreshold: number;

  @Column({ type: 'int', name: 'points_reward', default: 50, comment: 'Points awarded on completion' })
  pointsReward: number;

  @Column({ type: 'varchar', length: 50, name: 'badge_icon', default: 'target' })
  badgeIcon: string;

  @Column({ type: 'varchar', length: 20, name: 'badge_color', default: '#c9933a' })
  badgeColor: string;

  @Column({ type: 'date', name: 'start_date', nullable: true })
  startDate: Date | null;

  @Column({ type: 'date', name: 'end_date', nullable: true })
  endDate: Date | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
