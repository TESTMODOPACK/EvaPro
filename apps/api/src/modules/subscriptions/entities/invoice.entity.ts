import {
  Column, CreateDateColumn, UpdateDateColumn, Entity, PrimaryGeneratedColumn,
  ManyToOne, JoinColumn, OneToMany, Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Subscription } from './subscription.entity';
import { InvoiceLine } from './invoice-line.entity';

export enum InvoiceType {
  INVOICE = 'invoice',
  CREDIT_NOTE = 'credit_note',
}

export enum InvoiceStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  PAID = 'paid',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
  // Fase 2 / Tarea 2.1 — Status terminal exclusivo de credit notes ya
  // aplicadas como descuento en otra invoice. Permite que el motor de
  // aplicacion automatica (T2.4.2 generateInvoice) sepa cuales credit
  // notes estan disponibles (status='sent') vs ya gastadas ('applied').
  APPLIED = 'applied',
}

@Entity('invoices')
@Index('idx_invoice_tenant', ['tenantId'])
@Index('idx_invoice_status', ['status'])
@Index('idx_invoice_number_tenant', ['tenantId', 'invoiceNumber'], { unique: true })
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'subscription_id' })
  subscriptionId: string;

  @ManyToOne(() => Subscription)
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  @Column({ type: 'varchar', length: 30, name: 'invoice_number' })
  invoiceNumber: string;

  @Column({ type: 'enum', enum: InvoiceType, default: InvoiceType.INVOICE })
  type: InvoiceType;

  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.DRAFT })
  status: InvoiceStatus;

  @Column({ type: 'date', name: 'issue_date' })
  issueDate: Date;

  @Column({ type: 'date', name: 'due_date' })
  dueDate: Date;

  @Column({ type: 'date', name: 'period_start' })
  periodStart: Date;

  @Column({ type: 'date', name: 'period_end' })
  periodEnd: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'tax_rate', default: 19, comment: 'IVA % (default 19% Chile)' })
  taxRate: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'tax_amount', default: 0 })
  taxAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  total: number;

  @Column({ type: 'varchar', length: 10, default: 'UF' })
  currency: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamptz', name: 'sent_at', nullable: true })
  sentAt: Date | null;

  /**
   * Fase 2 / Tarea 2.1 — Solo poblado para credit notes (`type='credit_note'`).
   * Apunta a la factura origen que la credit note revierte total o
   * parcialmente. Nullable para credit notes "ajuste comercial" sin
   * invoice especifica de referencia (caso raro).
   */
  @Column({ type: 'uuid', name: 'original_invoice_id', nullable: true })
  originalInvoiceId: string | null;

  @ManyToOne(() => Invoice, { nullable: true })
  @JoinColumn({ name: 'original_invoice_id' })
  originalInvoice: Invoice | null;

  /**
   * Fase 2 / Tarea 2.1 — Solo poblado cuando esta credit note ya fue
   * aplicada (status='applied'). Apunta a la invoice donde se consumio
   * el credito como linea negativa. Permite trazabilidad bidireccional:
   *   credit_note.applied_to_invoice_id -> invoice que recibio descuento
   *   invoice.lines[].metadata.creditNoteId -> credit notes aplicadas
   */
  @Column({ type: 'uuid', name: 'applied_to_invoice_id', nullable: true })
  appliedToInvoiceId: string | null;

  @Column({ type: 'timestamptz', name: 'applied_at', nullable: true })
  appliedAt: Date | null;

  @OneToMany(() => InvoiceLine, (line) => line.invoice, { cascade: true, eager: true })
  lines: InvoiceLine[];

  /**
   * Dunning state for this invoice. Populated by `processDunning()` as it
   * escalates through stages (3/7/14/30/37 days past due). Dedupes emails:
   * if `stage >= targetStage`, the cron skips it on subsequent runs.
   *
   * Shape: `{ stage?: 3|7|14|30|37, lastEmailAt?: ISO-8601 }`.
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  dunning: { stage?: number; lastEmailAt?: string };

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
