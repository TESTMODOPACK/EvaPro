import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { EvaluationCycle } from './evaluation-cycle.entity';

export enum StageType {
  SELF_EVALUATION = 'self_evaluation',
  MANAGER_EVALUATION = 'manager_evaluation',
  PEER_EVALUATION = 'peer_evaluation',
  CALIBRATION = 'calibration',
  FEEDBACK_DELIVERY = 'feedback_delivery',
  CLOSED = 'closed',
}

export enum StageStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  SKIPPED = 'skipped',
}

/**
 * Etapas del Ciclo de Evaluación.
 *
 * Cada ciclo se divide en etapas secuenciales que controlan el flujo del proceso:
 *   1. Autoevaluación       → El colaborador se evalúa a sí mismo
 *   2. Evaluación Manager   → El encargado evalúa a sus reportes directos
 *   3. Evaluación de Pares  → Solo 270°/360°: evaluadores pares completan sus formularios
 *   4. Calibración          → Solo 360°: comité ajusta puntajes para equidad
 *   5. Entrega de Feedback  → Se comparten resultados con los evaluados
 *   6. Cierre               → El ciclo queda cerrado y no se aceptan más cambios
 *
 * Reglas:
 * - No se puede avanzar a la siguiente etapa si la actual no está completada
 * - El número de etapas depende del tipo de evaluación (90°, 180°, 270°, 360°)
 * - Las fechas de inicio/fin son orientativas (la restricción real es el status)
 */
@Entity('cycle_stages')
@Index('idx_cycle_stages_cycle', ['cycleId'])
export class CycleStage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'cycle_id' })
  cycleId: string;

  @ManyToOne(() => EvaluationCycle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cycle_id' })
  cycle: EvaluationCycle;

  @Column({ type: 'varchar', length: 100, comment: 'Nombre legible de la etapa' })
  name: string;

  @Column({ type: 'enum', enum: StageType })
  type: StageType;

  @Column({ type: 'int', name: 'stage_order', comment: 'Orden secuencial: 1, 2, 3...' })
  stageOrder: number;

  @Column({ type: 'date', name: 'start_date', nullable: true })
  startDate: Date;

  @Column({ type: 'date', name: 'end_date', nullable: true })
  endDate: Date;

  @Column({ type: 'enum', enum: StageStatus, default: StageStatus.PENDING })
  status: StageStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
