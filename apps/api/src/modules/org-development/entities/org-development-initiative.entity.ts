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
import { User } from '../../users/entities/user.entity';
import { OrgDevelopmentAction } from './org-development-action.entity';
import { OrgDevelopmentPlan } from './org-development-plan.entity';

@Entity('org_development_initiatives')
@Index('idx_org_dev_init_plan', ['tenantId', 'planId'])
export class OrgDevelopmentInitiative {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'plan_id' })
  planId: string;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** null significa que aplica a toda la empresa */
  @Column({ type: 'varchar', length: 100, nullable: true })
  department: string | null;

  @Column({ type: 'varchar', length: 30, default: 'pendiente' })
  status: string;

  @Column({ type: 'date', name: 'target_date', nullable: true })
  targetDate: string | null;

  @Column({ type: 'uuid', name: 'responsible_id', nullable: true })
  responsibleId: string | null;

  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  budget: number | null;

  @Column({ type: 'varchar', length: 10, default: 'UF' })
  currency: string;

  @ManyToOne(() => OrgDevelopmentPlan, (p) => p.initiatives)
  @JoinColumn({ name: 'plan_id' })
  plan: OrgDevelopmentPlan;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'responsible_id' })
  responsible: User | null;

  @OneToMany(() => OrgDevelopmentAction, (a) => a.initiative, { cascade: true })
  actions: OrgDevelopmentAction[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
