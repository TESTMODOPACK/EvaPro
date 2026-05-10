import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('subscription_plans')
@Unique(['code'])
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', name: 'max_employees', default: 50 })
  maxEmployees: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'monthly_price', default: 0 })
  monthlyPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'quarterly_price', nullable: true })
  quarterlyPrice: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'semiannual_price', nullable: true })
  semiannualPrice: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'yearly_price', nullable: true })
  yearlyPrice: number | null;

  @Column({ type: 'varchar', length: 10, default: 'UF' })
  currency: string; // UF | CLP | USD

  @Column({ type: 'jsonb', default: [] })
  features: string[];

  @Column({ type: 'int', name: 'max_ai_calls_per_month', default: 0, comment: '0 = sin acceso AI, null = ilimitado' })
  maxAiCallsPerMonth: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'int', name: 'display_order', default: 0 })
  displayOrder: number;

  /**
   * Fase 1 / Tarea 1.2 — Grace period configurable por plan.
   *
   * Si null o falta una key, processDunning usa el default global
   * (3/7/14/30/37). Permite por ejemplo:
   *   - Enterprise: { reminder1: 7, reminder2: 14, suspend: 30,
   *     cancelWarning: 60, cancel: 90 } (90 dias gracia total)
   *   - Starter:    { reminder1: 1, reminder2: 3, suspend: 7,
   *     cancelWarning: 14, cancel: 21 } (21 dias gracia total)
   *
   * Cada key representa "daysOverdue >= N -> aplicar este stage".
   * Los valores deben ser estrictamente crecientes; si no, processDunning
   * loggea warning y usa defaults.
   */
  @Column({ type: 'jsonb', name: 'dunning_thresholds', nullable: true })
  dunningThresholds: {
    reminder1?: number;
    reminder2?: number;
    suspend?: number;
    cancelWarning?: number;
    cancel?: number;
  } | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
