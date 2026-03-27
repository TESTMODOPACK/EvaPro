import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';

export type SubscriptionRequestType = 'plan_change' | 'cancel';
export type SubscriptionRequestStatus = 'pending' | 'approved' | 'rejected';

@Entity('subscription_requests')
@Index('idx_sub_req_tenant', ['tenantId'])
@Index('idx_sub_req_status', ['status'])
export class SubscriptionRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'requested_by' })
  requestedBy: string;

  @Column({ type: 'varchar', length: 30 })
  type: SubscriptionRequestType;

  @Column({ type: 'varchar', length: 50, name: 'target_plan', nullable: true })
  targetPlan: string | null;

  @Column({ type: 'varchar', length: 30, name: 'target_billing_period', nullable: true })
  targetBillingPeriod: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: SubscriptionRequestStatus;

  @Column({ type: 'text', name: 'rejection_reason', nullable: true })
  rejectionReason: string | null;

  @Column({ type: 'uuid', name: 'processed_by', nullable: true })
  processedBy: string | null;

  @Column({ type: 'timestamptz', name: 'processed_at', nullable: true })
  processedAt: Date | null;

  /** Proration credit calculated at time of approval (informational, USD) */
  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'proration_credit', nullable: true })
  prorationCredit: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
