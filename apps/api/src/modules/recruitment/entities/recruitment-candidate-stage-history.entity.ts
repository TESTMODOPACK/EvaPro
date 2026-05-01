import {
  Column, CreateDateColumn, Entity,
  PrimaryGeneratedColumn, Index,
} from 'typeorm';

/**
 * S6.1 — Historial de transiciones de stage de un candidato.
 *
 * Cada cambio de `recruitment_candidates.stage` inserta una fila aqui.
 * Permite calcular metricas (S6.3): tiempo promedio en cada stage,
 * funnel de conversion, time-to-hire, etc.
 *
 * Diseño:
 *   - `from_stage` puede ser NULL para representar el "stage inicial"
 *     cuando se crea el candidato (transicion null → registered).
 *   - `to_stage` es siempre obligatorio (siempre va a algun stage).
 *   - `changed_at` es timestamptz por defecto NOW() para precision en
 *     calculos de tiempo entre stages.
 *   - `changed_by` es nullable porque algunos transitions son sistema:
 *     - cron `autoCloseExpiredProcesses` (no hay user)
 *     - auto-advance en uploadCv/submitInterview/recalculateScore
 *     - cron de backfill (S6.1 onwards)
 *   - Source para distinguir el origen del cambio (manual_admin,
 *     auto_advance_cv, auto_advance_interview, auto_advance_score,
 *     hire, revert_hire, bulk, backfill, system_cron).
 *
 * Indices:
 *   - (candidate_id, changed_at) para queries por candidato ordenadas
 *     temporalmente.
 *   - (tenant_id, changed_at) para reportes a nivel tenant.
 *
 * Retencion: por ahora indefinida (auditoria + metricas historicas).
 * Si crece descontroladamente, considerar archivado a S3 a los 24m.
 */
@Entity('recruitment_candidate_stage_history')
@Index('idx_rcsh_candidate_changed', ['candidateId', 'changedAt'])
@Index('idx_rcsh_tenant_changed', ['tenantId', 'changedAt'])
export class RecruitmentCandidateStageHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'candidate_id' })
  candidateId: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 30, name: 'from_stage', nullable: true })
  fromStage: string | null;

  @Column({ type: 'varchar', length: 30, name: 'to_stage' })
  toStage: string;

  @Column({ type: 'timestamptz', name: 'changed_at', default: () => 'NOW()' })
  changedAt: Date;

  @Column({ type: 'uuid', name: 'changed_by', nullable: true })
  changedBy: string | null;

  @Column({ type: 'varchar', length: 30, name: 'source', default: 'manual' })
  source: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
