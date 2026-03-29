import {
  Column, CreateDateColumn, Entity,
  PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique,
} from 'typeorm';
import { PostulantProcess } from './postulant-process.entity';
import { User } from '../../users/entities/user.entity';

@Entity('postulant_process_evaluators')
@Unique('uq_ppe_process_evaluator', ['processId', 'evaluatorId'])
export class PostulantProcessEvaluator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'process_id' })
  processId: string;

  @ManyToOne(() => PostulantProcess, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'process_id' })
  process: PostulantProcess;

  @Column({ type: 'uuid', name: 'evaluator_id' })
  evaluatorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'evaluator_id' })
  evaluator: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
