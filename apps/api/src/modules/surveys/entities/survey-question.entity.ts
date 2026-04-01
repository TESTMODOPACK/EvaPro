import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { EngagementSurvey } from './engagement-survey.entity';

@Entity('survey_questions')
@Index('idx_question_survey', ['surveyId'])
export class SurveyQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'survey_id' })
  surveyId: string;

  @ManyToOne(() => EngagementSurvey, (s) => s.questions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'survey_id' })
  survey: EngagementSurvey;

  @Column({ type: 'varchar', length: 100 })
  category: string;

  @Column({ type: 'varchar', length: 500, name: 'question_text' })
  questionText: string;

  @Column({ type: 'varchar', length: 20, name: 'question_type', comment: 'likert_5 | open_text | multiple_choice | nps' })
  questionType: string;

  @Column({ type: 'jsonb', nullable: true, comment: 'Options for multiple_choice questions' })
  options: string[] | null;

  @Column({ type: 'boolean', default: true, name: 'is_required' })
  isRequired: boolean;

  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder: number;
}
