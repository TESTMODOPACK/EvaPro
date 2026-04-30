import {
  Column, CreateDateColumn, UpdateDateColumn, Entity,
  PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Department } from '../../tenants/entities/department.entity';
import { Position } from '../../tenants/entities/position.entity';
import { User } from '../../users/entities/user.entity';

export enum ProcessType {
  EXTERNAL = 'external',
  INTERNAL = 'internal',
}

export enum ProcessStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CLOSED = 'closed',
}

@Entity('recruitment_processes')
@Index('idx_rp_tenant', ['tenantId'])
@Index('idx_rp_tenant_status', ['tenantId', 'status'])
export class RecruitmentProcess {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 20, name: 'process_type' })
  processType: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 100 })
  position: string;

  @Column({ type: 'uuid', nullable: true, name: 'position_id' })
  @Index('idx_rp_pos_id')
  positionId: string | null;

  @ManyToOne(() => Position, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'position_id' })
  positionEntity: Position;

  @Column({ type: 'varchar', length: 100, nullable: true })
  department: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'department_id' })
  @Index('idx_rp_dept_id')
  departmentId: string | null;

  @ManyToOne(() => Department, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_id' })
  departmentEntity: Department;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', name: 'requirements', default: () => "'[]'" })
  requirements: Array<{ category: string; text: string; weight?: number }>;

  @Column({ type: 'boolean', name: 'require_cv_for_internal', default: false })
  requireCvForInternal: boolean;

  @Column({ type: 'enum', enum: ProcessStatus, default: ProcessStatus.DRAFT })
  status: ProcessStatus;

  @Column({ type: 'date', name: 'start_date', nullable: true })
  startDate: Date | null;

  @Column({ type: 'date', name: 'end_date', nullable: true })
  endDate: Date | null;

  /**
   * v3.1 — true si el proceso fue cerrado automáticamente por el cron
   * `autoCloseExpiredProcesses` (endDate venció estando en ACTIVE).
   * Se resetea a false al reabrir manualmente (CLOSED/COMPLETED → ACTIVE).
   * Útil para distinguir cierres manuales vs. automáticos en UI/reportes.
   */
  @Column({ type: 'boolean', name: 'auto_closed', default: false })
  autoClosed: boolean;

  @Column({ type: 'jsonb', name: 'scoring_weights', default: () => "'{\"interview\": 40, \"history\": 30, \"requirements\": 20, \"cvMatch\": 10}'" })
  scoringWeights: { interview: number; history?: number; requirements?: number; cvMatch?: number };

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  /**
   * S1 (Sprint 1) — Hire flow:
   *
   * `winning_candidate_id` apunta al candidato seleccionado cuando el
   * admin ejecuta el "Marcar como contratado". Es nullable porque un
   * proceso puede cerrarse sin contratar (CLOSED) y porque hasta antes
   * de S1 los procesos COMPLETED no tenian este dato.
   *
   * No usamos FK constraint para evitar el ON DELETE chain — si el
   * candidato se elimina, queremos preservar el registro historico de
   * "este proceso eligio a X" para auditoria; el id queda dangling pero
   * lo manejamos en lectura. En la entity solo declaramos la columna.
   */
  @Column({ type: 'uuid', name: 'winning_candidate_id', nullable: true })
  winningCandidateId: string | null;

  /**
   * `hire_data` JSONB con los datos capturados al ejecutar hire desde
   * el modal:
   *   - effectiveDate: fecha de inicio en el nuevo cargo
   *   - newDepartmentId / newPositionId / newManagerId: estructura
   *     organizacional resultante (puede diferir del proceso original)
   *   - salary, contractType: solo persistidos para registro; el modulo
   *     contracts es la fuente formal del contrato
   *   - notes: justificacion / contexto del hire
   *
   * Nullable porque hasta antes de S1 no existia esta informacion.
   * Se persiste tambien en user_movements al ejecutar la cascada para
   * tener un audit trail formal — `hire_data` es la copia "lo que
   * dijo el admin", `user_movements` es la verdad operativa.
   */
  @Column({ type: 'jsonb', name: 'hire_data', nullable: true })
  hireData: {
    effectiveDate: string; // ISO date YYYY-MM-DD
    newDepartmentId?: string | null;
    newPositionId?: string | null;
    newManagerId?: string | null;
    salary?: number | null;
    contractType?: 'indefinido' | 'plazo_fijo' | 'honorarios' | 'practicante' | null;
    notes?: string | null;
    /**
     * S3.x — Estado del User ANTES del hire, capturado al ejecutar la
     * cascada (solo internos). Se usa para revertir si el admin hace
     * "Revertir contratación": deshace el cambio en `users` y borra el
     * `user_movement` que creo el hire. Para externos no aplica (era
     * alta inicial — no hay estado previo que recuperar).
     */
    previousUserState?: {
      departmentId: string | null;
      department: string | null;
      positionId: string | null;
      position: string | null;
      managerId: string | null;
      hierarchyLevel: number | null;
    } | null;
    /**
     * S3.x — Snapshot del stage de TODOS los candidatos del proceso al
     * momento del hire. Map { candidateId: stage } con los valores
     * previos (antes de transicionar el ganador a HIRED y los demas a
     * NOT_HIRED). Usado por revertHire para restaurar el estado EXACTO
     * de cada candidato (en lugar de homogeneizar a 'approved' que
     * pierde info: scored vs interviewing vs approved).
     */
    previousCandidateStages?: Record<string, string> | null;
  } | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
