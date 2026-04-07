import {
  Column, CreateDateColumn, UpdateDateColumn, Entity,
  PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique,
} from 'typeorm';
import { RecruitmentCandidate } from './recruitment-candidate.entity';
import { User } from '../../users/entities/user.entity';

@Entity('recruitment_interviews')
@Unique('uq_recruitment_interview', ['candidateId', 'evaluatorId'])
export class RecruitmentInterview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'candidate_id' })
  candidateId: string;

  @ManyToOne(() => RecruitmentCandidate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'candidate_id' })
  candidate: RecruitmentCandidate;

  @Column({ type: 'uuid', name: 'evaluator_id' })
  evaluatorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'evaluator_id' })
  evaluator: User;

  @Column({ type: 'jsonb', name: 'requirement_checks', default: () => "'[]'" })
  requirementChecks: Array<{ category: string; text: string; status: string; comment?: string }>;

  @Column({ type: 'text', nullable: true })
  comments: string | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'global_score', nullable: true })
  globalScore: number | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'manual_score', nullable: true, comment: 'Puntuación manual del evaluador (1-10)' })
  manualScore: number | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
