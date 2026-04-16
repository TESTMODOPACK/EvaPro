import {
  Column, CreateDateColumn, Entity, PrimaryGeneratedColumn,
  Index, ManyToOne, JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { bigintNumberTransformer } from '../../../common/transformers/bigint-number.transformer';

export enum PointsSource {
  RECOGNITION_SENT = 'recognition_sent',
  RECOGNITION_RECEIVED = 'recognition_received',
  BADGE_EARNED = 'badge_earned',
  EVALUATION_COMPLETED = 'evaluation_completed',
  OBJECTIVE_COMPLETED = 'objective_completed',
  CHECKIN_COMPLETED = 'checkin_completed',
  FEEDBACK_GIVEN = 'feedback_given',
  CHALLENGE_COMPLETED = 'challenge_completed',
  /** Gamificación PDI: puntos al completar una acción de desarrollo. */
  PDI_ACTION_COMPLETED = 'pdi_action_completed',
  /** Gamificación PDI: puntos al completar un plan de desarrollo entero. */
  PDI_PLAN_COMPLETED = 'pdi_plan_completed',
  MANUAL = 'manual',
}

/**
 * UserPoints: ledger of all point transactions for gamification.
 * Balance = SUM(points) per user.
 */
@Entity('user_points')
@Index('idx_up_tenant_user', ['tenantId', 'userId'])
@Index('idx_up_created', ['tenantId', 'createdAt'])
@Index('idx_up_tenant_source', ['tenantId', 'source'])
export class UserPoints {
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

  // Individual ledger entries are small (± a few thousand), but the column
  // type is bigint so that SUM() aggregates can grow without int32 overflow.
  // The transformer keeps JS reads as `number` within the safe-integer range.
  @Column({ type: 'bigint', transformer: bigintNumberTransformer })
  points: number;

  @Column({ type: 'enum', enum: PointsSource })
  source: PointsSource;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  /** Reference to the entity that generated the points */
  @Column({ type: 'uuid', name: 'reference_id', nullable: true })
  referenceId: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
