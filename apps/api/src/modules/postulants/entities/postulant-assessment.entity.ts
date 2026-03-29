import {
  Column, CreateDateColumn, UpdateDateColumn, Entity,
  PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique, Check,
} from 'typeorm';
import { PostulantProcessEntry } from './postulant-process-entry.entity';
import { User } from '../../users/entities/user.entity';
import { Competency } from '../../development/entities/competency.entity';

@Entity('postulant_assessments')
@Unique('uq_pa_entry_evaluator_competency', ['entryId', 'evaluatorId', 'competencyId'])
@Check('chk_pa_score_range', '"score" >= 1 AND "score" <= 10')
export class PostulantAssessment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'entry_id' })
  entryId: string;

  @ManyToOne(() => PostulantProcessEntry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entry_id' })
  entry: PostulantProcessEntry;

  @Column({ type: 'uuid', name: 'evaluator_id' })
  evaluatorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'evaluator_id' })
  evaluator: User;

  @Column({ type: 'uuid', name: 'competency_id' })
  competencyId: string;

  @ManyToOne(() => Competency)
  @JoinColumn({ name: 'competency_id' })
  competency: Competency;

  @Column({ type: 'int' })
  score: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
