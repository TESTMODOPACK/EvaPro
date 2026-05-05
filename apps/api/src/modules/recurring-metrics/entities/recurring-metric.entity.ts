import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

export enum MetricFrequency {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
}

/**
 * RecurringMetric — Audit P2, Tarea 10.
 *
 * Métrica recurrente medida periódicamente, semánticamente distinta a
 * un objetivo one-shot. Ejemplos: "ventas mensuales ≥ $5M", "NPS ≥ 80",
 * "tiempo promedio de resolución ≤ 4h".
 *
 * Diferencia clave vs `Objective`:
 *   - Sin `progress 0-100%` ni `targetDate` ni `status` terminal
 *   - Última medición se compara contra umbrales (verde/amarillo/rojo)
 *   - Frecuencia (diaria/semanal/mensual/trimestral) define cadencia
 *     esperada de mediciones para alertas de "métrica sin medición
 *     reciente"
 *
 * Por qué entidad separada en vez de extender Objective:
 *   - El modelo de "completion" no aplica — KPI nunca se "completa"
 *   - Las KRs no aplican — la métrica ES la unidad de medida
 *   - El histórico de mediciones es un timeseries propio
 *   - Evita seguir abusando ObjectiveStatus/progress para casos donde
 *     no encajan
 *
 * El KPI legacy (objectives.type='KPI') sigue funcionando — esta tabla
 * es additive. Tenants pueden migrar opcionalmente con el script
 * backfill-kpi-to-recurring-metric.ts (T10.3).
 */
@Entity('recurring_metrics')
@Index('idx_rm_tenant_owner', ['tenantId', 'ownerUserId'])
@Index('idx_rm_tenant_active', ['tenantId', 'isActive'])
export class RecurringMetric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /** Owner de la métrica (responsable de medirla y mantenerla). */
  @Column({ type: 'uuid', name: 'owner_user_id' })
  ownerUserId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'owner_user_id' })
  owner: User | null;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Unidad de medida: '%', 'CLP', 'unidades', 'horas', 'NPS'. */
  @Column({ type: 'varchar', length: 50 })
  unit: string;

  /** Valor objetivo. La métrica está "verde" si la última medición
   *  alcanza este valor (o lo supera, según higherIsBetter). */
  @Column({ type: 'decimal', precision: 14, scale: 4, name: 'target_value' })
  targetValue: number;

  /** Si TRUE, valores más altos son mejores (ej: ventas, NPS).
   *  Si FALSE, valores más bajos son mejores (ej: tiempo de respuesta,
   *  tasa de error). Determina la dirección de los umbrales. */
  @Column({ type: 'boolean', name: 'higher_is_better', default: true })
  higherIsBetter: boolean;

  /** Umbral verde (cumple objetivo). En modo higherIsBetter=true:
   *  valor >= thresholdGreen → verde. */
  @Column({
    type: 'decimal',
    precision: 14,
    scale: 4,
    name: 'threshold_green',
    nullable: true,
  })
  thresholdGreen: number | null;

  /** Umbral amarillo (advertencia). Entre yellow y green → amarillo. */
  @Column({
    type: 'decimal',
    precision: 14,
    scale: 4,
    name: 'threshold_yellow',
    nullable: true,
  })
  thresholdYellow: number | null;

  /** Cadencia esperada de mediciones. Define cuándo alertar al owner
   *  por "sin medición reciente". */
  @Column({
    type: 'enum',
    enum: MetricFrequency,
    default: MetricFrequency.MONTHLY,
  })
  frequency: MetricFrequency;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  /**
   * Linaje opcional: si la métrica fue migrada desde un Objective
   * legacy con type='KPI' (T10.3 backfill), esta columna apunta al
   * objective.id original. Null en métricas creadas directamente.
   */
  @Column({ type: 'uuid', name: 'migrated_from_objective_id', nullable: true })
  migratedFromObjectiveId: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
