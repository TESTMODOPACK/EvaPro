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

/**
 * PositionLevel — ADR 0002 / Promotions module.
 *
 * Catálogo de niveles jerárquicos del tenant. Cada cliente define sus
 * propios niveles (ej. Junior, Semi-Senior, Senior, Tech Lead, Manager,
 * Director, VP, C-Level). El `rank` define el orden numérico para que
 * el algoritmo entienda la jerarquía sin depender de strings.
 *
 * Multi-tenant: cada tenant tiene su propio set de levels.
 */
@Entity('position_levels')
@Unique('uq_poslevel_tenant_code', ['tenantId', 'code'])
@Index('idx_poslevel_tenant_rank', ['tenantId', 'rank'])
export class PositionLevel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /** Código corto único dentro del tenant (ej. "JR", "SR", "TL"). */
  @Column({ type: 'varchar', length: 30 })
  code: string;

  /** Nombre legible (ej. "Senior Developer"). */
  @Column({ type: 'varchar', length: 120 })
  name: string;

  /**
   * Rango numérico jerárquico. Más alto = más senior.
   * Ej: 1=Junior, 2=Semi-Senior, 3=Senior, 4=Tech Lead, 5=Manager...
   * Define el orden para career paths (next level = current rank + 1
   * o el siguiente definido en CareerPath).
   */
  @Column({ type: 'int' })
  rank: number;

  /** Descripción opcional del nivel y sus responsabilidades. */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * Family/track del rol (ej. "engineering", "product", "design",
   * "sales"). Permite distinguir tracks paralelos (IC vs management).
   */
  @Column({ type: 'varchar', length: 60, nullable: true })
  family: string | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
