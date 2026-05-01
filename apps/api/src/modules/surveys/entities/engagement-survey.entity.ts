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

/**
 * T3 — Settings tipados de la encuesta. Ver comentario en el campo
 * `settings` de EngagementSurvey para semantica detallada.
 */
export interface SurveySettings {
  showProgressBar?: boolean;
  randomizeQuestions?: boolean;
  allowPartialSave?: boolean;
}

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

  /**
   * T3 — Tipo concreto del jsonb `settings` para el responder.
   *
   * - showProgressBar (default true): muestra barra de progreso en
   *   `responder/page.tsx`. Algunos admin prefieren ocultarla en
   *   encuestas muy cortas para no presionar al respondente.
   * - randomizeQuestions (default false): aleatoriza el orden de las
   *   preguntas DENTRO de cada categoria (preserva agrupamiento visual)
   *   con un seed estable por (surveyId, userId) para que el mismo
   *   respondente vea siempre el mismo orden si recarga.
   * - allowPartialSave (default false): habilita guardar respuestas a
   *   medias en el servidor. Solo aplica a encuestas NO anonimas — en
   *   anonimas no se persiste nada server-side hasta que el respondente
   *   submitea (en T10 se manejara via localStorage).
   *
   * Cualquier campo no listado se ignora. La forma se valida en el
   * service antes de persistir (sanitizeSettings).
   */
  @Column({ type: 'jsonb', default: () => "'{}'", comment: '{ allowPartialSave, showProgressBar, randomizeQuestions }' })
  settings: SurveySettings;

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
