import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
  Check,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Position } from '../../tenants/entities/position.entity';
import { Competency } from './competency.entity';

@Entity('role_competencies')
@Index('idx_role_comp_tenant', ['tenantId'])
@Index('idx_role_comp_position', ['tenantId', 'position'])
@Unique('uq_role_comp', ['tenantId', 'position', 'competencyId'])
@Check('chk_expected_level', '"expected_level" >= 1 AND "expected_level" <= 10')
export class RoleCompetency {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 100 })
  position: string;

  @Column({ type: 'uuid', nullable: true, name: 'position_id' })
  @Index('idx_rc_pos_id')
  positionId: string | null;

  @ManyToOne(() => Position, { nullable: true })
  @JoinColumn({ name: 'position_id' })
  positionEntity: Position;

  @Column({ type: 'uuid', name: 'competency_id' })
  competencyId: string;

  @ManyToOne(() => Competency)
  @JoinColumn({ name: 'competency_id' })
  competency: Competency;

  @Column({ type: 'int', name: 'expected_level' })
  expectedLevel: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
