import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { OrgDevelopmentInitiative } from './org-development-initiative.entity';

@Entity('org_development_actions')
export class OrgDevelopmentAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'initiative_id' })
  initiativeId: string;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'varchar', length: 50, default: 'otro' })
  actionType: string;

  @Column({ type: 'varchar', length: 30, default: 'pendiente' })
  status: string;

  @Column({ type: 'date', name: 'due_date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'uuid', name: 'assigned_to_id', nullable: true })
  assignedToId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @ManyToOne(() => OrgDevelopmentInitiative, (i) => i.actions)
  @JoinColumn({ name: 'initiative_id' })
  initiative: OrgDevelopmentInitiative;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assigned_to_id' })
  assignedTo: User | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
