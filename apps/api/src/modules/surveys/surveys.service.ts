import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
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
  ) {}

  // ─── Feature gate ──────────────────────────────────────────────────────

  private async checkFeature(tenantId: string, feature: string = PlanFeature.ENGAGEMENT_SURVEYS): Promise<void> {
    const sub = await this.subscriptionsService.findByTenantId(tenantId);
    if (sub?.plan) {
      const features: string[] = sub.plan.features || [];
      if (!features.includes(feature)) {
        throw new ForbiddenException(
          `Su plan "${sub.plan.name}" no incluye esta funcionalidad. Actualice a un plan superior.`,
        );
      }
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

    const survey = this.surveyRepo.create({
      tenantId,
      title: dto.title,
      description: dto.description ?? null,
      isAnonymous: dto.isAnonymous ?? true,
      targetAudience: dto.targetAudience ?? 'all',
      targetDepartments: dto.targetDepartments ?? [],
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
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
    return this.surveyRepo.find({
      where: { tenantId },
      relations: ['creator'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, surveyId: string): Promise<EngagementSurvey> {
    const survey = await this.surveyRepo.findOne({
      where: { id: surveyId, tenantId },
      relations: ['questions', 'creator'],
      order: { questions: { sortOrder: 'ASC' } },
    });
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

    await this.surveyRepo.save(survey);

    // Replace questions if provided
    if (dto.questions) {
      await this.questionRepo.delete({ surveyId });
      const questions = dto.questions.map((q, i) =>
        this.questionRepo.create({
          surveyId,
          category: q.category,
          questionText: q.questionText,
          questionType: q.questionType,
          options: q.options ?? null,
          isRequired: q.isRequired ?? true,
          sortOrder: q.sortOrder ?? i,
        }),
      );
      await this.questionRepo.save(questions);
    }

    return this.findById(tenantId, surveyId);
  }

  async delete(tenantId: string, surveyId: string): Promise<void> {
    const survey = await this.surveyRepo.findOne({ where: { id: surveyId, tenantId } });
    if (!survey) throw new NotFoundException('Encuesta no encontrada');
    if (survey.status !== 'draft') throw new BadRequestException('Solo se pueden eliminar encuestas en borrador.');
    await this.surveyRepo.remove(survey);
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
      where.department = In(survey.targetDepartments);
    }
    // 'all' or 'custom' (custom uses all for now, can be extended)

    return this.userRepo.find({
      where,
      select: ['id', 'email', 'firstName', 'lastName', 'department'],
    });
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

    // Check if already responded
    const existing = await this.responseRepo.findOne({
      where: { surveyId, tenantId, respondentId: survey.isAnonymous ? undefined : userId },
    });

    if (!survey.isAnonymous && existing && existing.isComplete) {
      throw new BadRequestException('Ya has respondido esta encuesta.');
    }

    // Create or update response
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
    const assignment = await this.assignmentRepo.findOne({ where: { surveyId, userId, tenantId } });
    if (assignment) {
      assignment.status = 'completed';
      assignment.completedAt = new Date();
      await this.assignmentRepo.save(assignment);
    }

    // Update response count
    await this.surveyRepo.increment({ id: surveyId }, 'responseCount', 1);

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
    const categoryScores: Record<string, number[]> = {};
    const questionScores: Record<string, number[]> = {};
    const openResponses: Array<{ questionId: string; questionText: string; category: string; text: string }> = [];

    for (const r of responses) {
      for (const ans of r.answers) {
        const question = survey.questions.find((q) => q.id === ans.questionId);
        if (!question) continue;

        if (question.questionType === 'likert_5' || question.questionType === 'nps') {
          const numVal = typeof ans.value === 'number' ? ans.value : parseFloat(ans.value as string);
          if (!isNaN(numVal)) {
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

    // Average by category
    const averageByCategory = Object.entries(categoryScores).map(([category, scores]) => ({
      category,
      average: Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
      count: scores.length,
    })).sort((a, b) => b.average - a.average);

    // Average by question
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

    // Likert distribution per question
    const likertDistribution = survey.questions
      .filter((q) => q.questionType === 'likert_5')
      .map((q) => {
        const scores = questionScores[q.id] || [];
        const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        for (const s of scores) dist[Math.round(s) as 1 | 2 | 3 | 4 | 5] = (dist[Math.round(s) as 1 | 2 | 3 | 4 | 5] || 0) + 1;
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

    // Overall average (likert only)
    const allLikert = Object.values(categoryScores).flat().filter((v) => v >= 1 && v <= 5);
    const overallAverage = allLikert.length > 0
      ? Number((allLikert.reduce((a, b) => a + b, 0) / allLikert.length).toFixed(2))
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

    // Find NPS questions
    const npsQuestions = survey.questions.filter((q) => q.questionType === 'nps');
    if (npsQuestions.length === 0) {
      return { enps: null, message: 'No hay preguntas NPS en esta encuesta.' };
    }

    let promoters = 0;
    let passives = 0;
    let detractors = 0;

    for (const r of responses) {
      for (const ans of r.answers) {
        const question = npsQuestions.find((q) => q.id === ans.questionId);
        if (!question) continue;

        const score = typeof ans.value === 'number' ? ans.value : parseInt(ans.value as string);
        if (isNaN(score)) continue;

        if (score >= 9) promoters++;
        else if (score >= 7) passives++;
        else detractors++;
      }
    }

    const total = promoters + passives + detractors;
    const enps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;

    return {
      enps,
      promoters,
      passives,
      detractors,
      total,
      promoterPercent: total > 0 ? Number(((promoters / total) * 100).toFixed(1)) : 0,
      passivePercent: total > 0 ? Number(((passives / total) * 100).toFixed(1)) : 0,
      detractorPercent: total > 0 ? Number(((detractors / total) * 100).toFixed(1)) : 0,
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

        const numVal = typeof ans.value === 'number' ? ans.value : parseFloat(ans.value as string);
        if (!isNaN(numVal)) deptScores[dept].scores.push(numVal);
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
          const numVal = typeof ans.value === 'number' ? ans.value : parseFloat(ans.value as string);
          if (!isNaN(numVal)) {
            if (!categoryScores[q.category]) categoryScores[q.category] = [];
            categoryScores[q.category].push(numVal);
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

    survey.status = 'closed';
    await this.surveyRepo.save(survey);

    this.logger.log(`Survey "${survey.title}" closed`);
    return this.findById(tenantId, surveyId);
  }

  // ─── AI Analysis ───────────────────────────────────────────────────────

  async generateAiAnalysis(tenantId: string, surveyId: string, generatedBy: string): Promise<any> {
    // Check AI feature
    await this.checkFeature(tenantId, PlanFeature.AI_INSIGHTS);

    const results = await this.getResults(tenantId, surveyId);
    const enps = await this.getENPS(tenantId, surveyId);
    const deptResults = await this.getResultsByDepartment(tenantId, surveyId);

    if (results.totalResponses === 0) {
      throw new BadRequestException('No hay respuestas para analizar.');
    }

    return this.aiInsightsService.analyzeSurvey(tenantId, surveyId, generatedBy, {
      surveyTitle: results.survey.title,
      responseRate: results.responseRate,
      totalResponses: results.totalResponses,
      overallAverage: results.overallAverage,
      averageByCategory: results.averageByCategory,
      averageByQuestion: results.averageByQuestion,
      enps,
      departmentResults: deptResults,
      openResponses: results.openResponses.slice(0, 50), // Limit to avoid token overflow
    });
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
        description: suggestion.description || null,
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
}
