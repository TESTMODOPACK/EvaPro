import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { EvaluationCycle } from '../../evaluations/entities/evaluation-cycle.entity';
import { DevelopmentAction } from './development-action.entity';
import { DevelopmentComment } from './development-comment.entity';

@Entity('development_plans')
@Index('idx_devplan_tenant_user', ['tenantId', 'userId'])
export class DevelopmentPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @Column({ type: 'uuid', name: 'cycle_id', nullable: true })
  cycleId: string | null;

  @ManyToOne(() => EvaluationCycle, { nullable: true })
  @JoinColumn({ name: 'cycle_id' })
  cycle: EvaluationCycle | null;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 30, default: 'borrador' })
  status: string; // borrador | activo | en_revision | completado | cancelado

  @Column({ type: 'varchar', length: 20, default: 'media' })
  priority: string; // alta | media | baja

  @Column({ type: 'date', name: 'start_date' })
  startDate: Date;

  @Column({ type: 'date', name: 'target_date' })
  targetDate: Date;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  progress: number;

  @OneToMany(() => DevelopmentAction, (a) => a.plan, { cascade: true })
  actions: DevelopmentAction[];

  @OneToMany(() => DevelopmentComment, (c) => c.plan, { cascade: true })
  comments: DevelopmentComment[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
