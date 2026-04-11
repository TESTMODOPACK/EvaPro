import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { bigintNumberTransformer } from '../../../common/transformers/bigint-number.transformer';

/**
 * Denormalized per-user running totals of points, kept in sync by the
 * recognition service after every ledger write.
 *
 * Why this exists:
 *   The source of truth for points is the append-only `user_points` ledger.
 *   Leaderboards and balance checks were running `SELECT SUM(points)` queries
 *   per user — fine at current scale but O(ledger size) on every read. At
 *   10k+ users and 100k+ transactions the SUM becomes a hot spot.
 *
 *   This summary table stores three rolling totals — all-time, current
 *   calendar month, current calendar year — so the common leaderboard
 *   queries become `ORDER BY totalPoints LIMIT N` with a single scan.
 *
 * Sync contract:
 *   - Every call to `addPoints` / point deduction / refund must call
 *     `refreshPointsSummary(tenantId, userId)` in the same logical unit of
 *     work. The refresh recomputes from the ledger (idempotent).
 *   - `resetPeriodicBuckets` (monthly cron) zeroes `monthPoints` / `yearPoints`
 *     at period rollover without touching `totalPoints`.
 */
@Entity('user_points_summary')
@Unique('uq_user_points_summary', ['tenantId', 'userId'])
@Index('idx_user_points_summary_tenant', ['tenantId'])
@Index('idx_user_points_summary_total', ['tenantId', 'totalPoints'])
export class UserPointsSummary {
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

  /**
   * Lifetime total. Can be negative after redemptions. Stored as bigint
   * since this is a cumulative aggregate of the entire ledger; the
   * transformer returns a plain `number` for callers (safe to 2^53 − 1).
   */
  @Column({ type: 'bigint', name: 'total_points', default: 0, transformer: bigintNumberTransformer })
  totalPoints: number;

  /** Rolling window: current calendar month only. */
  @Column({ type: 'bigint', name: 'month_points', default: 0, transformer: bigintNumberTransformer })
  monthPoints: number;

  /** Rolling window: current calendar year only. */
  @Column({ type: 'bigint', name: 'year_points', default: 0, transformer: bigintNumberTransformer })
  yearPoints: number;

  /** ISO timestamp of the last `refresh` invocation. */
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
