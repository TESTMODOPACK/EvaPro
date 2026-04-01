import {
  Column, CreateDateColumn, UpdateDateColumn, Entity,
  PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique, Index,
} from 'typeorm';
import { PostulantProcessEntry } from './postulant-process-entry.entity';
import { User } from '../../users/entities/user.entity';

@Entity('postulant_requirement_checks')
@Unique('uq_req_check', ['entryId', 'evaluatorId', 'requirement'])
@Index('idx_req_check_entry', ['entryId'])
export class PostulantRequirementCheck {
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

  @Column({ type: 'varchar', length: 500 })
  requirement: string;

  @Column({ type: 'varchar', length: 20, default: 'pendiente', comment: 'cumple | no_cumple | parcial | pendiente' })
  status: string;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
