import {
  Column, CreateDateColumn, UpdateDateColumn, Entity,
  PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index, Unique,
} from 'typeorm';
import { RecruitmentProcess } from './recruitment-process.entity';
import { User } from '../../users/entities/user.entity';

export enum CandidateStage {
  REGISTERED = 'registered',
  CV_REVIEW = 'cv_review',
  INTERVIEWING = 'interviewing',
  SCORED = 'scored',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  HIRED = 'hired',
}

@Entity('recruitment_candidates')
@Index('idx_rc_process', ['processId'])
@Index('idx_rc_tenant', ['tenantId'])
export class RecruitmentCandidate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'process_id' })
  processId: string;

  @ManyToOne(() => RecruitmentProcess, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'process_id' })
  process: RecruitmentProcess;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 20, name: 'candidate_type' })
  candidateType: string;

  // External candidate fields
  @Column({ type: 'varchar', length: 100, name: 'first_name', nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 100, name: 'last_name', nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, name: 'linked_in', nullable: true })
  linkedIn: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  availability: string | null;

  @Column({ type: 'varchar', length: 100, name: 'salary_expectation', nullable: true })
  salaryExpectation: string | null;

  // Internal candidate fields
  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  // Common fields
  @Column({ type: 'text', name: 'cv_url', nullable: true, comment: 'Base64 data URL del CV (se limpia al cerrar proceso)' })
  cvUrl: string | null;

  @Column({ type: 'jsonb', name: 'cv_analysis', nullable: true })
  cvAnalysis: any | null;

  @Column({ type: 'enum', enum: CandidateStage, default: CandidateStage.REGISTERED })
  stage: CandidateStage;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'final_score', nullable: true })
  finalScore: number | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'score_adjustment', nullable: true })
  scoreAdjustment: number | null;

  @Column({ type: 'text', name: 'score_justification', nullable: true })
  scoreJustification: string | null;

  @Column({ type: 'text', name: 'recruiter_notes', nullable: true })
  recruiterNotes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
