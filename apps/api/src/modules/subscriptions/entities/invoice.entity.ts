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
}

@Entity('invoices')
@Index('idx_invoice_tenant', ['tenantId'])
@Index('idx_invoice_status', ['status'])
@Index('idx_invoice_number', ['invoiceNumber'], { unique: true })
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

  @Column({ type: 'varchar', length: 30, name: 'invoice_number', unique: true })
  invoiceNumber: string;

  @Column({ type: 'varchar', length: 20, default: InvoiceType.INVOICE })
  type: InvoiceType;

  @Column({ type: 'varchar', length: 20, default: InvoiceStatus.DRAFT })
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

  @OneToMany(() => InvoiceLine, (line) => line.invoice, { cascade: true, eager: true })
  lines: InvoiceLine[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
