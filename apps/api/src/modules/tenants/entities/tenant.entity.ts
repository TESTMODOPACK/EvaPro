import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, Index } from 'typeorm';
import type { TenantSettings } from '../../../common/types/jsonb-schemas';

@Entity('tenants')
@Unique(['slug'])
@Index('idx_tenant_plan', ['plan'])
@Index('idx_tenant_active', ['isActive'])
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 100 })
  slug: string;

  @Column({ type: 'varchar', length: 12, unique: true, nullable: true })
  rut: string | null;

  @Column({ type: 'varchar', length: 50, default: 'starter' })
  plan: string;

  @Column({ type: 'varchar', length: 20, name: 'owner_type' })
  ownerType: string; // 'company' | 'consultant'

  @Column({ type: 'int', default: 50, name: 'max_employees' })
  maxEmployees: number;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  industry: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'employee_range' })
  employeeRange: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true, name: 'commercial_address' })
  commercialAddress: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true, name: 'legal_rep_name', comment: 'Nombre completo del representante legal' })
  legalRepName: string | null;

  @Column({ type: 'varchar', length: 12, nullable: true, name: 'legal_rep_rut', comment: 'RUT del representante legal' })
  legalRepRut: string | null;

  /**
   * Fase 3 / Tarea 3.3 — Email separado al que se envian facturas y
   * recordatorios de cobranza. Si null, fallback al email del
   * tenant_admin activo (comportamiento previo). Util cuando el
   * tenant_admin (que opera el dashboard dia a dia) no es la misma
   * persona que recibe la facturacion (CFO, contabilidad).
   */
  @Column({ type: 'varchar', length: 200, nullable: true, name: 'billing_email' })
  billingEmail: string | null;

  /**
   * Fase 3 / Tarea 3.4 — Stripe Customer id (`cus_...`) creado on-demand
   * la primera vez que el tenant agrega un metodo de pago. Stripe agrupa
   * los payment_methods bajo este customer. Null hasta primera card.
   */
  @Column({ type: 'varchar', length: 100, nullable: true, name: 'stripe_customer_id' })
  stripeCustomerId: string | null;

  /**
   * Post-fix EVA-2026-0004 (Opcion B) — Plazo de pago NEGOCIADO con este
   * tenant en particular (override del default global
   * billing_settings.dueDays).
   *
   * Casos de uso:
   *   - Empresa pequena: contado (0 dias).
   *   - SMB normal: 15 dias (default global).
   *   - Enterprise/corporativo: 30, 60 o 90 dias (terminos comerciales
   *     negociados al cierre del contrato).
   *
   * Semantica:
   *   - NULL = usar el dueDays global de billing_settings (default 15).
   *   - 0..90 = sobreescribir el global para este tenant.
   *
   * Solo super_admin puede editar (es un termino comercial del contrato,
   * no algo que la empresa cliente decide por si sola). tenant_admin
   * puede leer.
   *
   * Aplica SOLO a facturas NUEVAS — facturas ya emitidas conservan su
   * dueDate persistido en `invoices.due_date`. Cambiar este valor no
   * reescribe historico.
   */
  @Column({ type: 'int', nullable: true, name: 'due_days_override' })
  dueDaysOverride: number | null;

  @Column({ type: 'jsonb', default: {} })
  settings: TenantSettings;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
