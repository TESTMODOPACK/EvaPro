import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { EvaluationCycle } from './evaluation-cycle.entity';
import { User } from '../../users/entities/user.entity';
import { RelationType } from './evaluation-assignment.entity';

@Entity('peer_assignments')
@Unique('uq_peer_assignment', ['cycleId', 'evaluateeId', 'evaluatorId', 'relationType'])
@Index('idx_peer_assignments_cycle', ['cycleId'])
export class PeerAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'cycle_id' })
  cycleId: string;

  @ManyToOne(() => EvaluationCycle)
  @JoinColumn({ name: 'cycle_id' })
  cycle: EvaluationCycle;

  @Column({ type: 'uuid', name: 'evaluatee_id' })
  evaluateeId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'evaluatee_id' })
  evaluatee: User;

  @Column({ type: 'uuid', name: 'evaluator_id' })
  evaluatorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'evaluator_id' })
  evaluator: User;

  @Column({
    type: 'enum',
    enum: RelationType,
    name: 'relation_type',
    default: RelationType.PEER,
  })
  relationType: RelationType;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
