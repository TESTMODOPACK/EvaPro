import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { RedemptionItem } from './redemption-item.entity';

/** Valid states of a redemption transaction lifecycle. */
export enum RedemptionStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

export const REDEMPTION_STATUS_VALUES: readonly RedemptionStatus[] = Object.values(RedemptionStatus);

@Entity('redemption_transactions')
@Index('idx_rt_tenant_user', ['tenantId', 'userId'])
export class RedemptionTransaction {
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

  @Column({ type: 'uuid', name: 'item_id' })
  itemId: string;

  @ManyToOne(() => RedemptionItem)
  @JoinColumn({ name: 'item_id' })
  item: RedemptionItem;

  @Column({ type: 'int', name: 'points_spent' })
  pointsSpent: number;

  @Column({ type: 'enum', enum: RedemptionStatus, default: RedemptionStatus.PENDING })
  status: RedemptionStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
