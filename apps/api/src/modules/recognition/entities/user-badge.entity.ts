import {
  Column, CreateDateColumn, Entity, PrimaryGeneratedColumn,
  Index, ManyToOne, JoinColumn, Unique,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { Badge } from './badge.entity';

/**
 * UserBadge: tracks which badges a user has earned and when.
 */
@Entity('user_badges')
@Index('idx_ub_tenant_user', ['tenantId', 'userId'])
@Unique('uq_user_badge', ['tenantId', 'userId', 'badgeId'])
export class UserBadge {
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

  @Column({ type: 'uuid', name: 'badge_id' })
  badgeId: string;

  @ManyToOne(() => Badge, { eager: true })
  @JoinColumn({ name: 'badge_id' })
  badge: Badge;

  /** Who awarded the badge (null = auto-awarded by system) */
  @Column({ type: 'uuid', name: 'awarded_by', nullable: true })
  awardedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'earned_at' })
  earnedAt: Date;
}
