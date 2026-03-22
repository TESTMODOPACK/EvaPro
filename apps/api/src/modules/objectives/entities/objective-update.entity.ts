import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Objective } from './objective.entity';
import { User } from '../../users/entities/user.entity';

@Entity('objective_updates')
@Index('idx_obj_updates_objective', ['objectiveId'])
export class ObjectiveUpdate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'objective_id' })
  objectiveId: string;

  @ManyToOne(() => Objective)
  @JoinColumn({ name: 'objective_id' })
  objective: Objective;

  @Column({ type: 'int', name: 'progress_value' })
  progressValue: number;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
