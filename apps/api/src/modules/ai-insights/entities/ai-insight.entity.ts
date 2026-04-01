import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';

export enum InsightType {
  SUMMARY = 'summary',
  BIAS = 'bias',
  SUGGESTIONS = 'suggestions',
  FLIGHT_RISK = 'flight_risk',
  SURVEY_ANALYSIS = 'survey_analysis',
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

  @Column({ type: 'uuid', name: 'cycle_id' })
  cycleId: string;

  @Column({ type: 'jsonb', default: {} })
  content: any;

  @Column({ type: 'varchar', length: 100, default: 'claude-haiku-4-5' })
  model: string;

  @Column({ type: 'int', name: 'tokens_used', default: 0 })
  tokensUsed: number;

  @Column({ type: 'uuid', name: 'generated_by' })
  generatedBy: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
