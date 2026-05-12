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
import { EvaluationCycle } from './evaluation-cycle.entity';
import { EvaluationAssignment } from './evaluation-assignment.entity';

/**
 * EvaluationObjectiveSnapshot — Audit P0, Tarea 5 (Issue A).
 *
 * Captura inmutable del estado de un objetivo en un momento puntual,
 * usado para evitar que documentos firmados (evaluaciones) muten
 * retroactivamente cuando el objetivo sigue progresando.
 *
 * Issue que resuelve:
 *   Las evaluaciones precargan objetivos en vivo. Si un manager firma
 *   una evaluación que cita "Implementar CRM: 35%" y el objetivo sigue
 *   avanzando hasta 80%, el PDF/vista histórico muestra 80% — el
 *   documento original mutó.
 *
 * Niveles de snapshot:
 *   - Cycle-wide (assignmentId = NULL): un snapshot por (cycleId,
 *     objectiveId), capturado al cerrar el ciclo. Es el fallback amplio
 *     para cualquier evaluación de ese ciclo.
 *   - Per-signature (assignmentId != NULL): un snapshot por (assignmentId,
 *     objectiveId), capturado al firmar. Más preciso temporalmente —
 *     refleja el estado exacto que vio el firmante.
 *
 * Lectura (T5.4):
 *   1. Buscar snapshot per-signature (assignmentId match)
 *   2. Si no existe, buscar cycle-wide (assignmentId IS NULL)
 *   3. Si tampoco, leer en vivo (legacy o ciclo abierto sin firma)
 *
 * Inmutabilidad: solo INSERT, nunca UPDATE. Re-firmas crean snapshots
 * adicionales con un capturedAt nuevo (ordenamos por capturedAt DESC).
 */
@Entity('evaluation_objective_snapshots')
@Index('idx_eval_obj_snap_cycle', ['tenantId', 'cycleId'])
@Index('idx_eval_obj_snap_assignment', ['tenantId', 'assignmentId'])
@Index('idx_eval_obj_snap_lookup', [
  'tenantId',
  'cycleId',
  'objectiveId',
  'assignmentId',
])
export class EvaluationObjectiveSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /** Ciclo al que pertenecía el objetivo en el momento del snapshot. */
  @Column({ type: 'uuid', name: 'cycle_id' })
  cycleId: string;

  @ManyToOne(() => EvaluationCycle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cycle_id' })
  cycle: EvaluationCycle;

  /**
   * Asignación específica si el snapshot es per-signature. NULL si es
   * cycle-wide (capturado al cerrar el ciclo).
   */
  @Column({ type: 'uuid', name: 'assignment_id', nullable: true })
  assignmentId: string | null;

  @ManyToOne(() => EvaluationAssignment, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'assignment_id' })
  assignment: EvaluationAssignment | null;

  /**
   * Referencia al objetivo original. NO es FK con CASCADE para que un
   * delete del objetivo no destruya el registro histórico — el snapshot
   * preserva la evidencia incluso si el objetivo se elimina.
   */
  @Column({ type: 'uuid', name: 'objective_id' })
  objectiveId: string;

  // ─── Estado capturado del objetivo ───────────────────────────────────

  @Column({ type: 'uuid', name: 'owner_user_id' })
  ownerUserId: string;

  @Column({ type: 'varchar', length: 300, name: 'objective_title' })
  objectiveTitle: string;

  /** Tipo en el momento del snapshot: OKR, KPI, SMART. */
  @Column({ type: 'varchar', length: 20, name: 'objective_type' })
  objectiveType: string;

  /** Status en el momento del snapshot. */
  @Column({ type: 'varchar', length: 30, name: 'objective_status' })
  objectiveStatus: string;

  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  weight: number;

  @Column({ type: 'date', name: 'target_date', nullable: true })
  targetDate: Date | null;

  /**
   * KRs serializados en JSONB. Cada item:
   *   { id, description, unit, baseValue, targetValue, currentValue, status }
   * Se guardan así para que el delete de un KR no rompa el historial.
   */
  @Column({
    type: 'jsonb',
    name: 'key_results_json',
    default: () => "'[]'::jsonb",
  })
  keyResultsJson: Array<{
    id: string;
    description: string;
    unit: string | null;
    baseValue: number;
    targetValue: number;
    currentValue: number;
    status: string;
  }>;

  // ─── Metadata de captura ─────────────────────────────────────────────

  /**
   * Quién disparó la captura: userId del que cerró el ciclo (cycle-wide)
   * o del que firmó (per-signature).
   */
  @Column({ type: 'uuid', name: 'captured_by' })
  capturedBy: string;

  /** Origen del snapshot: 'cycle_close' o 'signature'. */
  @Column({ type: 'varchar', length: 30, name: 'capture_source' })
  captureSource: 'cycle_close' | 'signature';

  @CreateDateColumn({ type: 'timestamptz', name: 'captured_at' })
  capturedAt: Date;
}
