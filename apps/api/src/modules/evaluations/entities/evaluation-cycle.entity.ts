import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import type { CycleSettings } from '../../../common/types/jsonb-schemas';

export enum CycleType {
  DEGREE_90 = '90',
  DEGREE_180 = '180',
  DEGREE_270 = '270',
  DEGREE_360 = '360',
}

export enum CycleStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  CLOSED = 'closed',
  CANCELLED = 'cancelled',
}

export enum CyclePeriod {
  QUARTERLY = 'quarterly',
  BIANNUAL = 'biannual',
  ANNUAL = 'annual',
  CUSTOM = 'custom',
}

@Entity('evaluation_cycles')
@Index('idx_cycles_tenant', ['tenantId'])
@Index('idx_cycles_tenant_status', ['tenantId', 'status'])
export class EvaluationCycle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({
    type: 'enum',
    enum: CycleType,
    default: CycleType.DEGREE_90,
  })
  type: CycleType;

  @Column({
    type: 'enum',
    enum: CycleStatus,
    default: CycleStatus.DRAFT,
  })
  status: CycleStatus;

  @Column({
    type: 'enum',
    enum: CyclePeriod,
    default: CyclePeriod.ANNUAL,
  })
  period: CyclePeriod;

  @Column({ type: 'date', name: 'start_date' })
  startDate: Date;

  @Column({ type: 'date', name: 'end_date' })
  endDate: Date;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'uuid', name: 'template_id', nullable: true })
  templateId: string;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @Column({ type: 'jsonb', default: {}, name: 'settings' })
  settings: CycleSettings;

  @Column({ type: 'int', default: 0, name: 'total_evaluated' })
  totalEvaluated: number;

  /**
   * Sprint 1 BR-C.2.1 — Versión del template al momento del launch.
   * Permite trazabilidad: "este ciclo usó la v3 del template X".
   * Se llena automáticamente al ejecutar launchCycle.
   */
  @Column({ type: 'int', name: 'template_version_at_launch', nullable: true })
  templateVersionAtLaunch: number | null;

  /**
   * Sprint 1 BR-C.2.2 — Snapshot completo del template (parent + sub_templates)
   * al momento del launch. Reports y formularios de evaluadores leen de aquí
   * cuando el ciclo está active|closed, NO del template actual (que pudo
   * haberse editado post-launch).
   *
   * Estructura:
   * {
   *   template: { id, name, description, sections, defaultCycleType, ... },
   *   subTemplates: [{ id, relationType, sections, weight, displayOrder, isActive }]
   * }
   */
  @Column({ type: 'jsonb', name: 'template_snapshot', nullable: true })
  templateSnapshot: any;

  /**
   * Sprint 1 BR-C.2.2 — Copia de cycle.settings.weights al lanzar el ciclo.
   * Si el admin edita pesos en el template post-launch, no afectan a este
   * ciclo. Reports leen de este snapshot.
   */
  @Column({ type: 'jsonb', name: 'weights_at_launch', nullable: true })
  weightsAtLaunch: Record<string, number> | null;

  /**
   * Sprint 1 BR-C.2.2 — Timestamp del launch. Útil para audit
   * + filtros temporales en reports cross-cycle.
   */
  @Column({ type: 'timestamptz', name: 'launched_at', nullable: true })
  launchedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
