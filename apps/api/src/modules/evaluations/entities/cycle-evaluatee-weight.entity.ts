import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { EvaluationCycle } from './evaluation-cycle.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';

/**
 * CycleEvaluateeWeight — Sprint 2 (BR-A.1) auditoria integridad ciclo.
 *
 * Almacena los pesos EFECTIVOS por evaluado cuando el sistema aplicó
 * una estrategia de redistribución (porque el evaluado carecía de un
 * rol incluido en el ciclo, ej. el CEO sin manager en un 360°).
 *
 * **Cuándo se llena:**
 * - El admin lanza ciclo con `cycle.settings.missingRoleStrategy =
 *   'REDISTRIBUTE_PROPORTIONAL'`.
 * - El sistema detecta evaluatees con roles faltantes (NO_MANAGER,
 *   NO_DIRECT_REPORTS, INSUFFICIENT_PEERS).
 * - Para esos evaluatees, calcula los effectiveWeights redistribuyendo
 *   el peso del rol faltante entre los roles activos.
 * - Persiste una fila por (cycle, evaluatee) con los pesos efectivos.
 *
 * **Si el evaluado tiene TODOS los roles del ciclo:** NO se crea fila
 * (los pesos default del ciclo aplican directamente).
 *
 * **Reports leen de aquí**: si existe fila → effectiveWeights del
 * evaluado; sino → cycle.weights_at_launch normal.
 *
 * **Estrategias soportadas (`strategy_used`):**
 * - REDISTRIBUTE_PROPORTIONAL: peso del rol faltante se reparte
 *   proporcionalmente entre roles activos.
 * - MANUAL_OVERRIDE: admin asignó manualmente otros evaluators
 *   (los effectiveWeights pueden no coincidir con el cycle default).
 * - EXCLUDE_EVALUATEE: el evaluado se omite del ciclo (no se crea
 *   fila aquí — se omite del totalEvaluated).
 */
@Entity('cycle_evaluatee_weights')
@Index('idx_cew_cycle', ['cycleId'])
@Index('idx_cew_tenant', ['tenantId'])
export class CycleEvaluateeWeight {
  @PrimaryColumn({ type: 'uuid', name: 'cycle_id' })
  cycleId: string;

  @ManyToOne(() => EvaluationCycle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cycle_id' })
  cycle: EvaluationCycle;

  @PrimaryColumn({ type: 'uuid', name: 'evaluatee_id' })
  evaluateeId: string;

  /**
   * Tenant del ciclo (snapshot). Redundante con cycle.tenant_id.
   */
  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId: string | null;

  @ManyToOne(() => Tenant, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /**
   * Mapa relationType → peso efectivo (post-redistribución). La suma
   * debe ser 1.0 ± tolerance. Roles faltantes NO aparecen en el mapa.
   *
   * Ejemplo CEO en 360° (configured: mgr 0.30, self 0.20, peer 0.25, dr 0.25):
   *   { self: 0.286, peer: 0.357, dr: 0.357 }
   * (peso 0.30 del manager redistribuido proporcionalmente).
   */
  @Column({ type: 'jsonb', name: 'effective_weights' })
  effectiveWeights: Record<string, number>;

  /**
   * Estrategia que generó estos effective weights. Documental — el
   * cálculo ya está aplicado en effectiveWeights. Útil para reports
   * que muestran "Pesos redistribuidos por estrategia X".
   */
  @Column({ type: 'varchar', length: 30, name: 'strategy_used' })
  strategyUsed: 'REDISTRIBUTE_PROPORTIONAL' | 'MANUAL_OVERRIDE';

  /**
   * Roles que estaban configurados pero NO aplican a este evaluado.
   * Ej: ['manager'] para el CEO. Útil para mostrar al admin/evaluado.
   */
  @Column({ type: 'varchar', array: true, name: 'missing_roles', default: () => "'{}'::varchar[]" })
  missingRoles: string[];

  /**
   * Razón humanmente legible para audit + UI tooltip.
   * Ejemplo: "Sin jefe directo (top of organigrama)".
   */
  @Column({ type: 'text', name: 'reason', nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
