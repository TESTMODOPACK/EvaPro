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
 * CycleOrgSnapshot — Sprint 1 (BR-C.1) auditoria integridad ciclo.
 *
 * Snapshot inmutable del organigrama al momento de lanzar un ciclo de
 * evaluación. Resuelve el problema de **falsificación retroactiva** de
 * resultados: si el organigrama cambia mid-cycle (renuncias, promotion,
 * re-orgs), los reports DEBEN seguir reflejando la estructura del
 * lanzamiento, no el estado actual de `users`.
 *
 * **Regla principal (BR-C.1.3)**: reports y validaciones de assignments
 * leen de esta tabla cuando el ciclo está `active|closed|cancelled`.
 * Solo en `draft` se lee del estado actual de `users`.
 *
 * **Inmutabilidad (BR-C.1.5)**: solo se puede regenerar si se cancela el
 * ciclo y se vuelve a draft (operación reservada a super_admin).
 *
 * **Late additions (BR-C.1.6)**: si admin agrega evaluado al ciclo
 * activo, se inserta una nueva fila con `late_addition: true` y
 * `snapshot_at` = NOW. Las filas originales mantienen su snapshot_at.
 *
 * **Tenant scoping**: derivado del cycle (no campo redundante). RLS
 * usa el join: `WHERE cycle.tenant_id = current_tenant`.
 */
@Entity('cycle_org_snapshots')
@Index('idx_cycle_org_snapshot_user', ['userId'])
@Index('idx_cycle_org_snapshot_cycle_active', ['cycleId', 'isActive'])
export class CycleOrgSnapshot {
  /**
   * PK compuesto: (cycle_id, user_id) garantiza una sola fila por
   * (ciclo, user). Aplicaciones pueden re-insertar idempotentemente
   * para late additions (ON CONFLICT DO UPDATE).
   */
  @PrimaryColumn({ type: 'uuid', name: 'cycle_id' })
  cycleId: string;

  @ManyToOne(() => EvaluationCycle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cycle_id' })
  cycle: EvaluationCycle;

  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId: string;

  /**
   * Tenant del ciclo (snapshot). Redundante con cycle.tenant_id pero
   * útil para indexes RLS y queries cross-cycle eficientes.
   */
  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId: string | null;

  @ManyToOne(() => Tenant, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /**
   * Manager primario al momento del snapshot. Null si el evaluado era
   * top-level (CEO sin jefe). El `MANUAL_OVERRIDE` de excepciones
   * (BR-A.1) puede setear un valor distinto al actual de `users.manager_id`.
   */
  @Column({ type: 'uuid', name: 'primary_manager_id', nullable: true })
  primaryManagerId: string | null;

  /**
   * Managers secundarios (matrix reporting, BR-A.4). Array vacío si no aplica.
   * Reservado para Sprint 4; en Sprint 1 siempre es []
   * (mantenemos el campo para evitar migration futura).
   */
  @Column({ type: 'uuid', array: true, name: 'secondary_managers', default: () => "'{}'::uuid[]" })
  secondaryManagers: string[];

  @Column({ type: 'uuid', name: 'department_id', nullable: true })
  departmentId: string | null;

  /**
   * Nombre del departamento al momento del snapshot. Útil cuando
   * `department_id` apunta a un dept que después fue renombrado o eliminado.
   */
  @Column({ type: 'varchar', length: 200, name: 'department_name', nullable: true })
  departmentName: string | null;

  @Column({ type: 'int', name: 'hierarchy_level', nullable: true })
  hierarchyLevel: number | null;

  @Column({ type: 'varchar', length: 50, name: 'role', nullable: true })
  role: string | null;

  /**
   * `is_active` al momento del snapshot. Si user fue desactivado luego
   * (cascade BR-C.4), esta columna sigue siendo `true` para preservar
   * la trazabilidad ("evaluó cuando estaba activo").
   */
  @Column({ type: 'boolean', name: 'is_active' })
  isActive: boolean;

  /**
   * Marca si el user se agregó al ciclo DESPUÉS del launch (no estaba
   * en el snapshot original). Reports muestran badge "agregado tarde".
   */
  @Column({ type: 'boolean', name: 'late_addition', default: false })
  lateAddition: boolean;

  /**
   * Si el admin excluyó manualmente al user del ciclo (sin cancelar el
   * ciclo entero), se setea esta columna. La fila se preserva para audit.
   */
  @Column({ type: 'timestamptz', name: 'excluded_at', nullable: true })
  excludedAt: Date | null;

  /**
   * Razón de la exclusión (cuando excluded_at no es null).
   */
  @Column({ type: 'text', name: 'excluded_reason', nullable: true })
  excludedReason: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'snapshot_at' })
  snapshotAt: Date;
}
