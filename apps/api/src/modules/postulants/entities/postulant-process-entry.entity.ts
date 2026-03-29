import {
  Column, CreateDateColumn, UpdateDateColumn, Entity,
  PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique,
} from 'typeorm';
import { PostulantProcess } from './postulant-process.entity';
import { Postulant } from './postulant.entity';

export enum PostulantEntryStatus {
  APPLIED = 'applied',
  EVALUATING = 'evaluating',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  HIRED = 'hired',
}

@Entity('postulant_process_entries')
@Unique('uq_ppe_process_postulant', ['processId', 'postulantId'])
export class PostulantProcessEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'process_id' })
  processId: string;

  @ManyToOne(() => PostulantProcess, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'process_id' })
  process: PostulantProcess;

  @Column({ type: 'uuid', name: 'postulant_id' })
  postulantId: string;

  @ManyToOne(() => Postulant)
  @JoinColumn({ name: 'postulant_id' })
  postulant: Postulant;

  @Column({ type: 'enum', enum: PostulantEntryStatus, default: PostulantEntryStatus.APPLIED })
  status: PostulantEntryStatus;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'final_score', nullable: true })
  finalScore: number | null;

  @Column({ type: 'text', name: 'status_notes', nullable: true })
  statusNotes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
