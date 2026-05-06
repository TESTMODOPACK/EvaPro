import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { RecurringMetric } from './recurring-metric.entity';

/**
 * MetricMeasurement — Audit P2, Tarea 10.
 *
 * Medición individual de una RecurringMetric. Inmutable: solo INSERT,
 * nunca UPDATE/DELETE. Cada medición forma parte del timeseries
 * histórico de la métrica.
 *
 * `observedAt` puede ser distinto de `createdAt`:
 *   - createdAt = cuándo se registró en el sistema
 *   - observedAt = cuándo ocurrió la medición real (puede ser
 *     retroactivo, p.ej. cargar mediciones del mes pasado)
 */
@Entity('metric_measurements')
@Index('idx_mm_metric_observed', ['recurringMetricId', 'observedAt'])
@Index('idx_mm_tenant', ['tenantId'])
export class MetricMeasurement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'recurring_metric_id' })
  recurringMetricId: string;

  @ManyToOne(() => RecurringMetric, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recurring_metric_id' })
  recurringMetric: RecurringMetric;

  @Column({ type: 'decimal', precision: 14, scale: 4 })
  value: number;

  /** Fecha real de la observación (puede ser retroactiva). */
  @Column({ type: 'timestamptz', name: 'observed_at' })
  observedAt: Date;

  @Column({ type: 'uuid', name: 'observed_by' })
  observedBy: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'observed_by' })
  observer: User | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
