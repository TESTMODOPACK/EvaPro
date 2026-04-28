import { Injectable, NotFoundException, BadRequestException, ServiceUnavailableException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, MoreThan, MoreThanOrEqual, IsNull, In } from 'typeorm';
import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { AiInsight, InsightType } from './entities/ai-insight.entity';
import { AiCallLog } from './entities/ai-call-log.entity';
import { ReportsService } from '../reports/reports.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment, AssignmentStatus } from '../evaluations/entities/evaluation-assignment.entity';
import { User } from '../users/entities/user.entity';
import { Objective } from '../objectives/entities/objective.entity';
import { QuickFeedback } from '../feedback/entities/quick-feedback.entity';
import { Competency } from '../development/entities/competency.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { EvaluationCycle, CycleStatus } from '../evaluations/entities/evaluation-cycle.entity';
import { buildSummaryPrompt } from './prompts/summary.prompt';
import { buildBiasPrompt } from './prompts/bias.prompt';
import { buildSuggestionsPrompt } from './prompts/suggestions.prompt';
import { buildSurveyAnalysisPrompt } from './prompts/survey-analysis.prompt';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { Subscription, SubscriptionStatus } from '../subscriptions/entities/subscription.entity';

const MODEL = 'claude-haiku-4-5-20251001';
const CACHE_DAYS = 7;

/** Sanitize user-provided strings before interpolating into prompts */
function sanitizeForPrompt(input: string): string {
  return input
    .replace(/[{}[\]<>]/g, '') // Remove brackets/braces
    .replace(/\\/g, '')        // Remove backslashes
    .slice(0, 200)             // Limit length
    .trim();
}

@Injectable()
export class AiInsightsService {
  private readonly logger = new Logger(AiInsightsService.name);
  private client: Anthropic | null = null;

  constructor(
    @InjectRepository(AiInsight)
    private readonly insightRepo: Repository<AiInsight>,
    @InjectRepository(AiCallLog)
    private readonly callLogRepo: Repository<AiCallLog>,
    @InjectRepository(EvaluationResponse)
    private readonly responseRepo: Repository<EvaluationResponse>,
    @InjectRepository(EvaluationAssignment)
    private readonly assignmentRepo: Repository<EvaluationAssignment>,
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Objective)
    private readonly objectiveRepo: Repository<Objective>,
    @InjectRepository(QuickFeedback)
    private readonly feedbackRepo: Repository<QuickFeedback>,
    @InjectRepository(Competency)
    private readonly competencyRepo: Repository<Competency>,
    @InjectRepository(TalentAssessment)
    private readonly talentRepo: Repository<TalentAssessment>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    private readonly reportsService: ReportsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
      this.logger.log('Anthropic client initialized');
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set — AI features disabled');
    }
  }

  private ensureClient(): Anthropic {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'La funcionalidad de IA no está disponible. Contacte al administrador para configurar ANTHROPIC_API_KEY.',
      );
    }
    return this.client;
  }

  // ─── Cache helpers ──────────────────────────────────────────────────────

  private async getCached(tenantId: string, type: InsightType, cycleId: string, userId?: string): Promise<AiInsight | null> {
    const cacheDate = new Date();
    cacheDate.setDate(cacheDate.getDate() - CACHE_DAYS);

    return this.insightRepo.findOne({
      where: {
        tenantId, type, cycleId,
        userId: userId || IsNull() as any,
        createdAt: MoreThan(cacheDate),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async getInsight(tenantId: string, type: InsightType, cycleId: string, userId?: string): Promise<AiInsight | null> {
    return this.insightRepo.findOne({
      where: {
        tenantId, type, cycleId,
        userId: userId || IsNull() as any,
      },
      order: { createdAt: 'DESC' },
    });
  }

  /** Force-clear cache for a specific insight type */
  async clearCache(tenantId: string, type: InsightType, cycleId: string, userId?: string): Promise<{ deleted: number }> {
    const result = await this.insightRepo.delete({
      tenantId, type, cycleId,
      userId: userId || IsNull() as any,
    });
    return { deleted: result.affected || 0 };
  }

  /** Get subscription info with plan limit + addon */
  private async getSubscriptionAiInfo(tenantId: string): Promise<{
    planLimit: number; addonCalls: number; addonUsed: number;
    periodStart: Date; periodEnd: Date; subscriptionStartDate: Date | null;
  }> {
    const sub = await this.subscriptionsService.findByTenantId(tenantId);
    if (!sub?.plan) return { planLimit: 0, addonCalls: 0, addonUsed: 0, periodStart: new Date(), periodEnd: new Date(), subscriptionStartDate: null };

    // If plan includes AI_INSIGHTS but maxAiCallsPerMonth is 0/null, use default 100
    const hasAiFeature = (sub.plan.features || []).includes('AI_INSIGHTS');
    let planLimit = sub.plan.maxAiCallsPerMonth ?? 0;
    if (hasAiFeature && planLimit <= 0) planLimit = 100;

    // Addon credits are independent — they persist until exhausted
    const addonCalls = sub.aiAddonCalls || 0;
    const addonUsed = sub.aiAddonUsed || 0; // cumulative addon credits consumed across all periods

    // Period: calculated from subscription start date, rolling monthly
    // Force UTC interpretation for date-only fields (PostgreSQL 'date' type)
    const rawDate = sub.startDate;
    const startDate = rawDate instanceof Date ? rawDate : new Date(rawDate + 'T00:00:00Z');
    const now = new Date();

    // Find the current period start: same day-of-month as subscription start, rolling monthly
    const subDay = startDate.getUTCDate();
    let periodStart: Date;
    let periodEnd: Date;

    // Current month's period start
    const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), subDay));
    if (now >= thisMonthStart) {
      periodStart = thisMonthStart;
      periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, subDay));
    } else {
      periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, subDay));
      periodEnd = thisMonthStart;
    }

    return { planLimit, addonCalls, addonUsed, periodStart, periodEnd, subscriptionStartDate: startDate };
  }

  /** Count AI calls for the current billing period */
  private async getMonthlyCallCount(tenantId: string): Promise<{
    planUsed: number; addonUsed: number; totalUsed: number;
    planLimit: number; addonRemaining: number; totalLimit: number;
    periodStart: Date; periodEnd: Date;
  }> {
    const { planLimit, addonCalls, addonUsed, periodStart, periodEnd } = await this.getSubscriptionAiInfo(tenantId);

    // Count insights created in current period (plan credits)
    // Use MoreThanOrEqual to include insights created at exactly period start
    const periodUsed = await this.insightRepo.count({
      where: { tenantId, createdAt: MoreThanOrEqual(periodStart) },
    });

    // Debug: count ALL insights for this tenant to detect period mismatch
    const totalAllTime = await this.insightRepo.count({ where: { tenantId } });
    if (totalAllTime > 0 && periodUsed === 0) {
      this.logger.warn(`AI period mismatch: tenant=${tenantId.slice(0,8)}, totalAllTime=${totalAllTime}, periodUsed=0, periodStart=${periodStart.toISOString()}, periodEnd=${periodEnd.toISOString()}`);
    }

    // Plan credits used this period (capped at planLimit)
    const planUsed = Math.min(periodUsed, planLimit);
    // If usage exceeds plan limit, the excess comes from addon
    const addonUsedThisPeriod = Math.max(0, periodUsed - planLimit);
    const totalAddonUsed = addonUsed + addonUsedThisPeriod; // historical + this period
    const addonRemaining = Math.max(0, addonCalls - totalAddonUsed);
    const totalUsed = periodUsed;
    const totalLimit = planLimit + addonRemaining;

    this.logger.log(`AI usage: tenant=${tenantId.slice(0,8)}, planUsed=${planUsed}/${planLimit}, addonRemaining=${addonRemaining}/${addonCalls}, total=${totalUsed}/${totalLimit}, period=${periodStart.toISOString().slice(0,10)} to ${periodEnd.toISOString().slice(0,10)}`);
    return { planUsed, addonUsed: totalAddonUsed, totalUsed, planLimit, addonRemaining, totalLimit, periodStart, periodEnd };
  }

  /**
   * Check plan-based monthly rate limit + soft warning al 80%.
   *
   * P2.1 — Hard limit + alerta proactiva:
   *
   *   Antes: rechazaba solo al 100%. El tenant descubría que agotó créditos
   *   cuando una operación IA fallaba mid-user-flow. Frustrante y abrupto.
   *
   *   Ahora:
   *     - >= 80% (y <100%): emite notification WARNING al tenant_admin 1x
   *       por tenant cada 24h (dedup vía query sobre tabla notifications).
   *       NO bloquea la llamada — el usuario puede seguir operando.
   *     - >= 100%: igual que antes (rechaza con 400) + emite notification
   *       EXHAUSTED con la fecha de renovación y link a Mi Suscripción.
   *
   *   Las notifications se dedup con una query sobre la tabla — si ya hay
   *   una del mismo tipo para el mismo tenant en las últimas 24h, skip.
   *   Evita spam al tenant_admin mientras sigue usando IA en el último 20%.
   */
  /**
   * P6 — Cierre de la race window conocida ("1-2 análisis gratis por burst").
   *
   * Wrapper que serializa los AI calls del MISMO tenant usando advisory
   * lock PostgreSQL (session-scoped). Distintos tenants no se bloquean
   * entre sí (keys distintas). Por-tenant, cuando dos requests llegan
   * casi simultáneos, el segundo espera hasta que el primero haya
   * insertado su insight y trackAddonUsage. Así checkRateLimit del
   * segundo ve el count actualizado y rechaza si corresponde.
   *
   * Costo: durante la llamada a Claude (3-10s), otros AI calls del mismo
   * tenant esperan. Aceptable porque los users del mismo tenant rara vez
   * disparan múltiples AI calls en paralelo (admin + manager concurrentes).
   *
   * Mecánica:
   *   - pg_advisory_lock(bigint) es un lock server-wide en PostgreSQL
   *     identificado por un bigint. Si otra connection toma la misma
   *     clave, bloquea hasta que se libere.
   *   - Usamos un queryRunner dedicado para mantener la connection viva
   *     durante toda la vida del lock. Las queries dentro del fn() usan
   *     otras connections del pool, que NO tienen el lock — pero igual
   *     bloquean OTROS callers que intenten tomar la misma clave.
   *   - El lock se libera en el finally, incluso si fn() throws.
   */
  async withAiQuotaLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    // Derivamos un bigint estable desde "ai_quota:tenantId" para usar como
    // clave del advisory lock. Postgres no tiene lock por string nativo;
    // hashtext() es la alternativa built-in pero produce un int32 — para
    // reducir colisiones con otros advisory locks del sistema (si los
    // hubiera) derivamos un int32 propio desde SHA-256.
    const hash = createHash('sha256').update(`ai_quota:${tenantId}`).digest();
    // Tomar los primeros 4 bytes como int32 signed (rango ±2B — colisión
    // extremadamente improbable con ~20 tenants).
    const lockId = hash.readInt32BE(0);

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('SELECT pg_advisory_lock($1)', [lockId]);
      try {
        return await fn();
      } finally {
        // Liberar siempre — aún si fn() throws.
        await runner
          .query('SELECT pg_advisory_unlock($1)', [lockId])
          .catch((err) =>
            this.logger.warn(`pg_advisory_unlock failed for tenant ${tenantId.slice(0, 8)}: ${err?.message}`),
          );
      }
    } finally {
      await runner.release();
    }
  }

  private async checkRateLimit(tenantId: string): Promise<void> {
    const { totalUsed, totalLimit, planLimit, addonRemaining, periodEnd } = await this.getMonthlyCallCount(tenantId);
    if (totalLimit <= 0) {
      throw new BadRequestException(
        'Su plan no incluye informes de IA. Actualice a un plan superior para acceder a esta funcionalidad.',
      );
    }

    // Hard limit al 100% — reject + notification EXHAUSTED (dedup 24h).
    if (totalUsed >= totalLimit) {
      const renewDate = periodEnd.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' });
      // Fire-and-forget — el reject no debe bloquear por falla de notif.
      this.notifyAiQuota(tenantId, 'exhausted', { totalUsed, totalLimit, planLimit, addonRemaining, renewDate })
        .catch((err) => this.logger.warn(`notifyAiQuota(exhausted) failed: ${err?.message}`));
      throw new BadRequestException(
        `Se alcanzó el límite de ${totalLimit} informes de IA (${planLimit} del plan + ${addonRemaining} adicionales). El límite del plan se renueva el ${renewDate}. Puede adquirir créditos adicionales desde Mi Suscripción.`,
      );
    }

    // Soft warning al 80% — notification WARNING (dedup 24h). No bloquea.
    const utilization = totalUsed / totalLimit;
    if (utilization >= 0.8) {
      this.notifyAiQuota(tenantId, 'warning', { totalUsed, totalLimit, planLimit, addonRemaining, renewDate: periodEnd.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' }) })
        .catch((err) => this.logger.warn(`notifyAiQuota(warning) failed: ${err?.message}`));
    }
  }

  /**
   * Emite notification in-app al tenant_admin sobre el estado de la cuota
   * IA. Dedup: si hay otra del mismo tipo en las últimas 24h, skip.
   *
   * Fire-and-forget — no debe bloquear el flujo principal si falla.
   */
  private async notifyAiQuota(
    tenantId: string,
    kind: 'warning' | 'exhausted',
    ctx: { totalUsed: number; totalLimit: number; planLimit: number; addonRemaining: number; renewDate: string },
  ): Promise<void> {
    // Import lazy del NotificationType y Notification repo del notifications module.
    // Evita tener que agregar Notification entity al constructor de este service.
    const notifType = kind === 'warning' ? 'ai_quota_warning' : 'ai_quota_exhausted';

    // Buscar admins del tenant (destinatarios).
    const admins = await this.userRepo.find({
      where: { tenantId, role: 'tenant_admin', isActive: true },
      select: ['id'],
    });
    if (admins.length === 0) return;

    // Dedup: skip si ya hay una notification del mismo tipo para cualquiera
    // de estos admins en las últimas 24h. Usamos la tabla via manager para
    // evitar agregar NotificationRepo al constructor.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await this.userRepo.manager.getRepository('notifications').findOne({
      where: {
        tenantId,
        userId: In(admins.map((a) => a.id)),
        type: notifType,
        createdAt: MoreThan(since),
      } as any,
    });
    if (existing) return;

    // Crear una notification por admin.
    const title = kind === 'warning'
      ? `Has usado el 80% de tu cuota IA del mes`
      : `Se agotó tu cuota IA del mes`;
    const message = kind === 'warning'
      ? `Llevas ${ctx.totalUsed} de ${ctx.totalLimit} informes usados (${ctx.planLimit} del plan + ${ctx.addonRemaining} adicionales). La cuota se renueva el ${ctx.renewDate}. Si necesitas más, puedes adquirir créditos desde Mi Suscripción.`
      : `Usaste los ${ctx.totalLimit} informes incluidos (${ctx.planLimit} del plan + ${ctx.addonRemaining} adicionales). La cuota se renueva el ${ctx.renewDate}. Mientras tanto, puedes adquirir créditos adicionales desde Mi Suscripción.`;

    for (const admin of admins) {
      await this.notificationsService.create({
        tenantId,
        userId: admin.id,
        type: notifType as any,
        title,
        message,
        metadata: {
          totalUsed: ctx.totalUsed,
          totalLimit: ctx.totalLimit,
          planLimit: ctx.planLimit,
          addonRemaining: ctx.addonRemaining,
          renewDate: ctx.renewDate,
        } as any,
      }).catch((err) => this.logger.warn(`create notification failed for admin ${admin.id}: ${err?.message}`));
    }
  }

  /**
   * After saving an insight, check if an addon credit was consumed and
   * increment the counter.
   *
   * P1.5 — Fix de race condition:
   *
   *   Antes: `count` + `increment` eran 2 queries separadas. Dos requests
   *   paralelos podían ambos leer `periodUsed > planLimit` y ambos
   *   incrementar → `aiAddonUsed` avanzaba 2x por 1 crédito consumido
   *   real. **Revenue leak**: el tenant consume N análisis pero el counter
   *   cree que gastó 2N — al final del período se factura más de lo debido.
   *
   *   Ahora: UPDATE atómico con guard `addon_used < (periodUsed - planLimit)`.
   *   Si dos requests paralelos tratan de registrar el mismo crédito, solo
   *   el primero pasa el WHERE; el segundo ve que el contador ya refleja
   *   ese crédito y es no-op. No hay over-count.
   *
   *   Gap menor que queda: si 2 requests llegan al mismo tiempo y ambos
   *   pasan `checkRateLimit` (porque ven count < limit antes de que el
   *   primero inserte el insight), ambos pueden crear insight → 1 análisis
   *   "extra" gratuito por cada burst concurrente. Para cerrarlo haría
   *   falta envolver check+insert+track en advisory lock por-tenant, que
   *   es un refactor de 7 callers. Queda como P2 si el costo real lo
   *   justifica (por ahora: 1-2 análisis gratis por burst es despreciable).
   */
  private async trackAddonUsage(tenantId: string): Promise<void> {
    try {
      const { planLimit, periodStart } = await this.getSubscriptionAiInfo(tenantId);
      if (planLimit <= 0) return;

      // Count CALLS in current period (lee de ai_call_logs, source-of-truth
      // del uso real). Antes leia de ai_insights, pero esa tabla solo se
      // persistia con parse exitoso → undercounting cuando Claude devolvia
      // JSON malformado. Ahora cada llamada al API queda registrada en
      // ai_call_logs aunque parseJson falle.
      const periodUsed = await this.callLogRepo.count({
        where: { tenantId, createdAt: MoreThan(periodStart) },
      });

      // Si el uso excede el límite del plan, el último call consumió un
      // crédito del addon. UPDATE atómico con guard: solo incrementa si
      // el counter actual todavía NO cubre este excedente (anti-race).
      if (periodUsed > planLimit) {
        const expectedAddonThisPeriod = periodUsed - planLimit;
        const result = await this.subscriptionRepo
          .createQueryBuilder()
          .update()
          .set({ aiAddonUsed: () => '"ai_addon_used" + 1' })
          .where('tenant_id = :tid', { tid: tenantId })
          .andWhere('status IN (:...statuses)', {
            statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL],
          })
          .andWhere('ai_addon_used < :threshold', { threshold: expectedAddonThisPeriod })
          .execute();
        if ((result.affected ?? 0) > 0) {
          this.logger.log(
            `Addon credit consumed: tenant=${tenantId.slice(0, 8)}, periodUsed=${periodUsed}, planLimit=${planLimit}`,
          );
        } else {
          // Otro trackAddonUsage concurrente ya contabilizó este crédito.
          this.logger.log(
            `Addon credit already tracked by concurrent request: tenant=${tenantId.slice(0, 8)}`,
          );
        }
      }
    } catch (err) {
      // Non-critical — log but don't fail the AI call
      this.logger.warn(`Failed to track addon usage: ${err.message}`);
    }
  }

  /** @deprecated Weekly per-user limits removed. Use checkRateLimit (monthly org-wide) only. */
  private async checkWeeklyRoleLimit(_tenantId: string, _generatedBy: string): Promise<void> {
    // No-op: quota is now org-wide monthly only, controlled by the subscription plan.
    // Kept as stub to avoid breaking callers; will be cleaned up later.
  }

  private async callClaude(
    prompt: string,
    maxTokens = 2000,
  ): Promise<{ text: string; tokensUsed: number; inputTokens: number; outputTokens: number }> {
    const client = this.ensureClient();

    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      const text = textBlock ? textBlock.text : '';
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;
      const tokensUsed = inputTokens + outputTokens;

      return { text, tokensUsed, inputTokens, outputTokens };
    } catch (error: any) {
      this.logger.error(`Anthropic API error: ${error.message}`, error.stack);

      if (error.status === 429) {
        throw new BadRequestException('Límite de solicitudes alcanzado en la API de IA. Espere unos minutos e intente de nuevo.');
      }
      if (error.status === 401) {
        throw new ServiceUnavailableException('Error de autenticación con la API de IA. Verifique la configuración de ANTHROPIC_API_KEY.');
      }
      if (error.status === 529 || error.message?.includes('overloaded')) {
        throw new ServiceUnavailableException('El servicio de IA está temporalmente sobrecargado. Intente en unos minutos.');
      }
      throw new BadRequestException(`Error al comunicarse con la IA: ${error.message || 'Error desconocido'}`);
    }
  }

  /**
   * Helper centralizado para los 8 paths que llaman a Claude y persisten
   * un insight. Encapsula el patron:
   *
   *   1. callClaude(prompt) → consume tokens en Anthropic
   *   2. parseJson(text) → puede LANZAR si Claude devolvio JSON malformado
   *   3. save AiInsight (solo si parse OK)
   *   4. **SIEMPRE** persistir AiCallLog (audit trail independiente del parse)
   *
   * Si parseJson falla:
   *   - El insight NO se persiste (content invalido)
   *   - El call_log SI se persiste con `parseSuccess=false` y `errorMessage`
   *   - Se lanza BadRequestException para que el caller falle visiblemente
   *
   * Esto asegura que TODOS los tokens consumidos quedan trackeados en
   * `ai_call_logs` aunque el parse haya fallado — fix del bug donde
   * `getAiUsageLog` mostraba 0 ejecuciones a pesar de N+ usos en el
   * dashboard de Anthropic.
   *
   * @param opts.tenantId — tenant que dispara la generacion
   * @param opts.type — InsightType.SUMMARY, BIAS, etc.
   * @param opts.generatedBy — userId que disparo
   * @param opts.prompt — prompt completo a enviar a Claude
   * @param opts.maxTokens — limite de output (default 2000)
   * @param opts.buildInsightFields — funcion que retorna los campos
   *   especificos del insight (userId, cycleId, scopeEntityId, etc.)
   *   en base al `content` parseado. Solo se llama si parse OK.
   */
  private async callClaudeAndPersistInsight(opts: {
    tenantId: string;
    type: InsightType;
    generatedBy: string;
    prompt: string;
    maxTokens?: number;
    /** Transforma el JSON parseado al `content` que se persiste. Default: identidad. */
    buildContent?: (parsed: any) => any;
    /** Campos extra del AiInsight (userId, cycleId, scopeEntityId). */
    buildInsightFields: (content: any) => Partial<AiInsight>;
  }): Promise<AiInsight> {
    const { text, tokensUsed, inputTokens, outputTokens } = await this.callClaude(
      opts.prompt,
      opts.maxTokens,
    );

    let parseSuccess = true;
    let parseError: string | null = null;
    let parsed: any = null;
    let finalContent: any = null;
    try {
      parsed = this.parseJson(text);
      finalContent = opts.buildContent ? opts.buildContent(parsed) : parsed;
    } catch (err: any) {
      parseSuccess = false;
      parseError = (err?.message ?? String(err)).slice(0, 1000);
    }

    let savedInsight: AiInsight | null = null;
    if (parseSuccess && finalContent) {
      const extraFields = opts.buildInsightFields(finalContent);
      const insight = this.insightRepo.create({
        ...extraFields,
        tenantId: opts.tenantId,
        type: opts.type,
        content: finalContent,
        model: MODEL,
        tokensUsed,
        generatedBy: opts.generatedBy,
      });
      savedInsight = await this.insightRepo.save(insight);
    }

    // Persistir audit trail SIEMPRE (parseSuccess true o false).
    try {
      await this.callLogRepo.save(
        this.callLogRepo.create({
          tenantId: opts.tenantId,
          type: opts.type,
          generatedBy: opts.generatedBy,
          tokensUsed,
          inputTokens,
          outputTokens,
          model: MODEL,
          parseSuccess,
          errorMessage: parseError,
          insightId: savedInsight?.id ?? null,
        }),
      );
    } catch (logErr: any) {
      // No critico — log pero no rompemos el flow. El insight se persistio (si
      // parse OK) o el caller va a recibir el error de parse.
      this.logger.warn(`Failed to persist ai_call_log: ${logErr?.message ?? logErr}`);
    }

    if (!parseSuccess) {
      throw new BadRequestException(
        'La IA no pudo generar un informe estructurado. Intente nuevamente.',
      );
    }
    return savedInsight!;
  }

  private parseJson(text: string): any {
    // Remove markdown fences if present (```json ... ``` or ``` ... ```)
    let cleaned = text
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    // If the AI wrapped the JSON in extra escaping (e.g., returned a
    // string-escaped JSON instead of raw JSON), unescape it first.
    // This happens when Claude puts the JSON inside a string literal.
    if (cleaned.includes('\\"') && !cleaned.startsWith('"')) {
      try {
        const unescaped = cleaned
          .replace(/\\"/g, '"')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\\\/g, '\\');
        const parsed = JSON.parse(unescaped);
        if (typeof parsed === 'object') return parsed;
      } catch { /* not a double-escaped string, continue */ }
    }

    // Try direct parse first
    try {
      return JSON.parse(cleaned);
    } catch (_e) {
      // Fallback: extract JSON from text (find first { to last })
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const extracted = cleaned.substring(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(extracted);
        } catch (_e2) {
          // Fix common Claude issues:
          // - Trailing commas before } or ]
          // - Control characters (\n inside strings that aren't escaped)
          // - Comments (// or /* */)
          const fixed = extracted
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']')
            .replace(/\/\/[^\n]*/g, '')  // Remove single-line comments
            .replace(/\/\*[\s\S]*?\*\//g, '')  // Remove multi-line comments
            .replace(/[\x00-\x1F\x7F]/g, (ch) => {
              // Preserve \n \r \t inside strings (will be handled by JSON.parse)
              if (ch === '\n' || ch === '\r' || ch === '\t') return ch;
              return ''; // Strip other control chars
            });
          try {
            return JSON.parse(fixed);
          } catch (_e3) {
            // Try one more time: replace newlines inside strings
            const aggressive = fixed.replace(
              /"([^"]*?)"/g,
              (_, content) => `"${content.replace(/\n/g, ' ').replace(/\r/g, '')}"`,
            );
            try {
              return JSON.parse(aggressive);
            } catch (_e4) {
              // Last resort failed
            }
          }
        }
      }
      this.logger.error('Failed to parse AI response (first 500 chars): ' + cleaned.slice(0, 500));
      this.logger.error('Response length: ' + cleaned.length + ', starts with: ' + JSON.stringify(cleaned.slice(0, 50)));
      throw new BadRequestException('La IA no pudo generar un informe estructurado. Intente nuevamente.');
    }
  }

  // ─── 3.2: Summary ──────────────────────────────────────────────────────

  async generateSummary(tenantId: string, cycleId: string, userId: string, generatedBy: string): Promise<AiInsight> {
    return this.withAiQuotaLock(tenantId, async () => {
    await this.checkRateLimit(tenantId);
    await this.checkWeeklyRoleLimit(tenantId, generatedBy);

    const cached = await this.getCached(tenantId, InsightType.SUMMARY, cycleId, userId);
    if (cached) return cached;

    const user = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Colaborador no encontrado');

    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });
    if (!cycle) throw new NotFoundException('Ciclo no encontrado');

    const [individualResults, competencyRadar, selfVsOthers] = await Promise.all([
      this.reportsService.individualResults(cycleId, userId, tenantId),
      this.reportsService.competencyRadar(cycleId, userId, tenantId),
      this.reportsService.selfVsOthers(cycleId, userId, tenantId),
    ]);

    const textResponses = await this.getTextResponses(tenantId, cycleId, userId);

    const prompt = buildSummaryPrompt({
      employeeName: sanitizeForPrompt(`${user.firstName} ${user.lastName}`),
      position: sanitizeForPrompt(user.position || ''),
      department: sanitizeForPrompt(user.department || ''),
      cycleName: sanitizeForPrompt(cycle.name),
      individualResults,
      competencyRadar,
      selfVsOthers,
      textResponses: textResponses.map((t) => sanitizeForPrompt(t)),
    });

    const saved = await this.callClaudeAndPersistInsight({
      tenantId,
      type: InsightType.SUMMARY,
      generatedBy,
      prompt,
      buildInsightFields: (content) => {
        // Validate response structure (warn-only, no throw)
        if (!content.executiveSummary && !content.resumenEjecutivo && !content.fortalezas && !content.strengths) {
          this.logger.warn('AI returned unexpected summary structure, saving as-is');
        }
        return { userId, cycleId };
      },
    });

    await this.trackAddonUsage(tenantId);

    try {
      await this.notificationsService.create({
        tenantId, userId: generatedBy, type: NotificationType.AI_ANALYSIS_READY,
        title: 'Resumen IA generado',
        message: `El resumen de IA para ${user.firstName} ${user.lastName} está listo`,
        metadata: { insightId: saved.id, cycleId, targetUserId: userId },
      });
    } catch (e) {
      this.logger.warn(`Failed to send notification: ${e.message}`);
    }

    return saved;
    }); // ← cierra withAiQuotaLock
  }

  // ─── 3.3: Bias Detection ───────────────────────────────────────────────

  async analyzeBias(tenantId: string, cycleId: string, generatedBy: string): Promise<AiInsight> {
    return this.withAiQuotaLock(tenantId, async () => {
    await this.checkRateLimit(tenantId);
    await this.checkWeeklyRoleLimit(tenantId, generatedBy);

    const cached = await this.getCached(tenantId, InsightType.BIAS, cycleId);
    if (cached) return cached;

    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });
    if (!cycle) throw new NotFoundException('Ciclo no encontrado');

    // Get all responses with evaluator info
    const raw = await this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a', 'a.tenant_id = r.tenant_id')
      .innerJoin(User, 'evaluator', 'evaluator.id = a.evaluator_id AND evaluator.tenant_id = a.tenant_id')
      .innerJoin(User, 'evaluatee', 'evaluatee.id = a.evaluatee_id AND evaluatee.tenant_id = a.tenant_id')
      .where('a.cycleId = :cycleId', { cycleId })
      .andWhere('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL')
      .select('a.evaluator_id', 'evaluatorId')
      .addSelect("COALESCE(evaluator.first_name, '') || ' ' || COALESCE(evaluator.last_name, '')", 'evaluatorName')
      .addSelect('r.overall_score', 'score')
      .addSelect("COALESCE(evaluatee.first_name, '') || ' ' || COALESCE(evaluatee.last_name, '')", 'evaluateeName')
      .getRawMany();

    if (raw.length < 3) {
      throw new BadRequestException('Se necesitan al menos 3 evaluaciones completadas para analizar sesgos');
    }

    // Calculate stats
    const allScores = raw.map((r) => Number(r.score));
    const globalAvg = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    const globalStdDev = Math.sqrt(allScores.reduce((sum, s) => sum + Math.pow(s - globalAvg, 2), 0) / allScores.length);

    // Group by evaluator
    const evaluatorMap: Record<string, { name: string; scores: number[]; evaluatees: string[] }> = {};
    for (const r of raw) {
      const eid = r.evaluatorId;
      if (!evaluatorMap[eid]) evaluatorMap[eid] = { name: (r.evaluatorName || '').trim(), scores: [], evaluatees: [] };
      evaluatorMap[eid].scores.push(Number(r.score));
      const ename = (r.evaluateeName || '').trim();
      if (!evaluatorMap[eid].evaluatees.includes(ename)) evaluatorMap[eid].evaluatees.push(ename);
    }

    const evaluatorStats = Object.entries(evaluatorMap).map(([id, data]) => {
      const avg = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
      const stdDev = data.scores.length > 1
        ? Math.sqrt(data.scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / data.scores.length)
        : 0;
      return {
        evaluatorId: id,
        evaluatorName: data.name,
        scoreCount: data.scores.length,
        avgScore: avg,
        stdDev,
        minScore: Math.min(...data.scores),
        maxScore: Math.max(...data.scores),
        evaluatees: data.evaluatees,
      };
    });

    // Get score distribution from analytics
    const analytics = await this.reportsService.getAnalytics(tenantId, cycleId);

    const prompt = buildBiasPrompt({
      cycleName: cycle.name,
      globalAvg,
      globalStdDev,
      evaluatorStats,
      scoreDistribution: analytics.scoreDistribution || [],
    });

    const saved = await this.callClaudeAndPersistInsight({
      tenantId,
      type: InsightType.BIAS,
      generatedBy,
      prompt,
      buildInsightFields: () => ({ userId: null, cycleId }),
    });

    await this.trackAddonUsage(tenantId);

    try {
      await this.notificationsService.create({
        tenantId, userId: generatedBy, type: NotificationType.AI_ANALYSIS_READY,
        title: 'Análisis de sesgos generado',
        message: `El análisis de sesgos del ciclo "${cycle.name}" está listo`,
        metadata: { insightId: saved.id, cycleId },
      });
    } catch (e) {
      this.logger.warn(`Failed to send notification: ${e.message}`);
    }

    return saved;
    }); // ← cierra withAiQuotaLock
  }

  // ─── 3.4: Suggestions ──────────────────────────────────────────────────

  async generateSuggestions(tenantId: string, cycleId: string, userId: string, generatedBy: string): Promise<AiInsight> {
    return this.withAiQuotaLock(tenantId, async () => {
    await this.checkRateLimit(tenantId);
    await this.checkWeeklyRoleLimit(tenantId, generatedBy);

    const cached = await this.getCached(tenantId, InsightType.SUGGESTIONS, cycleId, userId);
    if (cached) return cached;

    const user = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Colaborador no encontrado');

    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });
    if (!cycle) throw new NotFoundException('Ciclo no encontrado');

    // Gather all context in parallel
    const [competencyRadar, selfVsOthers, objectives, competencies, feedback, talent] = await Promise.all([
      this.reportsService.competencyRadar(cycleId, userId, tenantId),
      this.reportsService.selfVsOthers(cycleId, userId, tenantId),
      this.objectiveRepo.find({ where: { tenantId, userId }, order: { createdAt: 'DESC' }, take: 10 }),
      this.competencyRepo.find({ where: { tenantId, isActive: true } }),
      this.feedbackRepo.find({ where: { tenantId, toUserId: userId }, order: { createdAt: 'DESC' }, take: 10 }),
      this.talentRepo.findOne({ where: { tenantId, userId, cycleId }, order: { createdAt: 'DESC' } }),
    ]);

    // Get overall score
    const assignments = await this.assignmentRepo.find({
      where: { cycleId, evaluateeId: userId, tenantId, status: AssignmentStatus.COMPLETED },
    });
    let overallScore: number | null = null;
    if (assignments.length > 0) {
      const responses = await this.responseRepo
        .createQueryBuilder('r')
        .where('r.assignmentId IN (:...ids)', { ids: assignments.map((a) => a.id) })
        .andWhere('r.overall_score IS NOT NULL')
        .getMany();
      if (responses.length > 0) {
        overallScore = responses.reduce((sum, r) => sum + Number(r.overallScore), 0) / responses.length;
        overallScore = Math.round(overallScore * 100) / 100;
      }
    }

    // Nine Box quadrant label
    let nineBoxQuadrant: string | null = null;
    if (talent) {
      const p = Number(talent.performanceScore);
      const pot = Number(talent.potentialScore);
      const pLevel = p < 4 ? 'Bajo' : p < 7 ? 'Medio' : 'Alto';
      const potLevel = pot < 4 ? 'Bajo' : pot < 7 ? 'Medio' : 'Alto';
      nineBoxQuadrant = `Desempeño ${pLevel}, Potencial ${potLevel}`;
    }

    const prompt = buildSuggestionsPrompt({
      employeeName: sanitizeForPrompt(`${user.firstName} ${user.lastName}`),
      position: sanitizeForPrompt(user.position || ''),
      department: sanitizeForPrompt(user.department || ''),
      cycleName: sanitizeForPrompt(cycle.name),
      overallScore,
      competencyRadar,
      selfVsOthers,
      nineBoxQuadrant,
      currentObjectives: objectives.map((o) => ({ title: o.title, progress: o.progress, status: o.status })),
      competencies: competencies.map((c) => ({ name: c.name, category: c.category })),
      recentFeedback: feedback.map((f) => ({ sentiment: f.sentiment, message: f.message })),
    });

    const saved = await this.callClaudeAndPersistInsight({
      tenantId,
      type: InsightType.SUGGESTIONS,
      generatedBy,
      prompt,
      buildInsightFields: () => ({ userId, cycleId }),
    });

    await this.trackAddonUsage(tenantId);

    try {
      await this.notificationsService.create({
        tenantId, userId: generatedBy, type: NotificationType.AI_ANALYSIS_READY,
        title: 'Sugerencias de desarrollo generadas',
        message: `Las sugerencias de mejora para ${user.firstName} ${user.lastName} están listas`,
        metadata: { insightId: saved.id, cycleId, targetUserId: userId },
      });
    } catch (e) {
      this.logger.warn(`Failed to send notification: ${e.message}`);
    }

    return saved;
    }); // ← cierra withAiQuotaLock
  }

  // ─── 3.5: Agenda Mágica de 1:1 (v3.1 F1) ────────────────────────────────

  /**
   * Genera sugerencias de temas para una reunión 1:1 basándose en datos
   * del colaborador (OKRs, feedback reciente, reconocimientos, pendientes
   * del 1:1 anterior).
   *
   * Diferencias con las otras funciones:
   * - `cycleId` es NULL (la agenda no pertenece a un ciclo de evaluación)
   * - `scopeEntityId` = checkinId (para dedup + cache per-checkin)
   * - Cache lookup usa `scopeEntityId`, no `cycleId`
   *
   * Graceful degradation: si el tenant no tiene AI_INSIGHTS, el caller
   * (FeedbackService.generateMagicAgenda) debe detectar el plan y skipear
   * esta llamada. Aquí asumimos que el caller ya hizo esa validación.
   *
   * Max tokens: 800 (respuesta corta, 3-5 topics JSON).
   */
  async generateAgendaSuggestions(
    tenantId: string,
    checkinId: string,
    context: {
      employeeName: string;
      employeePosition: string;
      employeeDepartment: string;
      okrs: Array<{ title: string; progress: number; status: string; daysToTarget: number | null }>;
      recentFeedback: Array<{ sentiment: string; messagePreview: string; createdAt: string }>;
      recentRecognitions: Array<{ valueName?: string; messagePreview: string; createdAt: string }>;
      pendingFromPrevious: Array<{ text: string }>;
      checkinTopic?: string;
    },
    generatedBy: string,
  ): Promise<AiInsight> {
    return this.withAiQuotaLock(tenantId, async () => {
      await this.checkRateLimit(tenantId);

      // Cache lookup — 7 días de TTL, por checkinId (scopeEntityId).
      const cacheDate = new Date();
      cacheDate.setDate(cacheDate.getDate() - CACHE_DAYS);
      const cached = await this.insightRepo.findOne({
        where: {
          tenantId,
          type: InsightType.AGENDA_SUGGESTIONS,
          scopeEntityId: checkinId,
          createdAt: MoreThan(cacheDate),
        },
        order: { createdAt: 'DESC' },
      });
      if (cached) return cached;

      // Import dinámico para evitar circularidad con feedback module.
      const { buildAgendaPrompt } = await import('./prompts/agenda.prompt');

      const prompt = buildAgendaPrompt({
        employeeName: sanitizeForPrompt(context.employeeName),
        employeePosition: sanitizeForPrompt(context.employeePosition),
        employeeDepartment: sanitizeForPrompt(context.employeeDepartment),
        okrs: context.okrs.map((o) => ({
          title: sanitizeForPrompt(o.title),
          progress: o.progress,
          status: o.status,
          daysToTarget: o.daysToTarget,
        })),
        recentFeedback: context.recentFeedback.map((f) => ({
          sentiment: f.sentiment,
          messagePreview: sanitizeForPrompt(f.messagePreview),
          createdAt: f.createdAt,
        })),
        recentRecognitions: context.recentRecognitions.map((r) => ({
          valueName: r.valueName ? sanitizeForPrompt(r.valueName) : undefined,
          messagePreview: sanitizeForPrompt(r.messagePreview),
          createdAt: r.createdAt,
        })),
        pendingFromPrevious: context.pendingFromPrevious.map((p) => ({
          text: sanitizeForPrompt(p.text),
        })),
        checkinTopic: context.checkinTopic ? sanitizeForPrompt(context.checkinTopic) : undefined,
      });

      // 800 tokens es suficiente para 3-5 topics con rationale cortos.
      const saved = await this.callClaudeAndPersistInsight({
        tenantId,
        type: InsightType.AGENDA_SUGGESTIONS,
        generatedBy,
        prompt,
        maxTokens: 800,
        buildInsightFields: (content) => {
          // Validación del shape esperado — si falla, al menos retornamos array vacío
          // para no romper el caller.
          if (!content.topics || !Array.isArray(content.topics)) {
            this.logger.warn(
              `AGENDA_SUGGESTIONS returned unexpected shape — coercing to empty array. checkinId=${checkinId.slice(0, 8)}`,
            );
            content.topics = [];
          }
          return {
            userId: null,
            cycleId: null, // NO asociado a ciclo
            scopeEntityId: checkinId,
          };
        },
      });

      await this.trackAddonUsage(tenantId);

      this.logger.log(
        `AGENDA_SUGGESTIONS generated: tenant=${tenantId.slice(0, 8)}, checkin=${checkinId.slice(0, 8)}, tokens=${saved.tokensUsed}`,
      );

      return saved;
    });
  }

  // ─── Flight Risk Score ──────────────────────────────────────────────────

  /**
   * Calculates an algorithmic flight-risk score (0-100) for every active
   * employee in the tenant based on observable signals:
   *
   * | Signal                           | Weight | High-risk condition              |
   * |----------------------------------|--------|----------------------------------|
   * | Average evaluation score         | 30%    | score < 5 → higher risk          |
   * | OKR completion rate              | 25%    | completionRate < 40% → risk      |
   * | Received feedback (last 90 days) | 20%    | 0 feedbacks → risk               |
   * | Objectives at-risk count         | 15%    | any at-risk active objectives    |
   * | Talent potential assessment      | 10%    | low potential & low perf → risk  |
   *
   * Score interpretation: 0–30 low, 31–60 medium, 61–100 high risk.
   * This is a deterministic algorithm — no AI call needed.
   */
  async getFlightRiskScores(tenantId: string, managerId?: string): Promise<{
    generatedAt: string;
    totalEmployees: number;
    summary: { low: number; medium: number; high: number };
    scores: Array<{
      userId: string;
      name: string;
      position: string | null;
      department: string | null;
      riskScore: number;
      riskLevel: 'low' | 'medium' | 'high';
      factors: Array<{ label: string; value: string; impact: 'positive' | 'neutral' | 'negative' }>;
    }>;
  }> {
    // P7.5 — Si caller es manager, filtra empleados a su equipo directo + self.
    // Admin (managerId=undefined) ve riesgo de toda la org.
    const where: any = { tenantId, role: In(['employee', 'manager']), isActive: true };
    if (managerId) {
      // Incluye self + reportes directos.
      where.id = In([managerId]);
      const reports = await this.userRepo.find({
        where: { tenantId, managerId },
        select: ['id'],
      });
      where.id = In([managerId, ...reports.map((r) => r.id)]);
    }
    const employees = await this.userRepo.find({
      where,
      select: ['id', 'firstName', 'lastName', 'position', 'department'] as any,
    });

    if (employees.length === 0) {
      return { generatedAt: new Date().toISOString(), totalEmployees: 0, summary: { low: 0, medium: 0, high: 0 }, scores: [] };
    }

    const employeeIds = employees.map((e) => e.id);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // Batch queries — one per data type, then index by userId
    const [allAssignments, allObjectives, allFeedback, allTalent] = await Promise.all([
      this.assignmentRepo.find({
        where: { tenantId, evaluateeId: In(employeeIds) },
        select: ['id', 'evaluateeId', 'status'] as any,
      }),
      this.objectiveRepo.find({
        where: { tenantId, userId: In(employeeIds) },
        select: ['id', 'userId', 'status', 'progress'] as any,
      }),
      this.feedbackRepo.find({
        where: { tenantId, toUserId: In(employeeIds) },
        select: ['id', 'toUserId', 'createdAt'] as any,
      }),
      this.talentRepo.find({
        where: { tenantId, userId: In(employeeIds) },
        order: { createdAt: 'DESC' },
        select: ['userId', 'performanceScore', 'potentialScore'] as any,
      }),
    ]);

    // Get scores for completed assignments
    const completedAssignmentIds = allAssignments
      .filter((a) => a.status === AssignmentStatus.COMPLETED)
      .map((a) => a.id);

    const allResponses = completedAssignmentIds.length > 0
      ? await this.responseRepo.find({
          where: { assignmentId: In(completedAssignmentIds) },
          select: ['assignmentId', 'overallScore'] as any,
        })
      : [];

    // Map assignmentId → evaluateeId
    const assignmentToEvaluatee = new Map(allAssignments.map((a) => [a.id, a.evaluateeId]));

    // Build per-user score index
    const scoresByUser = new Map<string, number[]>();
    for (const r of allResponses) {
      if (r.overallScore == null) continue;
      const uid = assignmentToEvaluatee.get(r.assignmentId);
      if (!uid) continue;
      const list = scoresByUser.get(uid) || [];
      list.push(Number(r.overallScore));
      scoresByUser.set(uid, list);
    }

    const objectivesByUser = new Map<string, typeof allObjectives>();
    for (const o of allObjectives) {
      const list = objectivesByUser.get(o.userId) || [];
      list.push(o);
      objectivesByUser.set(o.userId, list);
    }

    const feedbackCountByUser = new Map<string, number>();
    for (const f of allFeedback) {
      if (new Date(f.createdAt) >= ninetyDaysAgo) {
        feedbackCountByUser.set(f.toUserId, (feedbackCountByUser.get(f.toUserId) || 0) + 1);
      }
    }

    const talentByUser = new Map<string, (typeof allTalent)[0]>();
    for (const t of allTalent) {
      if (!talentByUser.has(t.userId)) talentByUser.set(t.userId, t);
    }

    const results = employees.map((emp) => {
      const scores = scoresByUser.get(emp.id) || [];
      const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

      const objs = objectivesByUser.get(emp.id) || [];
      const activeObjs = objs.filter((o) => o.status === 'active');
      const completedObjs = objs.filter((o) => o.status === 'completed').length;
      const totalObjs = objs.filter((o) => o.status !== 'abandoned').length;
      const objCompletionRate = totalObjs > 0 ? (completedObjs / totalObjs) * 100 : null;
      const atRiskCount = activeObjs.filter((o) => o.progress < 40).length;

      const feedbackCount = feedbackCountByUser.get(emp.id) || 0;
      const talent = talentByUser.get(emp.id);

      let riskScore = 0;
      const factors: Array<{ label: string; value: string; impact: 'positive' | 'neutral' | 'negative' }> = [];

      // Signal 1: Evaluation score (max 30 pts)
      if (avgScore !== null) {
        const scoreRisk = avgScore < 4 ? 30 : avgScore < 6 ? 18 : avgScore < 8 ? 6 : 0;
        riskScore += scoreRisk;
        factors.push({
          label: 'Puntaje evaluación',
          value: avgScore.toFixed(1),
          impact: avgScore >= 7 ? 'positive' : avgScore >= 5 ? 'neutral' : 'negative',
        });
      } else {
        riskScore += 15;
        factors.push({ label: 'Puntaje evaluación', value: 'Sin datos', impact: 'neutral' });
      }

      // Signal 2: OKR completion rate (max 25 pts)
      if (objCompletionRate !== null) {
        const okrRisk = objCompletionRate < 30 ? 25 : objCompletionRate < 60 ? 15 : objCompletionRate < 80 ? 5 : 0;
        riskScore += okrRisk;
        factors.push({
          label: 'Cumplimiento OKRs',
          value: `${objCompletionRate.toFixed(0)}%`,
          impact: objCompletionRate >= 80 ? 'positive' : objCompletionRate >= 50 ? 'neutral' : 'negative',
        });
      } else {
        riskScore += 12;
        factors.push({ label: 'Cumplimiento OKRs', value: 'Sin datos', impact: 'neutral' });
      }

      // Signal 3: Feedback received last 90 days (max 20 pts)
      const feedbackRisk = feedbackCount === 0 ? 20 : feedbackCount < 3 ? 10 : feedbackCount < 8 ? 4 : 0;
      riskScore += feedbackRisk;
      factors.push({
        label: 'Feedback recibido (90d)',
        value: `${feedbackCount} feedback(s)`,
        impact: feedbackCount >= 5 ? 'positive' : feedbackCount >= 2 ? 'neutral' : 'negative',
      });

      // Signal 4: OKRs at risk (max 15 pts)
      const atRiskRisk = atRiskCount === 0 ? 0 : atRiskCount === 1 ? 8 : atRiskCount < 4 ? 12 : 15;
      riskScore += atRiskRisk;
      factors.push({
        label: 'Objetivos en riesgo',
        value: `${atRiskCount} de ${activeObjs.length}`,
        impact: atRiskCount === 0 ? 'positive' : atRiskCount <= 1 ? 'neutral' : 'negative',
      });

      // Signal 5: Talent 9-box (max 10 pts)
      if (talent) {
        const perf = Number(talent.performanceScore);
        const pot = Number(talent.potentialScore);
        const talentRisk = (perf < 4 && pot < 4) ? 10 : (perf < 5 || pot < 5) ? 5 : 0;
        riskScore += talentRisk;
        factors.push({
          label: 'Evaluación de talento',
          value: `Desemp. ${perf.toFixed(1)} / Pot. ${pot.toFixed(1)}`,
          impact: (perf >= 7 && pot >= 7) ? 'positive' : (perf >= 5 && pot >= 5) ? 'neutral' : 'negative',
        });
      } else {
        factors.push({ label: 'Evaluación de talento', value: 'Sin datos', impact: 'neutral' });
      }

      const riskLevel: 'low' | 'medium' | 'high' = riskScore <= 30 ? 'low' : riskScore <= 60 ? 'medium' : 'high';

      return {
        userId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        position: (emp as any).position || null,
        department: (emp as any).department || null,
        riskScore,
        riskLevel,
        factors,
      };
    });

    results.sort((a, b) => b.riskScore - a.riskScore);

    const summary = {
      low: results.filter((r) => r.riskLevel === 'low').length,
      medium: results.filter((r) => r.riskLevel === 'medium').length,
      high: results.filter((r) => r.riskLevel === 'high').length,
    };

    return { generatedAt: new Date().toISOString(), totalEmployees: employees.length, summary, scores: results };
  }

  // ─── F15: Performance Prediction ──────────────────────────────────────

  async getPerformancePrediction(tenantId: string, userId: string) {
    // Require at least 2 completed cycles with data
    const closedCycles = await this.cycleRepo.find({
      where: { tenantId, status: CycleStatus.CLOSED },
      order: { endDate: 'ASC' },
    });

    // Get scores per cycle for this user
    const cycleScores: Array<{ cycleName: string; endDate: string; avgScore: number }> = [];
    for (const cycle of closedCycles) {
      const assignments = await this.assignmentRepo.find({
        where: { cycleId: cycle.id, evaluateeId: userId, tenantId, status: AssignmentStatus.COMPLETED },
        select: ['id'],
      });
      if (assignments.length === 0) continue;

      const responses = await this.responseRepo
        .createQueryBuilder('r')
        .where('r.assignmentId IN (:...ids)', { ids: assignments.map((a) => a.id) })
        .andWhere('r.overall_score IS NOT NULL')
        .getMany();

      if (responses.length === 0) continue;
      const avg = responses.reduce((sum, r) => sum + Number(r.overallScore), 0) / responses.length;
      cycleScores.push({
        cycleName: cycle.name,
        endDate: cycle.endDate?.toISOString?.() || '',
        avgScore: Math.round(avg * 100) / 100,
      });
    }

    if (cycleScores.length < 2) {
      return {
        available: false,
        message: `Se requieren al menos 2 ciclos completados con evaluaciones para generar predicciones. Actualmente hay ${cycleScores.length}.`,
        cyclesAvailable: cycleScores.length,
        history: cycleScores,
      };
    }

    // Linear trend calculation
    const scores = cycleScores.map((cs) => cs.avgScore);
    const n = scores.length;
    const xMean = (n - 1) / 2;
    const yMean = scores.reduce((a, b) => a + b, 0) / n;
    let numSum = 0;
    let denSum = 0;
    for (let i = 0; i < n; i++) {
      numSum += (i - xMean) * (scores[i] - yMean);
      denSum += (i - xMean) * (i - xMean);
    }
    const slope = denSum !== 0 ? numSum / denSum : 0;
    const predicted = Math.max(0, Math.min(10, Math.round((yMean + slope * (n - xMean)) * 100) / 100));

    const trend = slope > 0.2 ? 'improving' : slope < -0.2 ? 'declining' : 'stable';
    const confidence = Math.min(0.95, 0.5 + (n - 2) * 0.15); // More cycles = more confidence

    return {
      available: true,
      predictedScore: predicted,
      trend,
      trendSlope: Math.round(slope * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      history: cycleScores,
      cyclesUsed: n,
      explanation: trend === 'improving'
        ? `Tendencia al alza: el desempeño ha mejorado en promedio ${Math.abs(Math.round(slope * 100) / 100)} puntos por ciclo.`
        : trend === 'declining'
          ? `Tendencia a la baja: el desempeño ha disminuido en promedio ${Math.abs(Math.round(slope * 100) / 100)} puntos por ciclo. Se recomienda intervención.`
          : `Desempeño estable: las variaciones entre ciclos son mínimas (±${Math.abs(Math.round(slope * 100) / 100)} por ciclo).`,
    };
  }

  // ─── F15: Retention Recommendations ──────────────────────────────────

  /**
   * P10 (audit manager) — acepta managerId opcional para scope a team.
   * Cuando caller es manager, delegamos el filtro a getFlightRiskScores
   * que ya tiene el scope de equipo directo + self (P7.5). Un manager
   * solo ve recomendaciones de sus reports, no de toda la organización.
   */
  async getRetentionRecommendations(tenantId: string, managerId?: string) {
    const flightRiskData = await this.getFlightRiskScores(tenantId, managerId);
    const highRisk = flightRiskData.scores.filter((s) => s.riskLevel === 'high');
    const mediumRisk = flightRiskData.scores.filter((s) => s.riskLevel === 'medium').slice(0, 5);

    const recommendations: Array<{
      userId: string;
      name: string;
      department: string | null;
      riskScore: number;
      riskLevel: string;
      actions: Array<{ type: string; description: string; priority: string }>;
    }> = [];

    for (const emp of [...highRisk, ...mediumRisk]) {
      const actions: Array<{ type: string; description: string; priority: string }> = [];

      // Analyze factors to suggest specific actions
      for (const factor of emp.factors) {
        if (factor.label.includes('evaluación') && factor.impact === 'negative') {
          actions.push({
            type: 'pdi',
            description: `Crear plan de desarrollo individual enfocado en las brechas identificadas en evaluaciones (score: ${factor.value}).`,
            priority: 'alta',
          });
        }
        if (factor.label.includes('OKR') && factor.impact === 'negative') {
          actions.push({
            type: 'coaching',
            description: `Asignar sesiones de coaching para mejorar cumplimiento de objetivos (${factor.value} completado).`,
            priority: 'alta',
          });
        }
        if (factor.label.includes('feedback') && factor.impact === 'negative') {
          actions.push({
            type: 'engagement',
            description: `Incrementar frecuencia de check-ins 1:1 y feedback para aumentar engagement (${factor.value} feedbacks en 90 días).`,
            priority: 'media',
          });
        }
        if (factor.label.includes('riesgo') && factor.impact === 'negative') {
          actions.push({
            type: 'retention',
            description: 'Revisar compensación y beneficios. Considerar rotación a proyecto de mayor impacto.',
            priority: 'alta',
          });
        }
      }

      // Always add generic high-risk actions
      if (emp.riskLevel === 'high' && actions.length < 2) {
        actions.push({
          type: 'conversation',
          description: 'Programar conversación de retención con el manager directo para entender motivaciones y expectativas.',
          priority: 'alta',
        });
      }

      recommendations.push({
        userId: emp.userId,
        name: emp.name,
        department: emp.department,
        riskScore: emp.riskScore,
        riskLevel: emp.riskLevel,
        actions,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      totalHighRisk: highRisk.length,
      totalMediumRisk: flightRiskData.summary.medium,
      recommendations,
    };
  }

  // ─── F15: Explainability (XAI) ──────────────────────────────────────

  async getExplainability(
    tenantId: string,
    userId: string,
    callerRole?: string,
    callerUserId?: string,
  ) {
    // P7.5 — Si caller es manager, solo puede ver explainability de su equipo
    // (reportes directos + self). Verificamos antes de armar el reporte.
    if (callerRole === 'manager' && callerUserId && userId !== callerUserId) {
      const target = await this.userRepo.findOne({
        where: { id: userId, tenantId },
        select: ['id', 'managerId'],
      });
      if (!target || target.managerId !== callerUserId) {
        throw new NotFoundException('Usuario no encontrado');
      }
    }

    // Get flight risk data for this specific user (pasamos managerId para que
    // la lista esté scoped cuando caller es manager).
    const flightRiskData = await this.getFlightRiskScores(
      tenantId,
      callerRole === 'manager' ? callerUserId : undefined,
    );
    const userScore = flightRiskData.scores.find((s) => s.userId === userId);
    if (!userScore) {
      return { available: false, message: 'No se encontraron datos de riesgo para este usuario.' };
    }

    // Get performance prediction
    const prediction = await this.getPerformancePrediction(tenantId, userId);

    // Build detailed explanation per factor with weight attribution
    const factorWeights: Record<string, number> = {
      'Puntaje evaluación': 30,
      'Cumplimiento OKRs': 25,
      'Feedback recibido': 20,
      'Objetivos en riesgo': 15,
      'Evaluación talento': 10,
    };

    const detailedFactors = userScore.factors.map((f) => {
      const weight = factorWeights[f.label] || 0;
      return {
        ...f,
        weight,
        contribution: `${weight}% del score total`,
        explanation: f.impact === 'negative'
          ? `Este factor contribuye al riesgo: ${f.label} = ${f.value}. Peso: ${weight}%.`
          : f.impact === 'positive'
            ? `Este factor reduce el riesgo: ${f.label} = ${f.value}. Peso: ${weight}%.`
            : `Factor neutral: ${f.label} = ${f.value}. Peso: ${weight}%.`,
      };
    });

    return {
      available: true,
      userId: userScore.userId,
      name: userScore.name,
      riskScore: userScore.riskScore,
      riskLevel: userScore.riskLevel,
      factors: detailedFactors,
      prediction: prediction.available ? {
        predictedScore: prediction.predictedScore,
        trend: prediction.trend,
        confidence: prediction.confidence,
      } : null,
      methodology: 'Score compuesto de 5 señales ponderadas: evaluación (30%), OKRs (25%), feedback (20%), objetivos en riesgo (15%), evaluación de talento (10%). Cada señal se califica de 0 a su peso máximo según umbrales predefinidos. Score total: 0-100 (bajo ≤30, medio 31-60, alto >60).',
    };
  }

  // ─── Usage / Quota ──────────────────────────────────────────────────

  async getUsageQuota(tenantId: string, _userId?: string) {
    // Quota: plan credits (monthly renewable) + addon credits (persist until exhausted)
    const { planUsed, totalUsed, planLimit, addonRemaining, totalLimit, periodStart, periodEnd } = await this.getMonthlyCallCount(tenantId);
    const monthlyUsed = totalUsed;
    const monthlyLimit = totalLimit;
    const monthlyRemaining = Math.max(0, totalLimit - totalUsed);
    const nearLimit = monthlyLimit > 0 && monthlyRemaining <= Math.ceil(monthlyLimit * 0.1);

    return {
      used: monthlyUsed,
      limit: monthlyLimit,
      remaining: monthlyRemaining,
      monthlyUsed,
      monthlyLimit,
      monthlyRemaining,
      planUsed,
      planLimit,
      addonRemaining,
      periodStart,
      periodEnd,
      nearLimit,
      hasAiAccess: monthlyLimit > 0,
      warning: monthlyLimit <= 0
        ? 'Su plan no incluye informes de IA.'
        : nearLimit
          ? `Atención: quedan ${monthlyRemaining} de ${monthlyLimit} informes de IA en este período (${planLimit - planUsed} del plan + ${addonRemaining} adicionales).`
          : null,
    };
  }

  /** Get tenant-level AI usage for subscription page */
  async getTenantUsage(tenantId: string) {
    const { totalUsed: monthlyUsed, totalLimit: monthlyLimit, planUsed, planLimit, addonRemaining, periodStart, periodEnd } = await this.getMonthlyCallCount(tenantId);
    const { addonCalls } = await this.getSubscriptionAiInfo(tenantId);
    const monthlyRemaining = Math.max(0, monthlyLimit - monthlyUsed);

    // Last generations in current period
    const lastGenerations = await this.insightRepo.find({
      where: { tenantId, createdAt: MoreThan(periodStart) },
      select: ['id', 'type', 'createdAt', 'generatedBy', 'tokensUsed'],
      order: { createdAt: 'DESC' },
      take: 10,
    });

    const typeLabels: Record<string, string> = {
      summary: 'Resumen de desempeño',
      bias: 'Detección de sesgo',
      suggestions: 'Sugerencias de desarrollo',
      survey_analysis: 'Análisis de encuesta',
      cv_analysis: 'Análisis de CV',
      recruitment_recommendation: 'Recomendación de selección',
      cycle_comparison: 'Comparativa de ciclos (IA)',
    };

    return {
      monthlyUsed,
      monthlyLimit,
      monthlyRemaining,
      planUsed,
      planLimit,
      addonCalls,
      addonRemaining,
      periodStart,
      periodEnd,
      hasAiAccess: monthlyLimit > 0,
      lastGenerations: lastGenerations.map((g) => ({
        id: g.id,
        type: typeLabels[g.type] || g.type,
        date: g.createdAt,
        tokensUsed: g.tokensUsed,
      })),
    };
  }

  /**
   * Audit trail completo de llamadas al API de Anthropic. Lee de
   * `ai_call_logs` (no de `ai_insights`) — esto garantiza que las
   * llamadas que fallaron en `parseJson` tambien quedan visibles
   * (son las que aparecen con `parseSuccess=false`).
   *
   * Retorna el mismo shape JSON que la version anterior (data/total/
   * totalTokens) para que el frontend no necesite cambios. Los campos
   * adicionales (`parseSuccess`, `errorMessage`, `inputTokens`,
   * `outputTokens`) van como extras.
   */
  async getAiUsageLog(tenantId: string, page = 1, limit = 25): Promise<{ data: any[]; total: number; totalTokens: number }> {
    const typeLabels: Record<string, string> = {
      summary: 'Resumen de desempeño', bias: 'Detección de sesgo',
      suggestions: 'Sugerencias de desarrollo', survey_analysis: 'Análisis de encuesta',
      cv_analysis: 'Análisis de CV', recruitment_recommendation: 'Recomendación de selección',
      cycle_comparison: 'Comparativa de ciclos (IA)',
      agenda_suggestions: 'Sugerencias de agenda 1:1',
      flight_risk: 'Riesgo de fuga',
    };

    const where = tenantId ? { tenantId } : {};
    const [records, total] = await this.callLogRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Enrich with user names (igual que antes)
    const userIds = [...new Set(records.map((r) => r.generatedBy).filter(Boolean))];
    const userMap = new Map<string, any>();
    if (userIds.length > 0) {
      const users = await this.userRepo.find({
        where: userIds.map((id) => ({ id })),
        select: ['id', 'email', 'firstName', 'lastName'],
      });
      for (const u of users) userMap.set(u.id, u);
    }

    // Total tokens consumidos (suma sobre TODAS las llamadas, incluso las
    // que fallaron en parse — es lo que cobra Anthropic).
    const qb = this.callLogRepo
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.tokensUsed), 0)', 'total');
    if (tenantId) qb.where('c.tenantId = :tenantId', { tenantId });
    const tokensResult = await qb.getRawOne();

    return {
      data: records.map((r) => {
        const u = r.generatedBy ? userMap.get(r.generatedBy) : null;
        return {
          id: r.id,
          type: r.type,
          typeLabel: typeLabels[r.type] || r.type,
          createdAt: r.createdAt,
          tokensUsed: r.tokensUsed || 0,
          inputTokens: r.inputTokens || 0,
          outputTokens: r.outputTokens || 0,
          model: r.model,
          parseSuccess: r.parseSuccess,
          errorMessage: r.errorMessage,
          insightId: r.insightId,
          generatedBy: r.generatedBy,
          userName: u ? `${u.firstName} ${u.lastName}` : null,
          userEmail: u?.email || null,
        };
      }),
      total,
      totalTokens: Number(tokensResult?.total || 0),
    };
  }

  // ─── Cycle Comparison AI Analysis ────────────────────────────────────

  /**
   * P6 fix (bug reportado): cuando caller es manager, el analisis AI
   * debe procesar SOLO assignments de sus reportes directos + self, igual
   * que analytics.service.ts getCycleComparison. Antes este endpoint
   * estaba abierto y el manager recibia analisis IA sobre TODA la
   * organizacion — fuga de datos agregados de otros equipos.
   */
  async analyzeCycleComparison(
    tenantId: string,
    cycleIds: string[],
    generatedBy: string,
    callerRole?: string,
  ): Promise<any> {
    return this.withAiQuotaLock(tenantId, async () => {
    await this.checkRateLimit(tenantId);

    // Pre-cargar reportes directos del manager UNA sola vez (fuera del loop
    // de ciclos). Mismo patron que analytics.service.ts.
    let managerFilterIds: Set<string> | null = null;
    if (callerRole === 'manager' && generatedBy) {
      const directReports = await this.userRepo.find({
        where: { tenantId, managerId: generatedBy },
        select: ['id'],
      });
      managerFilterIds = new Set(directReports.map((u) => u.id));
      managerFilterIds.add(generatedBy); // incluir self
    }

    // Fetch cycle data for selected cycles
    const cycles: any[] = [];
    for (const cid of cycleIds) {
      const cycle = await this.cycleRepo.findOne({ where: { id: cid, tenantId } });
      if (!cycle) continue;
      const allAssignments = await this.assignmentRepo.find({
        where: { cycleId: cid, tenantId },
        relations: ['evaluatee'],
      });

      // Filtrar a reportes directos si es manager.
      const assignments = managerFilterIds
        ? allAssignments.filter((a) => managerFilterIds!.has(a.evaluateeId))
        : allAssignments;

      const withScores = assignments.filter((a: any) => a.response?.overallScore != null);
      const scores = withScores.map((a: any) => Number(a.response.overallScore));
      const avg = scores.length > 0 ? Number((scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2)) : null;
      const min = scores.length > 0 ? Math.min(...scores) : null;
      const max = scores.length > 0 ? Math.max(...scores) : null;

      // Department breakdown
      const deptScores: Record<string, number[]> = {};
      for (const a of withScores) {
        const dept = (a.evaluatee as any)?.department || 'Sin departamento';
        if (!deptScores[dept]) deptScores[dept] = [];
        deptScores[dept].push(Number((a as any).response.overallScore));
      }

      cycles.push({
        name: cycle.name,
        type: cycle.type,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        totalEvaluated: assignments.length,
        withScores: withScores.length,
        avgScore: avg, minScore: min, maxScore: max,
        byDepartment: Object.entries(deptScores).map(([dept, s]) => ({
          department: dept,
          avgScore: Number((s.reduce((a, b) => a + b, 0) / s.length).toFixed(2)),
          count: s.length,
        })),
      });
    }

    if (cycles.length < 2) {
      throw new BadRequestException('Se requieren al menos 2 ciclos para generar una comparativa.');
    }

    const prompt = `Eres un experto en gestión de talento y RRHH. Analiza la siguiente comparativa entre ${cycles.length} ciclos de evaluación de desempeño de una organización.

Datos de los ciclos:
${cycles.map((c, i) => `
Ciclo ${i + 1}: "${c.name}" (${c.type})
- Período: ${c.startDate ? new Date(c.startDate).toLocaleDateString('es-CL') : 'N/A'} al ${c.endDate ? new Date(c.endDate).toLocaleDateString('es-CL') : 'N/A'}
- Evaluados: ${c.totalEvaluated}, Con puntaje: ${c.withScores}
- Promedio: ${c.avgScore ?? 'N/A'}, Mín: ${c.minScore ?? 'N/A'}, Máx: ${c.maxScore ?? 'N/A'}
- Por departamento: ${c.byDepartment.map((d: any) => `${d.department}: ${d.avgScore} (${d.count} eval.)`).join(', ') || 'Sin datos'}
`).join('\n')}

Responde en formato JSON con esta estructura exacta:
{
  "resumen": "Resumen ejecutivo de la comparación (2-3 párrafos)",
  "tendencias": ["Lista de tendencias identificadas entre ciclos"],
  "fortalezas": ["Aspectos positivos y mejoras observadas"],
  "alertas": ["Alertas o áreas de preocupación"],
  "departamentos": {
    "mejoraron": ["Departamentos con mejora notable"],
    "empeoraron": ["Departamentos que bajaron rendimiento"]
  },
  "recomendaciones": ["Recomendaciones accionables basadas en el análisis"],
  "conclusion": "Conclusión general en 1-2 oraciones"
}

Sé específico con los números. Responde solo el JSON, sin texto adicional.`;

    const saved = await this.callClaudeAndPersistInsight({
      tenantId,
      type: InsightType.CYCLE_COMPARISON,
      generatedBy,
      prompt,
      maxTokens: 3000,
      buildContent: (parsed) => ({
        analysis: parsed,
        cyclesCompared: cycles.map((c) => c.name),
      }),
      buildInsightFields: () => ({ cycleId: cycleIds[0] }),
    });

    await this.trackAddonUsage(tenantId);

    return {
      analysis: (saved.content as any).analysis,
      cyclesCompared: cycles,
      generatedAt: saved.createdAt.toISOString(),
      tokensUsed: saved.tokensUsed,
    };
    }); // ← cierra withAiQuotaLock
  }

  // ─── PDF Export ──────────────────────────────────────────────────────

  async exportSummaryPdf(tenantId: string, cycleId: string, userId: string): Promise<Buffer> {
    const insight = await this.getInsight(tenantId, InsightType.SUMMARY, cycleId, userId);
    if (!insight) throw new NotFoundException('No hay resumen de IA generado para este colaborador');

    const user = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });
    const data = insight.content;

    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const accent = [201, 147, 58]; // #C9933A (Eva360 gold)

    // Header
    doc.setFillColor(26, 18, 6);
    doc.rect(0, 0, pageWidth, 28, 'F');
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.rect(0, 27, pageWidth, 1.5, 'F');
    doc.setTextColor(232, 201, 122);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Eva360 — Informe IA', 14, 13);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`${user?.firstName || ''} ${user?.lastName || ''} · ${cycle?.name || ''} · ${new Date().toLocaleDateString('es-CL')}`, 14, 22);

    let y = 36;
    const leftMargin = 14;
    const maxWidth = pageWidth - 28;

    const addSection = (title: string, content: string | string[]) => {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(accent[0], accent[1], accent[2]);
      doc.text(title, leftMargin, y);
      y += 6;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(55, 65, 81);

      if (Array.isArray(content)) {
        for (const item of content) {
          if (y > 265) { doc.addPage(); y = 20; }
          const lines = doc.splitTextToSize(`• ${item}`, maxWidth);
          doc.text(lines, leftMargin + 2, y);
          y += lines.length * 4.5;
        }
      } else {
        const lines = doc.splitTextToSize(content, maxWidth);
        doc.text(lines, leftMargin, y);
        y += lines.length * 4.5;
      }
      y += 4;
    };

    if (data.executiveSummary) addSection('Resumen Ejecutivo', data.executiveSummary);
    if (data.strengths?.length) addSection('Fortalezas', data.strengths);
    if (data.areasForImprovement?.length) addSection('Áreas de Mejora', data.areasForImprovement);
    if (data.perceptionGap) addSection('Brecha de Percepción', data.perceptionGap);
    if (data.trend) addSection('Tendencia', data.trend);
    if (data.recommendations?.length) addSection('Recomendaciones', data.recommendations);

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      const footerY = doc.internal.pageSize.getHeight() - 8;
      doc.text(`Generado por Eva360 con IA — ${new Date().toLocaleDateString('es-CL')}`, leftMargin, footerY);
      doc.text(`Página ${p} de ${pageCount}`, pageWidth - 14, footerY, { align: 'right' });
    }

    return Buffer.from(doc.output('arraybuffer'));
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async getTextResponses(tenantId: string, cycleId: string, userId: string): Promise<string[]> {
    const assignments = await this.assignmentRepo.find({
      where: { cycleId, evaluateeId: userId, tenantId, status: AssignmentStatus.COMPLETED },
    });
    if (assignments.length === 0) return [];

    const responses = await this.responseRepo
      .createQueryBuilder('r')
      .where('r.assignmentId IN (:...ids)', { ids: assignments.map((a) => a.id) })
      .getMany();

    const texts: string[] = [];
    for (const r of responses) {
      if (!r.answers) continue;
      for (const val of Object.values(r.answers as Record<string, any>)) {
        if (typeof val === 'string' && val.length > 10) {
          texts.push(val);
        }
      }
    }
    return texts.slice(0, 20); // Limit to 20 text responses
  }

  // ─── Survey Analysis ───────────────────────────────────────────────────

  async analyzeSurvey(
    tenantId: string,
    surveyId: string,
    generatedBy: string,
    surveyData: {
      surveyTitle: string;
      responseRate: number;
      totalResponses: number;
      overallAverage: number;
      averageByCategory: any[];
      averageByQuestion: any[];
      enps: any;
      departmentResults: any[];
      openResponses: any[];
    },
    options: { force?: boolean } = {},
  ): Promise<AiInsight> {
    return this.withAiQuotaLock(tenantId, async () => {
    await this.checkRateLimit(tenantId);
    await this.checkWeeklyRoleLimit(tenantId, generatedBy);

    // Check cache — reuse cycleId field to store surveyId.
    // `force: true` skips the cache AND wipes prior insights for this survey so
    // we never mix old/new scale data side by side. Used when the analyst
    // explicitly clicks "Regenerar" after a scale/logic fix on the backend.
    if (options.force) {
      await this.insightRepo.delete({
        tenantId,
        type: InsightType.SURVEY_ANALYSIS,
        cycleId: surveyId,
      });
    } else {
      const cached = await this.getCached(tenantId, InsightType.SURVEY_ANALYSIS, surveyId);
      if (cached) return cached;
    }

    const prompt = buildSurveyAnalysisPrompt(surveyData);
    const saved = await this.callClaudeAndPersistInsight({
      tenantId,
      type: InsightType.SURVEY_ANALYSIS,
      generatedBy,
      prompt,
      maxTokens: 4000,
      buildInsightFields: () => ({
        userId: null,
        cycleId: surveyId, // Reuse cycleId to store surveyId
      }),
    });
    this.logger.log(`Survey AI insight saved: tokens=${saved.tokensUsed}`);
    await this.trackAddonUsage(tenantId);
    return saved;
    }); // ← cierra withAiQuotaLock
  }

  // ─── Recruitment AI ─────────────────────────────────────────────────

  async analyzeCvForRecruitment(
    tenantId: string,
    candidateId: string,
    generatedBy: string,
    cvUrl: string,
    context: string,
  ): Promise<any> {
    return this.withAiQuotaLock(tenantId, async () => {
    // Check rate limits (monthly plan limit + weekly role limit)
    await this.checkRateLimit(tenantId);
    await this.checkWeeklyRoleLimit(tenantId, generatedBy);

    // Extract text from CV (base64 PDF or Word)
    let cvText = '';
    try {
      if (cvUrl.startsWith('data:')) {
        const mimeMatch = cvUrl.match(/^data:([^;,]+)[;,]/);
        const mimeType = mimeMatch ? mimeMatch[1] : '';
        const base64Data = cvUrl.split(',')[1];

        if (base64Data) {
          const buffer = Buffer.from(base64Data, 'base64');

          // Detect by magic bytes if mime is empty or generic
          let effectiveMime = mimeType;
          if (!effectiveMime || effectiveMime === 'application/octet-stream') {
            if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
              effectiveMime = 'application/pdf';
            } else if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
              effectiveMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; // .docx (ZIP)
            } else if (buffer[0] === 0xD0 && buffer[1] === 0xCF) {
              effectiveMime = 'application/msword'; // .doc (OLE2)
            }
          }
          this.logger.log('CV mime: ' + mimeType + ' -> effective: ' + effectiveMime + ', buffer size: ' + buffer.length);

          if (effectiveMime === 'application/pdf') {
            // PDF: use pdf-parse
            const pdfParse = require('pdf-parse');
            const pdfData = await pdfParse(buffer);
            cvText = (pdfData.text || '').trim();
            this.logger.log('PDF parsed: ' + cvText.length + ' chars, ' + pdfData.numpages + ' pages');
          } else if (
            effectiveMime === 'application/msword' ||
            effectiveMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          ) {
            // Word (.doc / .docx): use mammoth
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ buffer });
            cvText = (result.value || '').trim();
            this.logger.log('Word parsed: ' + cvText.length + ' chars');
          } else {
            // Unknown type — try pdf-parse first, then mammoth
            this.logger.warn('Unknown CV mime type: ' + effectiveMime + ', trying both parsers');
            try {
              const pdfParse = require('pdf-parse');
              const pdfData = await pdfParse(buffer);
              cvText = (pdfData.text || '').trim();
            } catch (_e) {
              try {
                const mammoth = require('mammoth');
                const result = await mammoth.extractRawText({ buffer });
                cvText = (result.value || '').trim();
              } catch (_e2) {
                cvText = '';
              }
            }
          }
        }
      }
    } catch (err: any) {
      this.logger.error('CV parse error: ' + err.message);
      cvText = '';
    }

    if (!cvText || cvText.length < 20) {
      cvText = '[El documento no contiene texto extraible. Puede ser un PDF escaneado como imagen.]';
    }

    // Limit CV text to avoid token overflow
    const cvContent = cvText.length > 5000 ? cvText.substring(0, 5000) + '\n...[texto truncado]' : cvText;

    const prompt = `Eres un experto en reclutamiento y seleccion de personal. Tu tarea es analizar el CV de un candidato y cruzarlo con los requisitos del cargo para determinar el nivel de coincidencia.

${context}

CONTENIDO DEL CV DEL CANDIDATO:
${cvContent}

INSTRUCCIONES:
1. Analiza la informacion del CV del candidato
2. Compara CADA requisito del cargo con la experiencia y habilidades del candidato
3. Calcula el porcentaje de coincidencia basado en cuantos requisitos cumple
4. Identifica fortalezas, brechas y alertas

Genera un informe en formato JSON con esta estructura exacta:
{
  "resumenEjecutivo": "Resumen de 3-5 lineas evaluando al candidato respecto al cargo",
  "experienciaRelevante": "Experiencia del candidato que es directamente relevante para este cargo especifico",
  "habilidadesTecnicas": ["habilidad tecnica 1 detectada", "habilidad 2"],
  "habilidadesBlandas": ["habilidad blanda 1", "habilidad 2"],
  "formacionAcademica": "Nivel educativo y como se relaciona con lo requerido",
  "cumplimientoRequisitos": [
    {"requisito": "texto del requisito", "cumple": true, "detalle": "como lo cumple o por que no"}
  ],
  "matchPercentage": 75,
  "matchJustification": "Justificacion detallada del porcentaje de coincidencia basada en el cruce con los requisitos",
  "alertas": ["alerta sobre brechas o inconsistencias detectadas"],
  "recomendacion": "Recomendacion sobre si el candidato debe avanzar en el proceso y por que"
}

IMPORTANTE: El matchPercentage debe reflejar el cruce REAL entre requisitos del cargo y perfil del candidato.
Responde SOLO con el JSON, sin texto adicional ni markdown.`;

    const aiCall = await this.callClaude(prompt, 3000);
    this.logger.log('CV AI response length: ' + aiCall.text.length + ' chars');

    let content: any;
    let parseSuccess = true;
    let parseError: string | null = null;
    try {
      content = this.parseJson(aiCall.text);
    } catch (e: any) {
      parseSuccess = false;
      parseError = (e?.message ?? String(e)).slice(0, 1000);
      // If parse fails completely, store structured fallback (este endpoint
      // NO falla el call — degradacion graceful para UX de recruitment).
      content = { resumenEjecutivo: aiCall.text.slice(0, 500), matchPercentage: 0, error: true };
    }

    this.logger.log(`Creating CV_ANALYSIS insight: tenant=${tenantId.slice(0,8)}, candidate=${candidateId.slice(0,8)}, tokens=${aiCall.tokensUsed}`);
    const insight = this.insightRepo.create({
      tenantId,
      type: InsightType.CV_ANALYSIS,
      cycleId: candidateId,
      userId: null,
      content,
      model: MODEL,
      tokensUsed: aiCall.tokensUsed,
      generatedBy,
    });
    const savedInsight = await this.insightRepo.save(insight);

    // Audit trail SIEMPRE (parse OK o fallback con error).
    try {
      await this.callLogRepo.save(
        this.callLogRepo.create({
          tenantId,
          type: InsightType.CV_ANALYSIS,
          generatedBy,
          tokensUsed: aiCall.tokensUsed,
          inputTokens: aiCall.inputTokens,
          outputTokens: aiCall.outputTokens,
          model: MODEL,
          parseSuccess,
          errorMessage: parseError,
          insightId: savedInsight.id,
        }),
      );
    } catch (logErr: any) {
      this.logger.warn(`Failed to persist ai_call_log: ${logErr?.message ?? logErr}`);
    }

    await this.trackAddonUsage(tenantId);

    return { content, tokensUsed: aiCall.tokensUsed };
    }); // ← cierra withAiQuotaLock (analyzeCvForRecruitment)
  }

  async generateRecruitmentRecommendation(
    tenantId: string,
    processId: string,
    generatedBy: string,
    comparativeData: any,
  ): Promise<any> {
    return this.withAiQuotaLock(tenantId, async () => {
    await this.checkRateLimit(tenantId);
    await this.checkWeeklyRoleLimit(tenantId, generatedBy);

    const candidateSummaries = (comparativeData.rows || []).map((r: any) => {
      const c = r.candidate;
      const name = c.candidateType === 'internal'
        ? `${c.user?.firstName || c.firstName} ${c.user?.lastName || c.lastName} (interno)`
        : `${c.firstName} ${c.lastName} (externo)`;
      return `- ${name}: Puntaje final ${c.finalScore ?? 'N/A'}, Entrevistas ${r.interviewAvg ?? 'N/A'}, Historial ${r.internalProfile?.avgScore ?? 'N/A'}`;
    }).join('\n');

    const requirements = (comparativeData.requirements || []).map((r: any) => `[${r.category}] ${r.text}`).join('\n');

    const prompt = `Eres un experto en reclutamiento. Basandote en la comparativa de candidatos para el cargo "${comparativeData.process?.position}", genera una recomendacion.

Requisitos del cargo:
${requirements}

Candidatos:
${candidateSummaries}

Genera un JSON con:
{
  "recomendacion": "Recomendacion detallada de quien es el mejor candidato y por que",
  "ranking": [{"nombre": "...", "razon": "..."}],
  "observaciones": "Observaciones generales del proceso"
}

Responde SOLO con el JSON.`;

    const aiCall = await this.callClaude(prompt, 3000);

    let content: any;
    let parseSuccess = true;
    let parseError: string | null = null;
    try {
      content = this.parseJson(aiCall.text);
    } catch (e: any) {
      parseSuccess = false;
      parseError = (e?.message ?? String(e)).slice(0, 1000);
      // Fallback: graceful degradation (este endpoint no falla, retorna texto raw).
      content = { recomendacion: aiCall.text.slice(0, 500) };
    }

    const insight = this.insightRepo.create({
      tenantId,
      type: InsightType.RECRUITMENT_RECOMMENDATION,
      cycleId: processId,
      userId: null,
      content,
      model: 'claude-haiku-4-5',
      tokensUsed: aiCall.tokensUsed,
      generatedBy,
    });
    const savedInsight = await this.insightRepo.save(insight);

    // Audit trail SIEMPRE.
    try {
      await this.callLogRepo.save(
        this.callLogRepo.create({
          tenantId,
          type: InsightType.RECRUITMENT_RECOMMENDATION,
          generatedBy,
          tokensUsed: aiCall.tokensUsed,
          inputTokens: aiCall.inputTokens,
          outputTokens: aiCall.outputTokens,
          model: 'claude-haiku-4-5',
          parseSuccess,
          errorMessage: parseError,
          insightId: savedInsight.id,
        }),
      );
    } catch (logErr: any) {
      this.logger.warn(`Failed to persist ai_call_log: ${logErr?.message ?? logErr}`);
    }

    await this.trackAddonUsage(tenantId);

    return { content, tokensUsed: aiCall.tokensUsed };
    }); // ← cierra withAiQuotaLock (generateRecruitmentRecommendation)
  }
}
