import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';
import type { AiInsightContent } from '../../../common/types/jsonb-schemas';

export enum InsightType {
  SUMMARY = 'summary',
  BIAS = 'bias',
  SUGGESTIONS = 'suggestions',
  FLIGHT_RISK = 'flight_risk',
  SURVEY_ANALYSIS = 'survey_analysis',
  CV_ANALYSIS = 'cv_analysis',
  RECRUITMENT_RECOMMENDATION = 'recruitment_recommendation',
  CYCLE_COMPARISON = 'cycle_comparison',
  /**
   * v3.1 F1 — sugerencias de temas para una Agenda Mágica de 1:1.
   * NO asociado a un ciclo (cycleId null). `scopeEntityId` apunta al
   * checkin.id para dedup/cache.
   */
  AGENDA_SUGGESTIONS = 'agenda_suggestions',
}

@Entity('ai_insights')
@Index('idx_ai_insights_tenant_cycle', ['tenantId', 'cycleId'])
@Index('idx_ai_insights_lookup', ['tenantId', 'cycleId', 'type', 'userId'])
export class AiInsight {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'enum', enum: InsightType })
  type: InsightType;

  @Column({ type: 'uuid', name: 'user_id', nullable: true, comment: 'null para análisis de sesgos (nivel ciclo)' })
  userId: string | null;

  /**
   * v3.1 F1 — cycle_id ahora es NULLABLE. Insights asociados a un ciclo
   * de evaluación (summary, bias, etc.) siguen llenándolo; insights con
   * otro scope (agenda de 1:1, flight risk por user, etc.) usan
   * `scopeEntityId` y dejan `cycleId = null`.
   */
  @Column({ type: 'uuid', name: 'cycle_id', nullable: true })
  cycleId: string | null;

  /**
   * v3.1 F1 — ID del recurso al que refiere este insight cuando NO es un
   * ciclo. Ejemplos de uso: checkin_id para AGENDA_SUGGESTIONS, user_id
   * para FLIGHT_RISK, recruitment_id para CV_ANALYSIS. Indexado
   * partialmente (solo filas con scope_entity_id IS NOT NULL).
   */
  @Column({ type: 'uuid', name: 'scope_entity_id', nullable: true })
  scopeEntityId: string | null;

  @Column({ type: 'jsonb', default: {} })
  content: AiInsightContent;

  @Column({ type: 'varchar', length: 100, default: 'claude-haiku-4-5' })
  model: string;

  @Column({ type: 'int', name: 'tokens_used', default: 0 })
  tokensUsed: number;

  @Column({ type: 'uuid', name: 'generated_by' })
  generatedBy: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
