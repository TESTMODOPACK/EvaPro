import {
  Column, CreateDateColumn, Entity,
  PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique,
} from 'typeorm';
import { RecruitmentProcess } from './recruitment-process.entity';
import { User } from '../../users/entities/user.entity';

@Entity('recruitment_evaluators')
@Unique('uq_recruitment_evaluator', ['processId', 'evaluatorId'])
export class RecruitmentEvaluator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'process_id' })
  processId: string;

  @ManyToOne(() => RecruitmentProcess, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'process_id' })
  process: RecruitmentProcess;

  @Column({ type: 'uuid', name: 'evaluator_id' })
  evaluatorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'evaluator_id' })
  evaluator: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
