import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
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

const MODEL = 'claude-3-5-haiku-20241022';
const CACHE_DAYS = 7;

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
      throw new BadRequestException(
        'La funcionalidad de IA no está disponible. Contacte al administrador para configurar ANTHROPIC_API_KEY.',
      );
    }
    return this.client;
  }

  // ─── Cache helpers ──────────────────────────────────────────────────────

  private async getCached(tenantId: string, type: InsightType, cycleId: string, userId?: string): Promise<AiInsight | null> {
    const cacheDate = new Date();
    cacheDate.setDate(cacheDate.getDate() - CACHE_DAYS);

    const where: any = { tenantId, type, cycleId, createdAt: MoreThan(cacheDate) };
    if (userId) where.userId = userId;
    else where.userId = null as any;

    return this.insightRepo.findOne({ where, order: { createdAt: 'DESC' } });
  }

  async getInsight(tenantId: string, type: InsightType, cycleId: string, userId?: string): Promise<AiInsight | null> {
    const where: any = { tenantId, type, cycleId };
    if (userId) where.userId = userId;
    else where.userId = null as any;
    return this.insightRepo.findOne({ where, order: { createdAt: 'DESC' } });
  }

  private async callClaude(prompt: string): Promise<{ text: string; tokensUsed: number }> {
    const client = this.ensureClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock ? textBlock.text : '';
    const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

    return { text, tokensUsed };
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
    // Check cache
    const cached = await this.getCached(tenantId, InsightType.SUMMARY, cycleId, userId);
    if (cached) return cached;

    // Gather data
    const user = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Colaborador no encontrado');

    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });
    if (!cycle) throw new NotFoundException('Ciclo no encontrado');

    const [individualResults, competencyRadar, selfVsOthers] = await Promise.all([
      this.reportsService.individualResults(cycleId, userId, tenantId),
      this.reportsService.competencyRadar(cycleId, userId, tenantId),
      this.reportsService.selfVsOthers(cycleId, userId, tenantId),
    ]);

    // Get text responses
    const textResponses = await this.getTextResponses(tenantId, cycleId, userId);

    const prompt = buildSummaryPrompt({
      employeeName: `${user.firstName} ${user.lastName}`,
      position: user.position || '',
      department: user.department || '',
      cycleName: cycle.name,
      individualResults,
      competencyRadar,
      selfVsOthers,
      textResponses,
    });

    const { text, tokensUsed } = await this.callClaude(prompt);
    const content = this.parseJson(text);

    const insight = this.insightRepo.create({
      tenantId, type: InsightType.SUMMARY, userId, cycleId,
      content, model: MODEL, tokensUsed, generatedBy,
    });
    const saved = await this.insightRepo.save(insight);

    // Notify
    await this.notificationsService.create({
      tenantId, userId: generatedBy, type: 'ai_analysis_ready' as any,
      title: 'Resumen IA generado',
      message: `El resumen de IA para ${user.firstName} ${user.lastName} está listo`,
      metadata: { insightId: saved.id, cycleId, targetUserId: userId },
    });

    return saved;
  }

  // ─── 3.3: Bias Detection ───────────────────────────────────────────────

  async analyzeBias(tenantId: string, cycleId: string, generatedBy: string): Promise<AiInsight> {
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

    await this.notificationsService.create({
      tenantId, userId: generatedBy, type: 'ai_analysis_ready' as any,
      title: 'Análisis de sesgos generado',
      message: `El análisis de sesgos del ciclo "${cycle.name}" está listo`,
      metadata: { insightId: saved.id, cycleId },
    });

    return saved;
  }

  // ─── 3.4: Suggestions ──────────────────────────────────────────────────

  async generateSuggestions(tenantId: string, cycleId: string, userId: string, generatedBy: string): Promise<AiInsight> {
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
      employeeName: `${user.firstName} ${user.lastName}`,
      position: user.position || '',
      department: user.department || '',
      cycleName: cycle.name,
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

    await this.notificationsService.create({
      tenantId, userId: generatedBy, type: 'ai_analysis_ready' as any,
      title: 'Sugerencias de desarrollo generadas',
      message: `Las sugerencias de mejora para ${user.firstName} ${user.lastName} están listas`,
      metadata: { insightId: saved.id, cycleId, targetUserId: userId },
    });

    return saved;
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
