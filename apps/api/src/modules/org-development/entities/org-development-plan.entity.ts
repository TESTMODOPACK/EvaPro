import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { OrgDevelopmentInitiative } from './org-development-initiative.entity';

export enum OrgPlanStatus {
  DRAFT = 'borrador',
  ACTIVE = 'activo',
  COMPLETED = 'completado',
  CANCELLED = 'cancelado',
}

@Entity('org_development_plans')
@Index('idx_org_dev_plans_tenant', ['tenantId'])
export class OrgDevelopmentPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int' })
  year: number;

  @Column({ type: 'varchar', length: 30, default: OrgPlanStatus.DRAFT })
  status: string;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @OneToMany(() => OrgDevelopmentInitiative, (i) => i.plan, { cascade: true })
  initiatives: OrgDevelopmentInitiative[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
