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
import { User } from '../../users/entities/user.entity';
import { EngagementSurvey } from './engagement-survey.entity';

@Entity('survey_assignments')
@Unique('uq_survey_assignment', ['surveyId', 'userId'])
@Index('idx_assignment_survey', ['surveyId'])
export class SurveyAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'survey_id' })
  surveyId: string;

  @ManyToOne(() => EngagementSurvey, (s) => s.assignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'survey_id' })
  survey: EngagementSurvey;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 20, default: 'pending', comment: 'pending | completed' })
  status: string;

  @Column({ type: 'int', default: 0, name: 'reminder_count' })
  reminderCount: number;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
