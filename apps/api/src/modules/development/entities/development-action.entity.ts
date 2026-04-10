import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { DevelopmentPlan } from './development-plan.entity';
import { Competency } from './competency.entity';

@Entity('development_actions')
@Index('idx_devaction_plan', ['tenantId', 'planId'])
@Index('idx_devaction_plan_status', ['planId', 'status'])
export class DevelopmentAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'plan_id' })
  planId: string;

  @ManyToOne(() => DevelopmentPlan, (p) => p.actions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan: DevelopmentPlan;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 50, name: 'action_type', default: 'otro' })
  actionType: string; // curso | mentoring | rotacion | proyecto | lectura | taller | otro

  @Column({ type: 'uuid', name: 'competency_id', nullable: true })
  competencyId: string | null;

  @ManyToOne(() => Competency, { nullable: true })
  @JoinColumn({ name: 'competency_id' })
  competency: Competency | null;

  @Column({ type: 'varchar', length: 30, default: 'pendiente' })
  status: string; // pendiente | en_progreso | completada | cancelada

  @Column({ type: 'varchar', length: 20, default: 'media' })
  priority: string; // alta | media | baja

  @Column({ type: 'date', name: 'due_date', nullable: true })
  dueDate: Date | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  evidence: string | null; // URL to evidence/certificate

  @Column({ type: 'varchar', length: 200, name: 'evidence_name', nullable: true })
  evidenceName: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
