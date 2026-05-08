import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Niveles de readiness — ADR 0002 §3.
 */
export enum ReadinessLevel {
  READY_NOW = 'READY_NOW',         // composite ≥ 1.5σ + filters pass
  READY_12M = 'READY_12M',         // composite ≥ 0.8σ + filters pass
  DEVELOP_FIRST = 'DEVELOP_FIRST', // composite ≥ 0.5σ
  NOT_READY = 'NOT_READY',         // resto, o algún filtro falla
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA', // <1 ciclo, sin manager
}

/**
 * Niveles de confianza de la recomendación — ADR 0002 §7.
 */
export enum ConfidenceLevel {
  HIGH = 'HIGH',                   // ≥3 ciclos perf, ≥1 calibración reciente, ≥2 evaluadores 360, cohort ≥10
  MEDIUM = 'MEDIUM',               // 2 ciclos perf O calibración antigua O cohort 5-9
  LOW = 'LOW',                     // 1 ciclo perf, sin calibración, cohort <5
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
}

/**
 * PromotionRecommendation — ADR 0002 / Promotions module.
 *
 * Recomendación calculada por PromotionScoringEngine. Persistida
 * con TODO el detalle del scoring (5 dimensiones, filtros, cohort,
 * versión del algoritmo) para reproducibilidad ante disputa legal.
 *
 * El cron diario reemplaza la fila más reciente por user (no histórico
 * — solo última recomendación). Las decisiones efectivas se persisten
 * en PromotionDecision (tabla separada).
 *
 * Multi-tenant via tenantId.
 */
@Entity('promotion_recommendations')
@Index('idx_promorec_tenant_user', ['tenantId', 'userId'], { unique: true })
@Index('idx_promorec_readiness', ['tenantId', 'readiness'])
@Index('idx_promorec_computed', ['tenantId', 'computedAt'])
export class PromotionRecommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Nivel actual del user al momento del cálculo (snapshot). */
  @Column({ type: 'uuid', name: 'current_level_id', nullable: true })
  currentLevelId: string | null;

  /** Nivel sugerido como next step (career_path resuelto). */
  @Column({ type: 'uuid', name: 'suggested_next_level_id', nullable: true })
  suggestedNextLevelId: string | null;

  // ─── Resultado ────────────────────────────────────────────────

  @Column({
    type: 'varchar',
    length: 30,
    name: 'readiness',
    comment: 'READY_NOW | READY_12M | DEVELOP_FIRST | NOT_READY | INSUFFICIENT_DATA',
  })
  readiness: ReadinessLevel;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 3,
    name: 'composite_score',
    nullable: true,
    comment: 'Z-score compuesto. NULL si readiness=NOT_READY por filtros eliminatorios.',
  })
  compositeScore: number | null;

  @Column({
    type: 'varchar',
    length: 30,
    name: 'confidence',
    comment: 'HIGH | MEDIUM | LOW | INSUFFICIENT_DATA',
  })
  confidence: ConfidenceLevel;

  // ─── Breakdown de dimensiones (JSONB para flexibilidad) ──────

  /**
   * Detalle por dimensión:
   * {
   *   performance:   { raw, zScore, weight, dataPoints, trend },
   *   potential:     { raw, zScore, weight, calibrationDate, quadrant },
   *   behavioral:    { raw, zScore, weight, evaluatorCount },
   *   growth:        { raw, zScore, weight, planCompletion, ... },
   *   recognition:   { raw, zScore, weight, count },
   *   engagement:    { raw, zScore, weight, moodAvg }
   * }
   */
  @Column({ type: 'jsonb', name: 'dimensions' })
  dimensions: {
    performance: { raw: number; zScore: number; weight: number; dataPoints: number; trend: number };
    potential: { raw: number; zScore: number; weight: number; quadrant: string | null; calibrationDate: string | null };
    behavioral: { raw: number; zScore: number; weight: number; evaluatorCount: number };
    growth: { raw: number; zScore: number; weight: number; planCompletion: number; checkinFreq: number; feedbackGiven: number };
    recognition: { raw: number; zScore: number; weight: number; count: number };
    engagement: { raw: number; zScore: number; weight: number; moodAvg: number };
  };

  // ─── Filtros aplicados (auditoría) ────────────────────────────

  /**
   * Resultado de los kill criteria F1a, F1b, F1c, F2-F7.
   * Si algún filtro falla, readiness = NOT_READY y este campo registra
   * cuáles fallaron y por qué.
   *
   * {
   *   F1a_tenureCompany: { passed: true, value: 42, threshold: 36 },
   *   F1b_tenureRole: { passed: true, value: 16, threshold: 12 },
   *   F1c_non90Cycles: { passed: true, value: 4, threshold: 3 },
   *   ...
   * }
   */
  @Column({ type: 'jsonb', name: 'filters' })
  filters: Record<string, { passed: boolean; value?: number | string | boolean; threshold?: number | string; reason?: string }>;

  /** Cohort usado para z-score (level + departamento, etc.). */
  @Column({ type: 'jsonb', name: 'cohort_info' })
  cohortInfo: {
    strategy: 'level_and_department' | 'level_only' | 'tenant_wide';
    size: number;
    levelId: string | null;
    departmentId: string | null;
  };

  // ─── Versionado del algoritmo (semver) ───────────────────────

  /** Semver del PromotionScoringEngine al momento del cálculo. */
  @Column({ type: 'varchar', length: 20, name: 'algorithm_version' })
  algorithmVersion: string;

  /** Snapshot de los pesos y thresholds usados (auditoría). */
  @Column({ type: 'jsonb', name: 'policy_snapshot' })
  policySnapshot: {
    weights: Record<string, number>;
    thresholds: Record<string, number>;
    filterDefaults: Record<string, number | boolean>;
  };

  // ─── Explicación natural-language pre-computada ──────────────

  /**
   * Texto generado al momento del cálculo describiendo fortalezas,
   * áreas de oportunidad y recomendación. Se usa en la UI sin tener
   * que recalcular cada vez. Idioma del tenant.
   */
  @Column({ type: 'text', name: 'explanation', nullable: true })
  explanation: string | null;

  // ─── Timestamps ──────────────────────────────────────────────

  @Column({ type: 'timestamptz', name: 'computed_at' })
  computedAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
