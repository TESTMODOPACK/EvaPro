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
  /**
   * S3.x — Estado terminal para candidatos NO contratados cuando otro
   * gano el proceso. Se setea automaticamente en hireCandidate sobre
   * todos los demas candidatos del proceso (excepto los ya REJECTED).
   * Diferente de REJECTED: este es el outcome de "no fue elegido pero
   * no fue rechazado activamente"; util para reportes de movilidad
   * (medir cuantos finalistas quedaron sin contratar).
   */
  NOT_HIRED = 'not_hired',
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
  @Column({ type: 'text', name: 'cv_url', nullable: true, comment: 'Base64 data URL del CV activo. Al cerrar proceso se mueve a cv_url_archived (compliance Chile 24m).' })
  cvUrl: string | null;

  @Column({ type: 'jsonb', name: 'cv_analysis', nullable: true })
  cvAnalysis: any | null;

  /**
   * S4.2 — Compliance Chile: el CV de un candidato debe conservarse
   * 24 meses tras el cierre del proceso (Ley 19.628 + DT 19.628 sobre
   * datos personales en procesos de seleccion). Antes de S4 borraban
   * `cv_url` al cerrar — esto rompia compliance.
   *
   * Nuevo flow al cerrar/completar proceso:
   *   1. Mover cv_url → cv_url_archived
   *   2. Setear cv_archived_at = NOW()
   *   3. Setear cv_url = NULL (oculto en UI activa)
   *
   * Cron `purgeArchivedCvs` (en recruitment.service) borra archived
   * cuando han pasado 24 meses desde cv_archived_at. Ese paso ya es
   * deletion permanente — el dato ya cumplio retencion legal.
   *
   * `select: false` para que las queries default NO lo traigan:
   *   - Es PII bajo retencion (no debe estar en vistas activas).
   *   - Es base64 ~1MB+ (payload bloat enorme en list endpoints).
   * El acceso explicito requiere addSelect('candidate.cvUrlArchived')
   * en el QueryBuilder, reservado a auditorias admin.
   */
  @Column({ type: 'text', name: 'cv_url_archived', nullable: true, select: false, comment: 'CV archivado tras cierre de proceso. Se purga a los 24m por cron.' })
  cvUrlArchived: string | null;

  @Column({ type: 'timestamptz', name: 'cv_archived_at', nullable: true })
  cvArchivedAt: Date | null;

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
