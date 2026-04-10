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
import { SubscriptionPlan } from './subscription-plan.entity';
import { BillingPeriod } from './payment-history.entity';

/** Valid lifecycle states for a tenant subscription. */
export enum SubscriptionStatus {
  ACTIVE = 'active',
  TRIAL = 'trial',
  SUSPENDED = 'suspended',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export const SUBSCRIPTION_STATUS_VALUES: readonly SubscriptionStatus[] = Object.values(SubscriptionStatus);

@Entity('subscriptions')
@Index('idx_sub_tenant', ['tenantId'])
@Index('idx_sub_tenant_status', ['tenantId', 'status'])
@Index('idx_sub_status', ['status'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'plan_id' })
  planId: string;

  @ManyToOne(() => SubscriptionPlan)
  @JoinColumn({ name: 'plan_id' })
  plan: SubscriptionPlan;

  // Stored as varchar to preserve the existing production schema. The
  // SubscriptionStatus TS enum constrains writes at the service layer.
  @Column({ type: 'varchar', length: 30, default: SubscriptionStatus.ACTIVE })
  status: SubscriptionStatus;

  @Column({ type: 'date', name: 'start_date' })
  startDate: Date;

  @Column({ type: 'date', name: 'end_date', nullable: true })
  endDate: Date | null;

  @Column({ type: 'date', name: 'trial_ends_at', nullable: true })
  trialEndsAt: Date | null;

  @Column({ type: 'varchar', length: 20, name: 'billing_period', default: BillingPeriod.MONTHLY })
  billingPeriod: BillingPeriod;

  @Column({ type: 'date', name: 'next_billing_date', nullable: true })
  nextBillingDate: Date | null;

  @Column({ type: 'boolean', name: 'auto_renew', default: true })
  autoRenew: boolean;

  @Column({ type: 'date', name: 'last_payment_date', nullable: true })
  lastPaymentDate: Date | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'last_payment_amount', nullable: true })
  lastPaymentAmount: number | null;

  @Column({ type: 'int', name: 'ai_addon_calls', default: 0, comment: 'Additional AI calls purchased as add-on (on top of plan limit)' })
  aiAddonCalls: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'ai_addon_price', default: 0, comment: 'Monthly price in plan currency for the AI add-on' })
  aiAddonPrice: number;

  @Column({ type: 'int', name: 'ai_addon_used', default: 0, comment: 'Cumulative addon credits consumed (persists across periods, never resets)' })
  aiAddonUsed: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
