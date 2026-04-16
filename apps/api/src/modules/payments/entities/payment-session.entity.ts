import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Invoice } from '../../subscriptions/entities/invoice.entity';
import { User } from '../../users/entities/user.entity';

export type PaymentProviderName = 'stripe' | 'mercadopago';
export type PaymentSessionStatus =
  | 'pending'    // just created, user has not completed checkout yet
  | 'paid'       // webhook confirmed payment — terminal success
  | 'failed'     // webhook confirmed failure — terminal failure
  | 'cancelled'  // user cancelled at provider — terminal
  | 'expired';   // provider session timed out — terminal

/**
 * Handshake record for a single attempt to pay an invoice via an external
 * payment provider (Stripe, MercadoPago, etc.).
 *
 * Purpose:
 *  1. **Idempotency** — the (provider, external_id) unique index prevents a
 *     retried webhook from double-billing or double-sending emails.
 *  2. **Reconciliation** — persists the amount/currency we actually charged,
 *     independent of the Invoice's original denomination (UF vs CLP).
 *  3. **Audit trail** — links the user who initiated the checkout and the
 *     metadata we sent to the provider for forensic debugging.
 */
@Entity('payment_sessions')
@Unique(['provider', 'externalId'])
@Index('idx_payment_sessions_tenant', ['tenantId'])
@Index('idx_payment_sessions_invoice', ['invoiceId'])
@Index('idx_payment_sessions_status', ['status'])
export class PaymentSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId: string;

  @ManyToOne(() => Invoice, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ type: 'uuid', name: 'initiated_by' })
  initiatedBy: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'initiated_by' })
  initiator: User | null;

  @Column({ type: 'varchar', length: 20 })
  provider: PaymentProviderName;

  /** Provider's own id for this checkout (Stripe CheckoutSession / MP Preference). Null until we call the provider. */
  @Column({ type: 'varchar', length: 255, name: 'external_id', nullable: true })
  externalId: string | null;

  /** URL the frontend redirects to so the user can complete payment. */
  @Column({ type: 'varchar', length: 1000, name: 'checkout_url', nullable: true })
  checkoutUrl: string | null;

  /** Amount in the currency actually charged (CLP/USD). May differ from invoice total when converting from UF. */
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 10 })
  currency: string;

  @Column({ type: 'varchar', length: 30, default: 'pending' })
  status: PaymentSessionStatus;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'failure_reason' })
  failureReason: string | null;

  /**
   * Flexible metadata bag:
   *  - `originalAmount`, `originalCurrency`, `conversionRate` when UF/USD → CLP conversion happened.
   *  - `webhookPayload` (truncated) for debugging failed events.
   *  - `invoiceNumber` snapshot so we can render emails without re-fetching.
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'completed_at' })
  completedAt: Date | null;
}
