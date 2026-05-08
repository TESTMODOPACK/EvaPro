import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { PositionLevel } from './position-level.entity';

/**
 * CareerPath — ADR 0002 / Promotions module.
 *
 * Mapeo from → to entre PositionLevels que define las trayectorias de
 * promoción válidas. El filtro F6 (existe posición jerárquica superior)
 * usa esta tabla para verificar si hay un siguiente paso natural.
 *
 * Permite trayectorias paralelas: ej. Senior Developer puede ir a
 * Tech Lead (track IC) O a Engineering Manager (track management).
 *
 * Multi-tenant: cada tenant define sus propias trayectorias.
 */
@Entity('career_paths')
@Unique('uq_cpath_tenant_from_to', ['tenantId', 'fromLevelId', 'toLevelId'])
@Index('idx_cpath_tenant_from', ['tenantId', 'fromLevelId'])
export class CareerPath {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'from_level_id' })
  fromLevelId: string;

  @ManyToOne(() => PositionLevel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'from_level_id' })
  fromLevel: PositionLevel;

  @Column({ type: 'uuid', name: 'to_level_id' })
  toLevelId: string;

  @ManyToOne(() => PositionLevel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'to_level_id' })
  toLevel: PositionLevel;

  /**
   * "natural" si es la promoción default; "lateral" si es un movimiento
   * tipo cambio de track (ej. IC → manager). El algoritmo prioriza
   * "natural" pero ofrece "lateral" como alternativa al manager.
   */
  @Column({ type: 'varchar', length: 20, default: 'natural' })
  pathType: string;

  /** Ranking de prioridad cuando hay múltiples paths (1 = primaria). */
  @Column({ type: 'int', default: 1 })
  priority: number;

  /** Descripción opcional del salto (skills, expectativas). */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
