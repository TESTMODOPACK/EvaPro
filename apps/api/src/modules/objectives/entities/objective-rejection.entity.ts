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
import { Objective } from './objective.entity';
import { User } from '../../users/entities/user.entity';

/**
 * ObjectiveRejection — Audit P1, Tarea 8.
 *
 * Historial de rechazos de un objetivo. Antes de T8, cuando un manager
 * rechazaba un objetivo, sólo se sobreescribía el campo
 * `objectives.rejection_reason` — al re-someter o al ser rechazado
 * nuevamente, el motivo previo desaparecía. Sin trazabilidad de cuántas
 * veces fue rechazado, por quién, ni los motivos previos.
 *
 * Esta tabla persiste cada evento de rechazo como una fila inmutable.
 * El campo `objectives.rejection_reason` se mantiene como
 * denormalización del último rechazo (útil para listados y compatibilidad).
 *
 * Inmutabilidad: solo INSERT, nunca UPDATE/DELETE.
 */
@Entity('objective_rejections')
@Index('idx_obj_rejection_obj', ['tenantId', 'objectiveId'])
@Index('idx_obj_rejection_at', ['rejectedAt'])
export class ObjectiveRejection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'objective_id' })
  objectiveId: string;

  @ManyToOne(() => Objective, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'objective_id' })
  objective: Objective;

  /** Quien rechazó (manager / admin / super_admin). */
  @Column({ type: 'uuid', name: 'rejected_by' })
  rejectedBy: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'rejected_by' })
  rejector: User | null;

  /** Motivo del rechazo. Null permitido (compat: rechazos viejos podían
   *  no tener razón). El nuevo flujo recomienda razón obligatoria pero
   *  no la hacemos NOT NULL para evitar romper backfills. */
  @Column({ type: 'text', nullable: true })
  reason: string | null;

  /**
   * Snapshot del título del objetivo en el momento del rechazo. Por si
   * el objetivo se renombra después, el historial preserva el nombre
   * original.
   */
  @Column({ type: 'varchar', length: 300, name: 'objective_title_snapshot' })
  objectiveTitleSnapshot: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'rejected_at' })
  rejectedAt: Date;
}
