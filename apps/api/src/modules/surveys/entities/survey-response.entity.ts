import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { EngagementSurvey } from './engagement-survey.entity';

@Entity('survey_responses')
@Index('idx_response_survey', ['surveyId'])
@Index('idx_response_tenant', ['tenantId'])
export class SurveyResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'survey_id' })
  surveyId: string;

  @ManyToOne(() => EngagementSurvey, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'survey_id' })
  survey: EngagementSurvey;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', name: 'respondent_id', nullable: true })
  respondentId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'respondent_id' })
  respondent: User | null;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: 'Snapshot of department at response time' })
  department: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'", comment: '[{ questionId, value }]' })
  answers: Array<{ questionId: string; value: number | string | string[] }>;

  @Column({ type: 'boolean', default: false, name: 'is_complete' })
  isComplete: boolean;

  @Column({ type: 'timestamptz', name: 'submitted_at', nullable: true })
  submittedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
