import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Subscription } from './subscription.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';

/**
 * Fase 4 / Tarea 4.3 — Override de pricing por subscription.
 *
 * Caso de uso:
 *   - Super_admin negocia descuento puntual con un cliente (e.g. -20%
 *     por 6 meses para retencion).
 *   - Cliente enterprise con tarifa custom no listada en planes.
 *   - Comping (precio=0) para early adopters o partners.
 *
 * Reglas de negocio:
 *   - Cada override sobreescribe SOLO el campo presente; los demas
 *     caen al plan base. Ej: { monthlyPrice: 5 } -> mensual=5,
 *     trimestral/anual del plan base sin cambio.
 *   - validFrom/validUntil definen ventana. Si validUntil = NULL ->
 *     indefinido (cuidado: no se expira solo).
 *   - Solo UN override activo (validFrom <= now <= validUntil) por
 *     subscription. Si se crea uno nuevo, el anterior se cierra
 *     (validUntil = now) automaticamente.
 *   - Audit log obligatorio con reason y approvedBy para SII +
 *     trazabilidad comercial.
 */
@Entity('subscription_price_overrides')
@Index('idx_spo_sub', ['subscriptionId'])
@Index('idx_spo_tenant', ['tenantId'])
@Index('idx_spo_sub_active', ['subscriptionId', 'validUntil'])
export class SubscriptionPriceOverride {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'subscription_id' })
  subscriptionId: string;

  @ManyToOne(() => Subscription, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  /** Snapshot del tenantId para queries cross-tenant (super_admin
   *  dashboard). Redundante con sub.tenantId pero evita JOIN. */
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /** Cada precio es opcional. Solo los definidos sobreescriben el plan. */
  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'monthly_price', nullable: true })
  monthlyPrice: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'quarterly_price', nullable: true })
  quarterlyPrice: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'semiannual_price', nullable: true })
  semiannualPrice: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'yearly_price', nullable: true })
  yearlyPrice: number | null;

  /** Ventana de validez. validFrom siempre seteado; validUntil null = indefinido. */
  @Column({ type: 'timestamptz', name: 'valid_from' })
  validFrom: Date;

  @Column({ type: 'timestamptz', name: 'valid_until', nullable: true })
  validUntil: Date | null;

  /** Razon comercial. Obligatoria. Min 5 chars. */
  @Column({ type: 'text' })
  reason: string;

  /** User que aprobo (super_admin). */
  @Column({ type: 'uuid', name: 'approved_by' })
  approvedBy: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
