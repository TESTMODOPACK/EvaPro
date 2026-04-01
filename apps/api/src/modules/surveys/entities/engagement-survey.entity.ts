import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { SurveyQuestion } from './survey-question.entity';
import { SurveyAssignment } from './survey-assignment.entity';

@Entity('engagement_surveys')
@Index('idx_survey_tenant', ['tenantId'])
@Index('idx_survey_status', ['tenantId', 'status'])
export class EngagementSurvey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 20, default: 'draft', comment: 'draft | active | closed' })
  status: string;

  @Column({ type: 'boolean', default: true, name: 'is_anonymous' })
  isAnonymous: boolean;

  @Column({ type: 'varchar', length: 20, default: 'all', name: 'target_audience', comment: 'all | by_department | custom' })
  targetAudience: string;

  @Column({ type: 'jsonb', name: 'target_departments', default: () => "'[]'" })
  targetDepartments: string[];

  @Column({ type: 'timestamptz', name: 'start_date' })
  startDate: Date;

  @Column({ type: 'timestamptz', name: 'end_date' })
  endDate: Date;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @Column({ type: 'jsonb', default: () => "'{}'", comment: '{ allowPartialSave, showProgressBar, randomizeQuestions }' })
  settings: Record<string, any>;

  @Column({ type: 'int', default: 0, name: 'response_count' })
  responseCount: number;

  @OneToMany(() => SurveyQuestion, (q) => q.survey, { cascade: true })
  questions: SurveyQuestion[];

  @OneToMany(() => SurveyAssignment, (a) => a.survey)
  assignments: SurveyAssignment[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
