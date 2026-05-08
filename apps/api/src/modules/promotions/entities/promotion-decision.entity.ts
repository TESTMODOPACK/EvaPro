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
 * Estados del workflow de promoción — ADR 0002 §4.
 *
 *   pending_review (sistema recomienda) → endorsed (manager) →
 *   approved/rejected (admin) → executed (workflow externo a Eva360)
 *
 * El estado "executed" indica que la promoción fue formalizada
 * (cambio de position en HRIS, salary adjustment, etc.) — Eva360 NO
 * ejecuta esto, solo registra que ocurrió externamente.
 */
export enum PromotionDecisionStatus {
  PENDING_REVIEW = 'pending_review',     // Sistema recomendó, sin acción humana
  ENDORSED = 'endorsed',                  // Manager endorsó, esperando admin
  REJECTED_BY_MANAGER = 'rejected_by_manager',
  APPROVED = 'approved',                  // Admin aprobó (decisión formal)
  REJECTED_BY_ADMIN = 'rejected_by_admin',
  RETURNED_FOR_REVIEW = 'returned_for_review', // Admin pide más data al manager
  EXECUTED = 'executed',                  // Promoción formalizada externamente
  CANCELLED = 'cancelled',                // Anulada (ej. user dejó la empresa)
}

/**
 * PromotionDecision — ADR 0002 / Promotions module.
 *
 * Registro auditable del workflow de decisión sobre una recomendación.
 * Una recomendación puede generar múltiples decisions a lo largo del
 * tiempo (manager endorsa, admin retorna, manager re-endorsa, admin
 * aprueba, etc.). El histórico se preserva para auditoría legal.
 *
 * Multi-tenant via tenantId.
 */
@Entity('promotion_decisions')
@Index('idx_promodec_tenant_user', ['tenantId', 'userId'])
@Index('idx_promodec_status', ['tenantId', 'status'])
@Index('idx_promodec_recommendation', ['recommendationId'])
export class PromotionDecision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /** El user candidato a promoción. */
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** FK a la recomendación específica que originó esta decisión. */
  @Column({ type: 'uuid', name: 'recommendation_id', nullable: true })
  recommendationId: string | null;

  // ─── Estado del workflow ─────────────────────────────────────

  @Column({
    type: 'varchar',
    length: 30,
    name: 'status',
  })
  status: PromotionDecisionStatus;

  // ─── Manager endorsement ─────────────────────────────────────

  @Column({ type: 'uuid', name: 'endorsed_by', nullable: true })
  endorsedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'endorsed_by' })
  endorser: User | null;

  @Column({ type: 'timestamptz', name: 'endorsed_at', nullable: true })
  endorsedAt: Date | null;

  @Column({ type: 'text', name: 'endorsement_comment', nullable: true })
  endorsementComment: string | null;

  /** Nivel sugerido por el manager (puede diferir del suggestedNextLevelId del sistema). */
  @Column({ type: 'uuid', name: 'endorsed_target_level_id', nullable: true })
  endorsedTargetLevelId: string | null;

  // ─── Admin decision ──────────────────────────────────────────

  @Column({ type: 'uuid', name: 'decided_by', nullable: true })
  decidedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'decided_by' })
  decider: User | null;

  @Column({ type: 'timestamptz', name: 'decided_at', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'text', name: 'decision_comment', nullable: true })
  decisionComment: string | null;

  /** Nivel final aprobado por admin (puede diferir del endorsed). */
  @Column({ type: 'uuid', name: 'approved_target_level_id', nullable: true })
  approvedTargetLevelId: string | null;

  // ─── Execution (cambio formal externo) ───────────────────────

  @Column({ type: 'timestamptz', name: 'executed_at', nullable: true })
  executedAt: Date | null;

  @Column({ type: 'date', name: 'effective_date', nullable: true })
  effectiveDate: Date | null;

  @Column({ type: 'text', name: 'execution_notes', nullable: true })
  executionNotes: string | null;

  // ─── Timestamps ──────────────────────────────────────────────

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
