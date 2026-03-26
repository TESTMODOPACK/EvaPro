import {
  Column, CreateDateColumn, Entity, PrimaryGeneratedColumn,
  Index, ManyToOne, JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

/**
 * Badge definition: achievement types that users can earn.
 * Examples: "Colaborador Estrella", "Innovador", "Mentor del Mes"
 */
@Entity('badges')
@Index('idx_badge_tenant', ['tenantId'])
export class Badge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Emoji or icon identifier (e.g., "star", "trophy", "rocket") */
  @Column({ type: 'varchar', length: 50, default: 'star' })
  icon: string;

  /** Color for the badge display */
  @Column({ type: 'varchar', length: 20, default: '#6366f1' })
  color: string;

  /** Auto-award criteria (JSON): { type: "recognitions_received", threshold: 10 } */
  @Column({ type: 'jsonb', nullable: true })
  criteria: any;

  /** Points awarded when badge is earned */
  @Column({ type: 'int', default: 50, name: 'points_reward' })
  pointsReward: number;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
