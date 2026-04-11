import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToOne,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { EvaluationAssignment } from './evaluation-assignment.entity';
import type { EvaluationAnswers } from '../../../common/types/jsonb-schemas';

@Entity('evaluation_responses')
@Index('idx_eval_response_tenant', ['tenantId'])
export class EvaluationResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'assignment_id', unique: true })
  assignmentId: string;

  @OneToOne(() => EvaluationAssignment)
  @JoinColumn({ name: 'assignment_id' })
  assignment: EvaluationAssignment;

  /** { "q1": 4, "q2": "texto libre", "q3": ["opA", "opC"] } */
  @Column({ type: 'jsonb', default: {} })
  answers: EvaluationAnswers;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, name: 'overall_score' })
  overallScore: number | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'submitted_at' })
  submittedAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
