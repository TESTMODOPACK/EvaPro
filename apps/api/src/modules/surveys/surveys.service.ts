import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, In, IsNull, DataSource } from 'typeorm';
import { EngagementSurvey } from './entities/engagement-survey.entity';
import { SurveyQuestion } from './entities/survey-question.entity';
import { SurveyResponse } from './entities/survey-response.entity';
import { SurveyAssignment } from './entities/survey-assignment.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';
import { AiInsightsService } from '../ai-insights/ai-insights.service';
import { OrgDevelopmentService } from '../org-development/org-development.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AuditService } from '../audit/audit.service';
import { PlanFeature } from '../../common/constants/plan-features';

@Injectable()
export class SurveysService {
  private readonly logger = new Logger(SurveysService.name);

  constructor(
    @InjectRepository(EngagementSurvey)
    private readonly surveyRepo: Repository<EngagementSurvey>,
    @InjectRepository(SurveyQuestion)
    private readonly questionRepo: Repository<SurveyQuestion>,
    @InjectRepository(SurveyResponse)
    private readonly responseRepo: Repository<SurveyResponse>,
    @InjectRepository(SurveyAssignment)
    private readonly assignmentRepo: Repository<SurveyAssignment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
    private readonly aiInsightsService: AiInsightsService,
    private readonly orgDevService: OrgDevelopmentService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly auditService: AuditService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ─── Feature gate ──────────────────────────────────────────────────────

  private async checkFeature(tenantId: string, feature: string = PlanFeature.ENGAGEMENT_SURVEYS): Promise<void> {
    const sub = await this.subscriptionsService.findByTenantId(tenantId);
    if (!sub || !sub.plan) {
      throw new ForbiddenException('No se encontró una suscripción activa para este tenant.');
    }
    const features: string[] = sub.plan.features || [];
    if (!features.includes(feature)) {
      throw new ForbiddenException(
        `Su plan "${sub.plan.name}" no incluye esta funcionalidad. Actualice a un plan superior.`,
      );
    }
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    userId: string,
    dto: {
      title: string;
      description?: string;
      isAnonymous?: boolean;
      targetAudience?: string;
      targetDepartments?: string[];
      startDate: string;
      endDate: string;
      settings?: Record<string, any>;
      questions: Array<{
        category: string;
        questionText: string;
        questionType: string;
        options?: string[];
        isRequired?: boolean;
        sortOrder?: number;
      }>;
    },
  ): Promise<EngagementSurvey> {
    await this.checkFeature(tenantId);

    if (!dto.questions || dto.questions.length === 0) {
      throw new BadRequestException('La encuesta debe tener al menos una pregunta.');
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) {
      throw new BadRequestException('La fecha de fin debe ser posterior a la fecha de inicio.');
    }

    const survey = this.surveyRepo.create({
      tenantId,
      title: dto.title,
      description: dto.description ?? null,
      isAnonymous: dto.isAnonymous ?? true,
      targetAudience: dto.targetAudience ?? 'all',
      targetDepartments: dto.targetDepartments ?? [],
      startDate,
      endDate,
      createdBy: userId,
      settings: dto.settings ?? {},
      status: 'draft',
    });
    const saved = await this.surveyRepo.save(survey);

    // Create questions
    const questions = dto.questions.map((q, i) =>
      this.questionRepo.create({
        surveyId: saved.id,
        category: q.category,
        questionText: q.questionText,
        questionType: q.questionType,
        options: q.options ?? null,
        isRequired: q.isRequired ?? true,
        sortOrder: q.sortOrder ?? i,
      }),
    );
    await this.questionRepo.save(questions);

    await this.auditService.log(tenantId, userId, 'survey_created', 'engagement_survey', saved.id, { title: dto.title });

    return this.findById(tenantId, saved.id);
  }

  async findAll(tenantId: string): Promise<EngagementSurvey[]> {
    // Tenant guard on creator join — survey.createdBy could be orphan
    // cross-tenant after a data migration.
    return this.surveyRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.creator', 'creator', 'creator.tenant_id = s.tenant_id')
      .where('s.tenantId = :tenantId', { tenantId })
      .orderBy('s.createdAt', 'DESC')
      .take(200) // Safety cap — surveys are low-volume
      .getMany();
  }

  async findById(tenantId: string, surveyId: string): Promise<EngagementSurvey> {
    const survey = await this.surveyRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.creator', 'creator', 'creator.tenant_id = s.tenant_id')
      .leftJoinAndSelect('s.questions', 'questions')
      .where('s.id = :id', { id: surveyId })
      .andWhere('s.tenantId = :tenantId', { tenantId })
      .orderBy('questions.sortOrder', 'ASC')
      .getOne();
    if (!survey) throw new NotFoundException('Encuesta no encontrada');
    return survey;
  }

  async update(
    tenantId: string,
    surveyId: string,
    dto: {
      title?: string;
      description?: string;
      isAnonymous?: boolean;
      targetAudience?: string;
      targetDepartments?: string[];
      startDate?: string;
      endDate?: string;
      settings?: Record<string, any>;
      questions?: Array<{
        id?: string;
        category: string;
        questionText: string;
        questionType: string;
        options?: string[];
        isRequired?: boolean;
        sortOrder?: number;
      }>;
    },
  ): Promise<EngagementSurvey> {
    const survey = await this.surveyRepo.findOne({ where: { id: surveyId, tenantId } });
    if (!survey) throw new NotFoundException('Encuesta no encontrada');
    if (survey.status !== 'draft') throw new BadRequestException('Solo se pueden editar encuestas en borrador.');

    if (dto.title !== undefined) survey.title = dto.title;
    if (dto.description !== undefined) survey.description = dto.description;
    if (dto.isAnonymous !== undefined) survey.isAnonymous = dto.isAnonymous;
    if (dto.targetAudience !== undefined) survey.targetAudience = dto.targetAudience;
    if (dto.targetDepartments !== undefined) survey.targetDepartments = dto.targetDepartments;
    if (dto.startDate !== undefined) survey.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) survey.endDate = new Date(dto.endDate);
    if (dto.settings !== undefined) survey.settings = dto.settings;

    // Wrap the survey save and question replace in a single transaction so
    // a crash between DELETE and INSERT of the new questions cannot leave the
    // survey with zero questions (or a mix of old+new).
    await this.dataSource.transaction(async (manager) => {
      await manager.save(survey);

      if (dto.questions) {
        await manager.delete(SurveyQuestion, { surveyId });
        const questions = dto.questions!.map((q, i) =>
          manager.getRepository(SurveyQuestion).create({
            surveyId,
            category: q.category,
            questionText: q.questionText,
            questionType: q.questionType,
            options: q.options ?? null,
            isRequired: q.isRequired ?? true,
            sortOrder: q.sortOrder ?? i,
          }),
        );
        await manager.save(questions);
      }
    });

    return this.findById(tenantId, surveyId);
  }

  /**
   * Eliminar una encuesta. Dos modos:
   * - role != super_admin → solo puede eliminar en status 'draft'
   * - role == super_admin (force=true) → puede eliminar en CUALQUIER estado,
   *   incluyendo 'closed'. Elimina en cascada: responses, assignments, questions,
   *   y el insight de AI si existe.
   *
   * La eliminacion es HARD DELETE (no soft-delete) porque las encuestas
   * contienen datos anonimizados que no deben persistir si el admin decide
   * borrarlas. Las respuestas se eliminan via CASCADE en la relacion FK.
   */
  async delete(tenantId: string, surveyId: string, callerRole?: string): Promise<void> {
    const survey = await this.surveyRepo.findOne({ where: { id: surveyId, tenantId } });
    if (!survey) throw new NotFoundException('Encuesta no encontrada');

    const isAdmin = callerRole === 'super_admin' || callerRole === 'tenant_admin';

    // Non-admin (manager/employee) solo puede eliminar borradores
    if (!isAdmin && survey.status !== 'draft') {
      throw new BadRequestException('Solo se pueden eliminar encuestas en borrador. Contacte al administrador para eliminar encuestas activas o cerradas.');
    }

    // Si la encuesta tiene respuestas, advertir (pero permitir si es super_admin)
    if (survey.status !== 'draft') {
      const responseCount = await this.responseRepo.count({ where: { surveyId, tenantId } });
      if (responseCount > 0) {
        this.logger.warn(
          `Super admin deleting survey "${survey.title}" (${surveyId}) with ${responseCount} responses`,
        );
      }
    }

    // Eliminar insight de AI si existe (no tiene CASCADE a la encuesta)
    try {
      await this.aiInsightsService.clearCache(tenantId, 'survey_analysis' as any, surveyId);
    } catch { /* ignore — insight may not exist */ }

    await this.surveyRepo.remove(survey);

    // Cleanup notifications referencing this survey
    this.notificationsService.cleanupByMetadata(tenantId, 'surveyId', surveyId).catch((e) => this.logger.warn(`Survey notification cleanup failed: ${e.message}`));
  }

  // ─── Distribution ──────────────────────────────────────────────────────

  async launch(tenantId: string, surveyId: string): Promise<EngagementSurvey> {
    const survey = await this.findById(tenantId, surveyId);
    if (survey.status !== 'draft') throw new BadRequestException('La encuesta ya fue lanzada.');
    if (!survey.questions || survey.questions.length === 0) throw new BadRequestException('La encuesta no tiene preguntas.');

    // Resolve target users
    const targetUsers = await this.getTargetUsers(tenantId, survey);
    if (targetUsers.length === 0) throw new BadRequestException('No hay usuarios objetivo para esta encuesta.');

    // Update status
    survey.status = 'active';
    await this.surveyRepo.save(survey);

    // Create assignments
    const assignments = targetUsers.map((u) =>
      this.assignmentRepo.create({
        surveyId,
        tenantId,
        userId: u.id,
        status: 'pending',
      }),
    );
    await this.assignmentRepo.save(assignments);

    // Send notifications + emails
    const notifications = targetUsers.map((u) => ({
      tenantId,
      userId: u.id,
      type: 'survey_invitation' as any,
      title: 'Nueva encuesta de clima',
      message: `Se te ha asignado la encuesta "${survey.title}". ${survey.isAnonymous ? 'Tus respuestas serán anónimas.' : ''}`,
      metadata: { surveyId },
    }));
    await this.notificationsService.createBulk(notifications);

    // Send emails (non-blocking)
    for (const u of targetUsers) {
      this.emailService.sendSurveyInvitation(u.email, {
        firstName: u.firstName,
        surveyTitle: survey.title,
        dueDate: survey.endDate.toISOString().split('T')[0],
        isAnonymous: survey.isAnonymous,
      }).catch((e) => this.logger.error(`Error sending survey email to ${u.email}: ${e.message}`));
    }

    this.logger.log(`Survey "${survey.title}" launched to ${targetUsers.length} users`);
    return this.findById(tenantId, surveyId);
  }

  private async getTargetUsers(tenantId: string, survey: EngagementSurvey): Promise<User[]> {
    const where: any = { tenantId, isActive: true };

    if (survey.targetAudience === 'by_department' && survey.targetDepartments.length > 0) {
      // Prefer departmentId if available (targetDepartmentIds), fallback to text
      if ((survey as any).targetDepartmentIds?.length > 0) {
        where.departmentId = In((survey as any).targetDepartmentIds);
      } else {
        where.department = In(survey.targetDepartments);
      }
    }
    // 'all' or 'custom' (custom uses all for now, can be extended)

    const users = await this.userRepo.find({
      where,
      select: ['id', 'email', 'firstName', 'lastName', 'department', 'role'],
    });
    // Exclude super_admin — they are platform administrators, not organization collaborators
    return users.filter((u) => u.role !== 'super_admin');
  }

  // ─── Responses ─────────────────────────────────────────────────────────

  async submitResponse(
    tenantId: string,
    surveyId: string,
    userId: string,
    answers: Array<{ questionId: string; value: number | string | string[] }>,
  ): Promise<SurveyResponse> {
    const survey = await this.surveyRepo.findOne({ where: { id: surveyId, tenantId } });
    if (!survey) throw new NotFoundException('Encuesta no encontrada');
    if (survey.status !== 'active') throw new BadRequestException('La encuesta no está activa.');

    // Get user department snapshot
    const user = await this.userRepo.findOne({ where: { id: userId, tenantId }, select: ['id', 'department'] });

    // Check if already responded (for non-anonymous surveys)
    let existing: SurveyResponse | null = null;
    if (!survey.isAnonymous) {
      existing = await this.responseRepo.findOne({
        where: { surveyId, tenantId, respondentId: userId },
      });
      if (existing && existing.isComplete) {
        throw new BadRequestException('Ya has respondido esta encuesta.');
      }
    }

    // For anonymous surveys, check via assignment to prevent double submissions
    const assignment = await this.assignmentRepo.findOne({ where: { surveyId, userId, tenantId } });
    if (survey.isAnonymous && assignment?.status === 'completed') {
      throw new BadRequestException('Ya has respondido esta encuesta.');
    }

    // Create or update response
    const isNewResponse = !existing;
    const response = existing || this.responseRepo.create({
      surveyId,
      tenantId,
      respondentId: survey.isAnonymous ? null : userId,
      department: user?.department ?? null,
    });

    response.answers = answers;
    response.isComplete = true;
    response.submittedAt = new Date();

    const saved = await this.responseRepo.save(response);

    // Update assignment
    if (assignment && assignment.status !== 'completed') {
      assignment.status = 'completed';
      assignment.completedAt = new Date();
      await this.assignmentRepo.save(assignment);
    }

    // Update response count only for new responses
    if (isNewResponse) {
      await this.surveyRepo.increment({ id: surveyId, tenantId }, 'responseCount', 1);
    }

    // Cleanup survey notifications for this user (they already responded)
    this.notificationsService.cleanupByMetadata(tenantId, 'surveyId', surveyId, {
      userId,
      types: ['survey_invitation', 'survey_reminder'],
    }).catch(() => {});

    return saved;
  }

  async getMyPendingSurveys(tenantId: string, userId: string): Promise<any[]> {
    const assignments = await this.assignmentRepo.find({
      where: { tenantId, userId, status: 'pending' },
      relations: ['survey'],
    });

    return assignments
      .filter((a) => a.survey && a.survey.status === 'active')
      .map((a) => ({
        id: a.survey.id,
        title: a.survey.title,
        description: a.survey.description,
        isAnonymous: a.survey.isAnonymous,
        endDate: a.survey.endDate,
        questionCount: 0, // Will be filled in frontend if needed
        assignmentId: a.id,
      }));
  }

  // ─── Results ───────────────────────────────────────────────────────────

  /**
   * Encuestas activas que terminarán pronto Y tienen baja participación.
   * Se usa en el CommandCenter del dashboard del admin como alerta.
   *
   * Reglas:
   *   - status === 'active'
   *   - endDate ≤ ahora + `daysWindow` (default 5 días por cerrar)
   *   - participación < `threshold` (default 50%)
   *
   * Retorna metadata mínima por encuesta: id, title, daysLeft, %participación.
   */
  async getLowParticipationActiveSurveys(
    tenantId: string,
    threshold: number = 50,
    daysWindow: number = 5,
  ): Promise<Array<{ id: string; title: string; endDate: Date | null; daysLeft: number | null; participationPct: number; respondents: number; assigned: number }>> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + daysWindow * 86_400_000);
    // Sólo encuestas activas; si tienen endDate, filtramos por ventana.
    const activeSurveys = await this.surveyRepo.find({
      where: { tenantId, status: 'active' },
    });
    if (activeSurveys.length === 0) return [];

    const out = [] as Array<{ id: string; title: string; endDate: Date | null; daysLeft: number | null; participationPct: number; respondents: number; assigned: number }>;
    for (const survey of activeSurveys) {
      const end = survey.endDate ? new Date(survey.endDate) : null;
      // Si tiene endDate y queda fuera de la ventana de alerta, skip
      if (end && end > windowEnd) continue;
      // Si ya venció (endDate < ahora), también lo incluimos — el admin
      // necesita saber que está sin cerrar manualmente.
      const assigned = await this.assignmentRepo.count({ where: { surveyId: survey.id, tenantId } });
      if (assigned === 0) continue; // no asignada → no aplica alerta de baja participación
      const respondents = await this.responseRepo.count({ where: { surveyId: survey.id, tenantId, isComplete: true } });
      const participationPct = Math.round((respondents / assigned) * 100);
      if (participationPct >= threshold) continue;

      const daysLeft = end ? Math.ceil((end.getTime() - now.getTime()) / 86_400_000) : null;
      out.push({
        id: survey.id,
        title: survey.title,
        endDate: end,
        daysLeft,
        participationPct,
        respondents,
        assigned,
      });
    }
    // Ordenar por más urgentes primero (menos días restantes / más vencidas)
    out.sort((a, b) => {
      if (a.daysLeft == null && b.daysLeft == null) return a.participationPct - b.participationPct;
      if (a.daysLeft == null) return 1;
      if (b.daysLeft == null) return -1;
      return a.daysLeft - b.daysLeft;
    });
    return out;
  }

  async getResults(tenantId: string, surveyId: string): Promise<any> {
    const survey = await this.findById(tenantId, surveyId);
    const responses = await this.responseRepo.find({ where: { surveyId, tenantId, isComplete: true } });
    const totalAssignments = await this.assignmentRepo.count({ where: { surveyId, tenantId } });

    if (responses.length === 0) {
      return {
        survey: { id: survey.id, title: survey.title, status: survey.status },
        responseRate: 0,
        totalResponses: 0,
        totalAssigned: totalAssignments,
        averageByCategory: [],
        averageByQuestion: [],
        likertDistribution: [],
        openResponses: [],
      };
    }

    // Calculate averages by category
    // Note: climate surveys use likert_5 internally (scores 1-5) but we
    // present results on a 1-10 scale (×2) so they can be compared directly
    // against the 1-10 performance evaluation scale. NPS questions are
    // already 0-10 and remain unchanged.
    const categoryScores: Record<string, number[]> = {};
    const questionScores: Record<string, number[]> = {};
    const openResponses: Array<{ questionId: string; questionText: string; category: string; text: string }> = [];

    for (const r of responses) {
      for (const ans of r.answers) {
        const question = survey.questions.find((q) => q.id === ans.questionId);
        if (!question) continue;

        if (question.questionType === 'likert_5' || question.questionType === 'nps') {
          const raw = typeof ans.value === 'number' ? ans.value : parseFloat(ans.value as string);
          if (!isNaN(raw)) {
            // Normalize likert_5 (1-5) → 2-10 to align with NPS/perf scale.
            const numVal = question.questionType === 'likert_5' ? raw * 2 : raw;
            if (!categoryScores[question.category]) categoryScores[question.category] = [];
            categoryScores[question.category].push(numVal);

            if (!questionScores[question.id]) questionScores[question.id] = [];
            questionScores[question.id].push(numVal);
          }
        } else if (question.questionType === 'open_text' && ans.value) {
          openResponses.push({
            questionId: question.id,
            questionText: question.questionText,
            category: question.category,
            text: String(ans.value),
          });
        }
      }
    }

    // Average by category (already in 1-10 scale)
    const averageByCategory = Object.entries(categoryScores).map(([category, scores]) => ({
      category,
      average: Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
      count: scores.length,
    })).sort((a, b) => b.average - a.average);

    // Average by question (1-10 scale)
    const averageByQuestion = survey.questions
      .filter((q) => q.questionType === 'likert_5')
      .map((q) => {
        const scores = questionScores[q.id] || [];
        return {
          questionId: q.id,
          questionText: q.questionText,
          category: q.category,
          average: scores.length > 0 ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : 0,
          count: scores.length,
        };
      })
      .sort((a, b) => b.average - a.average);

    // Likert distribution per question — buckets 2,4,6,8,10 (×2 of 1-5 raw)
    const likertDistribution = survey.questions
      .filter((q) => q.questionType === 'likert_5')
      .map((q) => {
        const scores = questionScores[q.id] || []; // already ×2
        const dist: Record<number, number> = { 2: 0, 4: 0, 6: 0, 8: 0, 10: 0 };
        for (const s of scores) {
          const bucket = Math.round(s) as number;
          if (dist[bucket] !== undefined) dist[bucket] += 1;
        }
        const total = scores.length || 1;
        return {
          questionId: q.id,
          questionText: q.questionText,
          category: q.category,
          distribution: Object.entries(dist).map(([level, count]) => ({
            level: Number(level),
            count,
            percentage: Number(((count / total) * 100).toFixed(1)),
          })),
        };
      });

    // Overall average (1-10 scale)
    const allScores = Object.values(categoryScores).flat().filter((v) => v >= 0 && v <= 10);
    const overallAverage = allScores.length > 0
      ? Number((allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2))
      : 0;

    return {
      survey: { id: survey.id, title: survey.title, status: survey.status, isAnonymous: survey.isAnonymous },
      responseRate: totalAssignments > 0 ? Number(((responses.length / totalAssignments) * 100).toFixed(1)) : 0,
      totalResponses: responses.length,
      totalAssigned: totalAssignments,
      overallAverage,
      averageByCategory,
      averageByQuestion,
      likertDistribution,
      openResponses,
    };
  }

  async getENPS(tenantId: string, surveyId: string): Promise<any> {
    const survey = await this.findById(tenantId, surveyId);
    const responses = await this.responseRepo.find({ where: { surveyId, tenantId, isComplete: true } });

    const npsQuestions = survey.questions.filter((q) => q.questionType === 'nps');
    const likertQuestions = survey.questions.filter((q) => q.questionType === 'likert_5');

    // Strategy: prefer native NPS questions if available; otherwise derive
    // eNPS from likert_5 responses by applying the standard 0-10 classification
    // on each respondent's likert average ×2 (so max 5 → 10 = promoter).
    // See AIHR/CultureMonkey/Matter references — this is equivalent to the
    // 5-point eNPS mapping Promoter=5, Passive=4, Detractor=1-3.
    const useNps = npsQuestions.length > 0;
    const sourceQuestions = useNps ? npsQuestions : likertQuestions;

    if (sourceQuestions.length === 0) {
      return { enps: null, message: 'La encuesta no tiene preguntas Likert ni NPS con las que calcular eNPS.' };
    }

    let promoters = 0;
    let passives = 0;
    let detractors = 0;

    for (const r of responses) {
      const scores: number[] = [];
      for (const ans of r.answers) {
        const question = sourceQuestions.find((q) => q.id === ans.questionId);
        if (!question) continue;

        const raw = typeof ans.value === 'number' ? ans.value : parseFloat(ans.value as string);
        if (isNaN(raw)) continue;
        // Likert 1-5 → 2-10 for classification; NPS already 0-10.
        scores.push(question.questionType === 'likert_5' ? raw * 2 : raw);
      }

      if (scores.length === 0) continue;

      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avgScore >= 9) promoters++;
      else if (avgScore >= 7) passives++;
      else detractors++;
    }

    const total = promoters + passives + detractors;
    if (total === 0) {
      return { enps: null, message: 'Sin respuestas suficientes para calcular eNPS.', source: useNps ? 'nps_question' : 'likert_derived' };
    }
    const enps = Math.round(((promoters - detractors) / total) * 100);

    return {
      enps,
      promoters,
      passives,
      detractors,
      total,
      promoterPercent: Number(((promoters / total) * 100).toFixed(1)),
      passivePercent: Number(((passives / total) * 100).toFixed(1)),
      detractorPercent: Number(((detractors / total) * 100).toFixed(1)),
      source: useNps ? 'nps_question' : 'likert_derived',
    };
  }

  async getResultsByDepartment(tenantId: string, surveyId: string): Promise<any[]> {
    const survey = await this.findById(tenantId, surveyId);
    const responses = await this.responseRepo.find({ where: { surveyId, tenantId, isComplete: true } });

    const deptScores: Record<string, { scores: number[]; count: number }> = {};

    for (const r of responses) {
      const dept = r.department || 'Sin departamento';
      if (!deptScores[dept]) deptScores[dept] = { scores: [], count: 0 };
      deptScores[dept].count++;

      for (const ans of r.answers) {
        const question = survey.questions.find((q) => q.id === ans.questionId);
        if (!question || question.questionType !== 'likert_5') continue;

        const raw = typeof ans.value === 'number' ? ans.value : parseFloat(ans.value as string);
        if (!isNaN(raw)) {
          // Normalize likert_5 (1-5) → 2-10 so the department averages match
          // the 1-10 scale used everywhere else (getSurveyResults, eNPS, etc).
          deptScores[dept].scores.push(raw * 2);
        }
      }
    }

    return Object.entries(deptScores).map(([department, data]) => ({
      department,
      responseCount: data.count,
      average: data.scores.length > 0 ? Number((data.scores.reduce((a, b) => a + b, 0) / data.scores.length).toFixed(2)) : 0,
    })).sort((a, b) => b.average - a.average);
  }

  async getTrends(tenantId: string): Promise<any[]> {
    const surveys = await this.surveyRepo.find({
      where: { tenantId, status: 'closed' },
      order: { endDate: 'ASC' },
    });

    const trends: any[] = [];

    for (const survey of surveys) {
      const questions = await this.questionRepo.find({ where: { surveyId: survey.id } });
      const responses = await this.responseRepo.find({ where: { surveyId: survey.id, tenantId, isComplete: true } });
      const totalAssigned = await this.assignmentRepo.count({ where: { surveyId: survey.id, tenantId } });

      const categoryScores: Record<string, number[]> = {};
      for (const r of responses) {
        for (const ans of r.answers) {
          const q = questions.find((q) => q.id === ans.questionId);
          if (!q || q.questionType !== 'likert_5') continue;
          const raw = typeof ans.value === 'number' ? ans.value : parseFloat(ans.value as string);
          if (!isNaN(raw)) {
            if (!categoryScores[q.category]) categoryScores[q.category] = [];
            // Normalize to 1-10 scale so trends are consistent with
            // getSurveyResults / getResultsByDepartment / eNPS.
            categoryScores[q.category].push(raw * 2);
          }
        }
      }

      const categories = Object.entries(categoryScores).map(([category, scores]) => ({
        category,
        average: Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
      }));

      const allScores = Object.values(categoryScores).flat();

      trends.push({
        surveyId: survey.id,
        title: survey.title,
        endDate: survey.endDate,
        responseRate: totalAssigned > 0 ? Number(((responses.length / totalAssigned) * 100).toFixed(1)) : 0,
        overallAverage: allScores.length > 0 ? Number((allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2)) : 0,
        categories,
      });
    }

    return trends;
  }

  // ─── Close ─────────────────────────────────────────────────────────────

  async closeSurvey(tenantId: string, surveyId: string): Promise<EngagementSurvey> {
    const survey = await this.surveyRepo.findOne({ where: { id: surveyId, tenantId } });
    if (!survey) throw new NotFoundException('Encuesta no encontrada');
    if (survey.status !== 'active') throw new BadRequestException('Solo se pueden cerrar encuestas activas.');

    // Validar que tenga al menos 1 respuesta completa antes de cerrar.
    // Cerrar sin respuestas genera reportes vacios y un eNPS sin datos,
    // lo cual confunde al admin cuando ve "0" o "—" en el dashboard.
    const responseCount = await this.responseRepo.count({
      where: { surveyId, tenantId, isComplete: true },
    });
    if (responseCount === 0) {
      throw new BadRequestException(
        'No se puede cerrar la encuesta porque no tiene respuestas completadas. Espere a que al menos un colaborador responda antes de cerrar.',
      );
    }

    survey.status = 'closed';
    await this.surveyRepo.save(survey);

    // Cleanup pending survey notifications (invitation + reminders)
    this.notificationsService.cleanupByMetadata(tenantId, 'surveyId', surveyId, {
      types: ['survey_invitation', 'survey_reminder'],
    }).catch(() => {});

    this.logger.log(`Survey "${survey.title}" closed with ${responseCount} responses`);
    return this.findById(tenantId, surveyId);
  }

  // ─── AI Analysis ───────────────────────────────────────────────────────

  async generateAiAnalysis(
    tenantId: string,
    surveyId: string,
    generatedBy: string,
    force = false,
  ): Promise<any> {
    // Check AI feature
    await this.checkFeature(tenantId, PlanFeature.AI_INSIGHTS);

    const results = await this.getResults(tenantId, surveyId);
    const enps = await this.getENPS(tenantId, surveyId);
    const deptResults = await this.getResultsByDepartment(tenantId, surveyId);

    if (results.totalResponses === 0) {
      throw new BadRequestException('No hay respuestas para analizar.');
    }

    return this.aiInsightsService.analyzeSurvey(
      tenantId,
      surveyId,
      generatedBy,
      {
        surveyTitle: results.survey.title,
        responseRate: results.responseRate,
        totalResponses: results.totalResponses,
        overallAverage: results.overallAverage,
        averageByCategory: results.averageByCategory,
        averageByQuestion: results.averageByQuestion,
        enps,
        departmentResults: deptResults,
        openResponses: results.openResponses.slice(0, 50), // Limit to avoid token overflow
      },
      { force },
    );
  }

  async getAiAnalysis(tenantId: string, surveyId: string): Promise<any> {
    return this.aiInsightsService.getInsight(tenantId, 'survey_analysis' as any, surveyId);
  }

  // ─── Org Development Integration ──────────────────────────────────────

  async createInitiativesFromSurvey(
    tenantId: string,
    surveyId: string,
    targetPlanId?: string,
  ): Promise<any> {
    const analysis = await this.aiInsightsService.getInsight(tenantId, 'survey_analysis' as any, surveyId);
    if (!analysis) throw new NotFoundException('Primero debe generar el análisis AI de la encuesta.');

    const suggestedInitiatives = analysis.content?.suggestedInitiatives;
    if (!suggestedInitiatives || suggestedInitiatives.length === 0) {
      throw new BadRequestException('El análisis AI no generó iniciativas sugeridas.');
    }

    // Find or determine the target org plan
    let planId = targetPlanId;
    if (!planId) {
      // Try to find active plan for current year
      const plans = await this.orgDevService.findAllPlans(tenantId);
      const currentYear = new Date().getFullYear();
      const activePlan = plans.find((p) => p.year === currentYear && p.status === 'activo');
      if (activePlan) {
        planId = activePlan.id;
      } else {
        throw new BadRequestException('No hay un plan de desarrollo organizacional activo. Seleccione un plan destino.');
      }
    }

    const createdInitiatives: any[] = [];

    for (const suggestion of suggestedInitiatives) {
      const initiative = await this.orgDevService.createInitiative(tenantId, planId, {
        title: `[Clima] ${suggestion.title}`,
        description: suggestion.description || undefined,
        department: suggestion.department || null,
        status: 'pendiente',
      });

      // Create actions from action items
      if (suggestion.actionItems && Array.isArray(suggestion.actionItems)) {
        for (const actionTitle of suggestion.actionItems) {
          await this.orgDevService.addAction(tenantId, initiative.id, {
            title: actionTitle,
            actionType: 'otro',
          });
        }
      }

      createdInitiatives.push(initiative);
    }

    this.logger.log(`Created ${createdInitiatives.length} org initiatives from survey ${surveyId}`);
    return { created: createdInitiatives.length, initiatives: createdInitiatives };
  }

  // ─── Cron: Survey Reminders ────────────────────────────────────────────

  @Cron('0 10 * * *') // Daily at 10am
  async remindIncompleteSurveys() {
    this.logger.log('[Cron] Checking incomplete survey responses...');
    try {
      const activeSurveys = await this.surveyRepo.find({
        where: { status: 'active' },
      });

      for (const survey of activeSurveys) {
        // Skip if past end date
        if (new Date() > survey.endDate) continue;

        const pendingAssignments = await this.assignmentRepo.find({
          where: { surveyId: survey.id, status: 'pending' },
          relations: ['user'],
        });

        const toNotify = pendingAssignments.filter((a) => a.reminderCount < 3 && a.user);

        if (toNotify.length === 0) continue;

        const notifications = toNotify.map((a) => ({
          tenantId: a.tenantId,
          userId: a.userId,
          type: 'survey_reminder' as any,
          title: 'Recordatorio: encuesta pendiente',
          message: `Tienes pendiente la encuesta "${survey.title}". ${survey.isAnonymous ? 'Tus respuestas son anónimas.' : ''} Fecha límite: ${survey.endDate.toISOString().split('T')[0]}.`,
          metadata: { surveyId: survey.id },
        }));

        await this.notificationsService.createBulk(notifications);

        // Update reminder count
        for (const a of toNotify) {
          a.reminderCount = (a.reminderCount || 0) + 1;
        }
        await this.assignmentRepo.save(toNotify);

        this.logger.log(`[Cron] Sent ${toNotify.length} survey reminders for "${survey.title}"`);
      }
    } catch (error) {
      this.logger.error(`[Cron] Error in remindIncompleteSurveys: ${error}`);
    }
  }

  // ─── Export ────────────────────────────────────────────────────────────

  private escapeCsv(val: any): string {
    const str = String(val ?? '');
    return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
  }

  async exportSurveyCsv(tenantId: string, surveyId: string): Promise<string> {
    const results = await this.getResults(tenantId, surveyId);
    const enps = await this.getENPS(tenantId, surveyId);
    const depts = await this.getResultsByDepartment(tenantId, surveyId);

    const rows: string[] = [];
    rows.push(`Encuesta,${this.escapeCsv(results.survey.title)}`);
    rows.push(`Escala de puntuación,1 a 10 (normalizada desde likert 1-5 ×2)`);
    rows.push(`Tasa de respuesta,${results.responseRate}%`);
    rows.push(`Respuestas,${results.totalResponses} de ${results.totalAssigned}`);
    rows.push(`Promedio general,${results.overallAverage} / 10`);
    if (enps.enps !== null) rows.push(`eNPS,${enps.enps}`);
    rows.push('');

    // By category
    rows.push('Categoría,Promedio (1-10),Respuestas');
    for (const c of results.averageByCategory) {
      rows.push(`${this.escapeCsv(c.category)},${c.average},${c.count}`);
    }
    rows.push('');

    // By question
    rows.push('Pregunta,Categoría,Promedio (1-10),Respuestas');
    for (const q of results.averageByQuestion) {
      rows.push(`${this.escapeCsv(q.questionText)},${this.escapeCsv(q.category)},${q.average},${q.count}`);
    }
    rows.push('');

    // By department
    if (depts.length > 0) {
      rows.push('Departamento,Promedio (1-10),Respuestas');
      for (const d of depts) {
        rows.push(`${this.escapeCsv(d.department)},${d.average},${d.responseCount}`);
      }
      rows.push('');
    }

    // eNPS detail
    if (enps.enps !== null) {
      rows.push('eNPS Detalle');
      rows.push(`Promotores,${enps.promoters},${enps.promoterPercent}%`);
      rows.push(`Pasivos,${enps.passives},${enps.passivePercent}%`);
      rows.push(`Detractores,${enps.detractors},${enps.detractorPercent}%`);
      rows.push(`Score eNPS,${enps.enps}`);
    }

    return '\uFEFF' + rows.join('\n');
  }

  async exportSurveyXlsx(tenantId: string, surveyId: string): Promise<Buffer> {
    const results = await this.getResults(tenantId, surveyId);
    const enps = await this.getENPS(tenantId, surveyId);
    const depts = await this.getResultsByDepartment(tenantId, surveyId);

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const accent = { argb: 'FFC9933A' };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const headerFill: any = { type: 'pattern', pattern: 'solid', fgColor: accent };

    // Sheet 1: Resumen
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 25 }, { width: 20 }];
    ws1.addRow(['Encuesta de Clima']).font = { bold: true, size: 14 };
    ws1.addRow([]);
    ws1.addRow(['Encuesta', results.survey.title]);
    ws1.addRow(['Escala de puntuación', '1 a 10 (normalizada desde likert 1-5 ×2)']);
    ws1.addRow(['Tasa de respuesta', `${results.responseRate}%`]);
    ws1.addRow(['Respuestas', `${results.totalResponses} de ${results.totalAssigned}`]);
    ws1.addRow(['Promedio general', `${results.overallAverage} / 10`]);
    if (enps.enps !== null) {
      ws1.addRow([]);
      ws1.addRow(['eNPS', enps.enps]);
      ws1.addRow(['Promotores', `${enps.promoters} (${enps.promoterPercent}%)`]);
      ws1.addRow(['Pasivos', `${enps.passives} (${enps.passivePercent}%)`]);
      ws1.addRow(['Detractores', `${enps.detractors} (${enps.detractorPercent}%)`]);
    }

    // Sheet 2: Por Categoría
    const ws2 = wb.addWorksheet('Por Categoría');
    ws2.columns = [{ width: 25 }, { width: 18 }, { width: 15 }];
    const h2 = ws2.addRow(['Categoría', 'Promedio (1-10)', 'Respuestas']);
    h2.eachCell((cell) => { cell.font = headerFont; cell.fill = headerFill; });
    for (const c of results.averageByCategory) {
      ws2.addRow([c.category, c.average, c.count]);
    }

    // Sheet 3: Por Pregunta
    const ws3 = wb.addWorksheet('Por Pregunta');
    ws3.columns = [{ width: 50 }, { width: 20 }, { width: 18 }, { width: 12 }];
    const h3 = ws3.addRow(['Pregunta', 'Categoría', 'Promedio (1-10)', 'Respuestas']);
    h3.eachCell((cell) => { cell.font = headerFont; cell.fill = headerFill; });
    for (const q of results.averageByQuestion) {
      ws3.addRow([q.questionText, q.category, q.average, q.count]);
    }

    // Sheet 4: Por Departamento
    if (depts.length > 0) {
      const ws4 = wb.addWorksheet('Por Departamento');
      ws4.columns = [{ width: 25 }, { width: 18 }, { width: 15 }];
      const h4 = ws4.addRow(['Departamento', 'Promedio (1-10)', 'Respuestas']);
      h4.eachCell((cell) => { cell.font = headerFont; cell.fill = headerFill; });
      for (const d of depts) {
        ws4.addRow([d.department, d.average, d.responseCount]);
      }
    }

    // Sheet 5: Respuestas Abiertas
    if (results.openResponses.length > 0) {
      const ws5 = wb.addWorksheet('Respuestas Abiertas');
      ws5.columns = [{ width: 40 }, { width: 20 }, { width: 60 }];
      const h5 = ws5.addRow(['Pregunta', 'Categoría', 'Respuesta']);
      h5.eachCell((cell) => { cell.font = headerFont; cell.fill = headerFill; });
      for (const r of results.openResponses) {
        ws5.addRow([r.questionText, r.category, r.text]);
      }
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async exportSurveyPdf(tenantId: string, surveyId: string): Promise<Buffer> {
    const results = await this.getResults(tenantId, surveyId);
    const enps = await this.getENPS(tenantId, surveyId);
    const depts = await this.getResultsByDepartment(tenantId, surveyId);

    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;

    // Header
    doc.setFillColor(26, 18, 6);
    doc.rect(0, 0, pageW, 35, 'F');
    doc.setTextColor(245, 228, 168);
    doc.setFontSize(16);
    doc.text('Encuesta de Clima', margin, 18);
    doc.setFontSize(10);
    doc.setTextColor(201, 147, 58);
    doc.text(results.survey.title, margin, 28);

    let y = 45;

    // KPIs
    const kpis = [
      { label: 'Tasa Respuesta', value: `${results.responseRate}%` },
      { label: 'Promedio General', value: `${results.overallAverage}/10` },
      { label: 'Respuestas', value: `${results.totalResponses}/${results.totalAssigned}` },
    ];
    if (enps.enps !== null) kpis.push({ label: 'eNPS', value: `${enps.enps}` });

    const kpiW = (pageW - 2 * margin - (kpis.length - 1) * 4) / kpis.length;
    kpis.forEach((kpi, i) => {
      const x = margin + i * (kpiW + 4);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, kpiW, 22, 3, 3, 'F');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.label, x + kpiW / 2, y + 8, { align: 'center' });
      doc.setFontSize(14);
      doc.setTextColor(26, 18, 6);
      doc.text(kpi.value, x + kpiW / 2, y + 18, { align: 'center' });
    });
    y += 30;

    // Categories table
    if (results.averageByCategory.length > 0) {
      doc.setFontSize(11);
      doc.setTextColor(26, 18, 6);
      doc.text('Resultados por Categoría', margin, y);
      y += 5;
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Categoría', 'Promedio', 'Respuestas']],
        body: results.averageByCategory.map((c: any) => [c.category, c.average.toFixed(2), c.count]),
        headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
      y = (doc as any).lastAutoTable.finalY + 10;
    }

    // Department table
    if (depts.length > 0 && y < 240) {
      doc.setFontSize(11);
      doc.setTextColor(26, 18, 6);
      doc.text('Resultados por Departamento', margin, y);
      y += 5;
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Departamento', 'Promedio', 'Respuestas']],
        body: depts.map((d: any) => [d.department, d.average.toFixed(2), d.responseCount]),
        headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
      y = (doc as any).lastAutoTable.finalY + 10;
    }

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} — Eva360`, margin, doc.internal.pageSize.getHeight() - 8);
      doc.text(`Página ${i} de ${pageCount}`, pageW - margin, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
    }

    return Buffer.from(doc.output('arraybuffer'));
  }
}
