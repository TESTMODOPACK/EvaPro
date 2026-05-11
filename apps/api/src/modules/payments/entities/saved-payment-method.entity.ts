import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

/**
 * Fase 3 / Tarea 3.4 — Metodo de pago guardado por un tenant para uso
 * en cobros futuros (off-session retries, renovaciones automaticas).
 *
 * Reglas de seguridad:
 *   - NUNCA almacenar PAN, CVV ni datos sensibles. Solo metadata:
 *     ultimos 4 digitos, marca, expiracion, y el `providerPaymentMethodId`
 *     opaco que el provider acepta para cobrar.
 *   - Aislamiento: cada metodo pertenece a UN tenant. UNIQUE
 *     (tenantId, provider, providerPaymentMethodId) previene duplicados.
 *   - Default flag: exactamente UN metodo `isDefault=true` por tenant
 *     (enforce via service, no constraint DB porque PG no soporta
 *     filtered unique sin migration de partial index).
 *
 * Lifecycle:
 *   - DRAFT (recien creado, awaiting SetupIntent webhook): estado
 *     transitorio. Si el webhook no llega en 24h, se purga.
 *   - ACTIVE: confirmado por webhook setup_intent.succeeded, listo para
 *     cobrar.
 *   - REVOKED: tenant lo borro, o provider notifico baja (card_revoked,
 *     etc.). No se purga para retencion contable; solo se filtra de
 *     lookups activos.
 */
export type SavedPaymentMethodStatus = 'draft' | 'active' | 'revoked';

@Entity('saved_payment_methods')
@Unique(['tenantId', 'provider', 'providerPaymentMethodId'])
@Index('idx_spm_tenant', ['tenantId'])
@Index('idx_spm_tenant_default', ['tenantId', 'isDefault'])
@Index('idx_spm_status', ['status'])
export class SavedPaymentMethod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /** Stripe id of the customer (cus_...). Stripe agrupa todos los
   *  payment_methods de este tenant bajo este customer. MP usa otro
   *  modelo y solo se setea cuando aplica. */
  @Column({ type: 'varchar', length: 100, name: 'provider_customer_id', nullable: true })
  providerCustomerId: string | null;

  /** Stripe payment_method id (pm_...). Opaco; pasamos al provider en
   *  cada cobro y nunca tocamos la card real. */
  @Column({ type: 'varchar', length: 100, name: 'provider_payment_method_id' })
  providerPaymentMethodId: string;

  @Column({ type: 'varchar', length: 20 })
  provider: 'stripe' | 'mercadopago';

  /** card | bank_transfer | etc. Hoy solo 'card' soportado. */
  @Column({ type: 'varchar', length: 20, default: 'card' })
  type: string;

  /** Marca (visa, mastercard, amex, ...). Display-only. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  brand: string | null;

  /** Ultimos 4 digitos del card. Display-only. Aceptable PCI: solo
   *  expone information que el provider ya muestra. */
  @Column({ type: 'varchar', length: 4, nullable: true, name: 'last4' })
  last4: string | null;

  /** Mes de expiracion (1-12). Display-only. */
  @Column({ type: 'int', nullable: true, name: 'exp_month' })
  expMonth: number | null;

  /** Anio de expiracion (full, ej. 2027). Display-only. */
  @Column({ type: 'int', nullable: true, name: 'exp_year' })
  expYear: number | null;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: SavedPaymentMethodStatus;

  /** Solo UN metodo isDefault=true por tenant. Service enforce. */
  @Column({ type: 'boolean', default: false, name: 'is_default' })
  isDefault: boolean;

  /** Setup intent id del provider (si=stripe), null hasta que se cree. */
  @Column({ type: 'varchar', length: 100, name: 'setup_intent_id', nullable: true })
  setupIntentId: string | null;

  /** Quien lo agrego (user.id). Para audit. */
  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
