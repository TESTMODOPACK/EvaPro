import { Injectable, NotFoundException, BadRequestException, ServiceUnavailableException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, IsNull, In } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { AiInsight, InsightType } from './entities/ai-insight.entity';
import { ReportsService } from '../reports/reports.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment, AssignmentStatus } from '../evaluations/entities/evaluation-assignment.entity';
import { User } from '../users/entities/user.entity';
import { Objective } from '../objectives/entities/objective.entity';
import { QuickFeedback } from '../feedback/entities/quick-feedback.entity';
import { Competency } from '../development/entities/competency.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { buildSummaryPrompt } from './prompts/summary.prompt';
import { buildBiasPrompt } from './prompts/bias.prompt';
import { buildSuggestionsPrompt } from './prompts/suggestions.prompt';

const MODEL = 'claude-haiku-4-5';
const CACHE_DAYS = 7;
const MAX_CALLS_PER_TENANT_PER_DAY = 50;

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
    private readonly reportsService: ReportsService,
    private readonly notificationsService: NotificationsService,
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

  /** Check rate limit: max N calls per tenant per day */
  private async checkRateLimit(tenantId: string): Promise<void> {
    const dayAgo = new Date();
    dayAgo.setDate(dayAgo.getDate() - 1);

    const recentCount = await this.insightRepo.count({
      where: { tenantId, createdAt: MoreThan(dayAgo) },
    });

    if (recentCount >= MAX_CALLS_PER_TENANT_PER_DAY) {
      throw new BadRequestException(
        `Se alcanzó el límite diario de ${MAX_CALLS_PER_TENANT_PER_DAY} análisis de IA por organización. Intente mañana.`,
      );
    }
  }

  private async callClaude(prompt: string): Promise<{ text: string; tokensUsed: number }> {
    const client = this.ensureClient();

    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      const text = textBlock ? textBlock.text : '';
      const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

      return { text, tokensUsed };
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

  private parseJson(text: string): any {
    // Remove markdown fences if present
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      this.logger.error(`Failed to parse AI response: ${cleaned.slice(0, 200)}`);
      throw new BadRequestException('La IA generó una respuesta con formato inválido. Intente nuevamente.');
    }
  }

  // ─── 3.2: Summary ──────────────────────────────────────────────────────

  async generateSummary(tenantId: string, cycleId: string, userId: string, generatedBy: string): Promise<AiInsight> {
    await this.checkRateLimit(tenantId);

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

    const { text, tokensUsed } = await this.callClaude(prompt);
    const content = this.parseJson(text);

    // Validate response structure
    if (!content.executiveSummary && !content.resumenEjecutivo && !content.fortalezas && !content.strengths) {
      this.logger.warn('AI returned unexpected summary structure, saving as-is');
    }

    const insight = this.insightRepo.create({
      tenantId, type: InsightType.SUMMARY, userId, cycleId,
      content, model: MODEL, tokensUsed, generatedBy,
    });
    const saved = await this.insightRepo.save(insight);

    try {
      await this.notificationsService.create({
        tenantId, userId: generatedBy, type: 'ai_analysis_ready' as any,
        title: 'Resumen IA generado',
        message: `El resumen de IA para ${user.firstName} ${user.lastName} está listo`,
        metadata: { insightId: saved.id, cycleId, targetUserId: userId },
      });
    } catch (e) {
      this.logger.warn(`Failed to send notification: ${e.message}`);
    }

    return saved;
  }

  // ─── 3.3: Bias Detection ───────────────────────────────────────────────

  async analyzeBias(tenantId: string, cycleId: string, generatedBy: string): Promise<AiInsight> {
    await this.checkRateLimit(tenantId);

    const cached = await this.getCached(tenantId, InsightType.BIAS, cycleId);
    if (cached) return cached;

    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });
    if (!cycle) throw new NotFoundException('Ciclo no encontrado');

    // Get all responses with evaluator info
    const raw = await this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
      .innerJoin(User, 'evaluator', 'evaluator.id = a.evaluator_id')
      .innerJoin(User, 'evaluatee', 'evaluatee.id = a.evaluatee_id')
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

    const { text, tokensUsed } = await this.callClaude(prompt);
    const content = this.parseJson(text);

    const insight = this.insightRepo.create({
      tenantId, type: InsightType.BIAS, userId: null, cycleId,
      content, model: MODEL, tokensUsed, generatedBy,
    });
    const saved = await this.insightRepo.save(insight);

    try {
      await this.notificationsService.create({
        tenantId, userId: generatedBy, type: 'ai_analysis_ready' as any,
        title: 'Análisis de sesgos generado',
        message: `El análisis de sesgos del ciclo "${cycle.name}" está listo`,
        metadata: { insightId: saved.id, cycleId },
      });
    } catch (e) {
      this.logger.warn(`Failed to send notification: ${e.message}`);
    }

    return saved;
  }

  // ─── 3.4: Suggestions ──────────────────────────────────────────────────

  async generateSuggestions(tenantId: string, cycleId: string, userId: string, generatedBy: string): Promise<AiInsight> {
    await this.checkRateLimit(tenantId);

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

    const { text, tokensUsed } = await this.callClaude(prompt);
    const content = this.parseJson(text);

    const insight = this.insightRepo.create({
      tenantId, type: InsightType.SUGGESTIONS, userId, cycleId,
      content, model: MODEL, tokensUsed, generatedBy,
    });
    const saved = await this.insightRepo.save(insight);

    try {
      await this.notificationsService.create({
        tenantId, userId: generatedBy, type: 'ai_analysis_ready' as any,
        title: 'Sugerencias de desarrollo generadas',
        message: `Las sugerencias de mejora para ${user.firstName} ${user.lastName} están listas`,
        metadata: { insightId: saved.id, cycleId, targetUserId: userId },
      });
    } catch (e) {
      this.logger.warn(`Failed to send notification: ${e.message}`);
    }

    return saved;
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
  async getFlightRiskScores(tenantId: string): Promise<{
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
    const employees = await this.userRepo.find({
      where: { tenantId, role: In(['employee', 'manager']), isActive: true },
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
}
