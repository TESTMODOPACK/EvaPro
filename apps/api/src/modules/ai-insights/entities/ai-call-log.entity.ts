import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { AiInsight, InsightType } from './ai-insight.entity';

/**
 * Audit trail de cada llamada al API de Anthropic.
 *
 * **Por qué existe**: hasta ahora el unico tracking era `ai_insights`,
 * que solo se persiste DESPUES de `parseJson(response)`. Cuando Claude
 * devuelve JSON malformado (truncamiento por max_tokens, comillas mal
 * escapadas, prefijos de texto), `parseJson` lanza y el flow aborta —
 * los tokens consumidos en Anthropic NO quedan registrados en eva360.
 *
 * `ai_call_logs` se persiste **antes del parse**, justo despues de que
 * `callClaude` retorna. Esto garantiza:
 *   - Audit trail completo independiente de la calidad del parse
 *   - Billing/quota preciso (counts reales, no derivados del save de
 *     insight)
 *   - Diagnostico de errores: filas con `parseSuccess=false` indican
 *     que prompt rompio (input para mejorar prompts)
 *
 * Relacion con ai_insights:
 *   - 1:0..1 — cada call_log puede tener insight asociado (cuando
 *     parsea OK), o quedar sin insight (parse_success=false)
 *   - El FK `insight_id` se llena via UPDATE despues del save del
 *     insight (en transaction)
 *
 * Tenant-scoped: la columna `tenant_id` es NOT NULL. F4 RLS Fase C
 * cubre esta tabla automaticamente (esta listada en
 * `expected-tenant-tables.ts`).
 */
@Entity('ai_call_logs')
@Index('idx_ai_call_logs_tenant', ['tenantId'])
@Index('idx_ai_call_logs_created', ['createdAt'])
@Index('idx_ai_call_logs_tenant_created', ['tenantId', 'createdAt'])
export class AiCallLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /** Tipo de insight que se intento generar (mismo enum que ai_insights). */
  @Column({ type: 'enum', enum: InsightType })
  type: InsightType;

  /** input_tokens + output_tokens (suma reportada por Anthropic). */
  @Column({ type: 'int', name: 'tokens_used', default: 0 })
  tokensUsed: number;

  /** Tokens de input (prompt) para granularidad de billing. */
  @Column({ type: 'int', name: 'input_tokens', default: 0 })
  inputTokens: number;

  /** Tokens de output (response) para granularidad de billing. */
  @Column({ type: 'int', name: 'output_tokens', default: 0 })
  outputTokens: number;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  /** User que disparo la generacion. */
  @Column({ type: 'uuid', name: 'generated_by' })
  generatedBy: string;

  /**
   * `true` si el parse del JSON respondido por Claude fue exitoso y
   * existe el insight relacionado en `ai_insights` (con FK `insight_id`).
   * `false` si Claude respondio pero el parse fallo — los tokens fueron
   * consumidos igual.
   */
  @Column({ type: 'boolean', name: 'parse_success', default: true })
  parseSuccess: boolean;

  /** Mensaje de error del parse cuando parse_success=false. */
  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  /**
   * FK al insight generado cuando parse_success=true. Null cuando
   * parse_success=false (no se llego a crear insight) o cuando se
   * borro el insight via cascade. ON DELETE SET NULL para preservar
   * el audit trail aunque se borre el insight.
   */
  @Column({ type: 'uuid', name: 'insight_id', nullable: true })
  insightId: string | null;

  @ManyToOne(() => AiInsight, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'insight_id' })
  insight: AiInsight | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
