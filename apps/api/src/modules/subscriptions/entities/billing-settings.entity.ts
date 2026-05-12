import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryColumn,
} from 'typeorm';

/**
 * Fase 4 / Tarea 4.5 — Configuracion fiscal singleton del SaaS.
 *
 * Tabla SINGLE-ROW (PK fija = 'singleton') que guarda los datos del
 * emisor de facturas: RUT, razon social, direccion, prefijo de
 * numeracion, tasa IVA, dias de vencimiento, terminos legales.
 *
 * Pre-fix: estos datos estaban hardcoded en generatePdf
 * (`RUT: 77.XXX.XXX-X`, `Santiago, Chile`) y en generateInvoice
 * (`taxRate = 19`, `dueDate = +15 days`). Cualquier cambio
 * regulatorio requeria release de codigo.
 *
 * Reglas de negocio:
 *   - Solo super_admin puede editar.
 *   - Cambios SII-criticos (RUT emisor, IVA) -> audit log retention 6
 *     anos.
 *   - El primer arranque crea el row con defaults Chile (IVA 19%,
 *     prefijo EVA, due_days 15).
 */
@Entity('billing_settings')
export class BillingSettings {
  /** Constante. La tabla tiene exactamente UN row con id='singleton'. */
  @PrimaryColumn({ type: 'varchar', length: 20, default: 'singleton' })
  id: string;

  // ─── Datos del emisor ──────────────────────────────────────────────

  @Column({ type: 'varchar', length: 200, name: 'issuer_name', default: 'Ascenda Performance SpA' })
  issuerName: string;

  @Column({ type: 'varchar', length: 12, name: 'issuer_rut', default: '77.000.000-0' })
  issuerRut: string;

  @Column({ type: 'varchar', length: 300, name: 'issuer_address', default: 'Santiago, Chile' })
  issuerAddress: string;

  @Column({ type: 'varchar', length: 100, name: 'issuer_city', default: 'Santiago' })
  issuerCity: string;

  @Column({ type: 'varchar', length: 100, name: 'issuer_country', default: 'Chile' })
  issuerCountry: string;

  @Column({ type: 'varchar', length: 200, name: 'issuer_email', nullable: true })
  issuerEmail: string | null;

  @Column({ type: 'varchar', length: 50, name: 'issuer_phone', nullable: true })
  issuerPhone: string | null;

  // ─── Parametros de facturacion ─────────────────────────────────────

  /** Prefijo de numero de factura: EVA-YYYY-NNNN. */
  @Column({ type: 'varchar', length: 20, name: 'invoice_prefix', default: 'EVA' })
  invoicePrefix: string;

  /** Prefijo de nota de credito: EVA-NC-YYYY-NNNN. */
  @Column({ type: 'varchar', length: 20, name: 'credit_note_prefix', default: 'EVA-NC' })
  creditNotePrefix: string;

  /** Tasa IVA (%). Chile = 19. Si cambia, las invoices nuevas la usan. */
  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'tax_rate', default: 19 })
  taxRate: number;

  /** Dias de plazo para pago (dueDate = issueDate + N dias). */
  @Column({ type: 'int', name: 'due_days', default: 15 })
  dueDays: number;

  /** Moneda default para invoices. Hoy: UF. */
  @Column({ type: 'varchar', length: 10, name: 'default_currency', default: 'UF' })
  defaultCurrency: string;

  // ─── Terminos legales ──────────────────────────────────────────────

  /** Texto opcional al pie del PDF (terminos, instrucciones de pago). */
  @Column({ type: 'text', name: 'footer_note', nullable: true })
  footerNote: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
