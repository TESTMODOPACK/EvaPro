import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { EvaluationCycle, CycleStatus } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment, AssignmentStatus } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { Objective, ObjectiveStatus } from '../objectives/entities/objective.entity';
import { EngagementSurvey } from '../surveys/entities/engagement-survey.entity';
import { SurveyResponse } from '../surveys/entities/survey-response.entity';
import { SurveyQuestion } from '../surveys/entities/survey-question.entity';
import { OrgDevelopmentPlan } from '../org-development/entities/org-development-plan.entity';
import { OrgDevelopmentInitiative } from '../org-development/entities/org-development-initiative.entity';

@Injectable()
export class ExecutiveDashboardService {
  private readonly logger = new Logger(ExecutiveDashboardService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
    @InjectRepository(EvaluationAssignment)
    private readonly assignmentRepo: Repository<EvaluationAssignment>,
    @InjectRepository(EvaluationResponse)
    private readonly responseRepo: Repository<EvaluationResponse>,
    @InjectRepository(Objective)
    private readonly objectiveRepo: Repository<Objective>,
    @InjectRepository(EngagementSurvey)
    private readonly surveyRepo: Repository<EngagementSurvey>,
    @InjectRepository(SurveyResponse)
    private readonly surveyResponseRepo: Repository<SurveyResponse>,
    @InjectRepository(SurveyQuestion)
    private readonly surveyQuestionRepo: Repository<SurveyQuestion>,
    @InjectRepository(OrgDevelopmentPlan)
    private readonly orgPlanRepo: Repository<OrgDevelopmentPlan>,
    @InjectRepository(OrgDevelopmentInitiative)
    private readonly orgInitiativeRepo: Repository<OrgDevelopmentInitiative>,
  ) {}

  async getExecutiveSummary(
    tenantId: string,
    cycleId?: string,
    managerId?: string,
  ): Promise<any> {
    // Each section fails gracefully with defaults
    const [headcount, enps, performance, objectives, orgDevelopment] = await Promise.all([
      this.getHeadcount(tenantId, managerId).catch((e) => { this.logger.error(`Headcount error: ${e.message}`); return { total: 0, active: 0, byDepartment: [] }; }),
      this.getLatestENPS(tenantId).catch((e) => { this.logger.error(`eNPS error: ${e.message}`); return null; }),
      this.getPerformanceSummary(tenantId, cycleId, managerId).catch((e) => { this.logger.error(`Performance error: ${e.message}`); return { avgScore: 0, completionRate: 0, totalAssignments: 0, completedAssignments: 0, cycleName: null, cycleId: null }; }),
      this.getObjectivesSummary(tenantId, managerId).catch((e) => { this.logger.error(`Objectives error: ${e.message}`); return { total: 0, completed: 0, inProgress: 0, draft: 0, pendingApproval: 0, abandoned: 0, completionPct: 0 }; }),
      this.getOrgDevelopmentSummary(tenantId).catch((e) => { this.logger.error(`OrgDev error: ${e.message}`); return { totalPlans: 0, activePlans: 0, totalInitiatives: 0, completedInitiatives: 0, inProgressInitiatives: 0, pendingInitiatives: 0 }; }),
    ]);

    return {
      headcount,
      enps,
      performance,
      objectives,
      orgDevelopment,
      lastUpdated: new Date().toISOString(),
    };
  }

  // ─── Headcount ────────────────────────────────────────────────────────

  private async getHeadcount(tenantId: string, managerId?: string): Promise<any> {
    const where: any = { tenantId, isActive: true };
    if (managerId) where.managerId = managerId;

    const users = await this.userRepo.find({ where, select: ['id', 'department'] });
    const total = users.length;

    const byDepartment: Record<string, number> = {};
    for (const u of users) {
      const dept = u.department || 'Sin departamento';
      byDepartment[dept] = (byDepartment[dept] || 0) + 1;
    }

    return {
      total,
      active: total,
      byDepartment: Object.entries(byDepartment)
        .map(([department, count]) => ({ department, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  // ─── eNPS ─────────────────────────────────────────────────────────────

  private async getLatestENPS(tenantId: string): Promise<any> {
    // Find latest closed survey
    const survey = await this.surveyRepo.findOne({
      where: { tenantId, status: 'closed' },
      order: { endDate: 'DESC' },
    });

    if (!survey) return null;

    // Get NPS questions
    const npsQuestions = await this.surveyQuestionRepo.find({
      where: { surveyId: survey.id, questionType: 'nps' },
    });

    if (npsQuestions.length === 0) return null;

    // Get responses
    const responses = await this.surveyResponseRepo.find({
      where: { surveyId: survey.id, tenantId, isComplete: true },
    });

    let promoters = 0;
    let passives = 0;
    let detractors = 0;

    const npsQuestionIds = new Set(npsQuestions.map((q) => q.id));

    for (const r of responses) {
      const npsScores: number[] = [];
      for (const ans of r.answers) {
        if (!npsQuestionIds.has(ans.questionId)) continue;
        const score = typeof ans.value === 'number' ? ans.value : parseInt(ans.value as string);
        if (!isNaN(score)) npsScores.push(score);
      }
      if (npsScores.length === 0) continue;
      const avg = npsScores.reduce((a, b) => a + b, 0) / npsScores.length;
      if (avg >= 9) promoters++;
      else if (avg >= 7) passives++;
      else detractors++;
    }

    const total = promoters + passives + detractors;
    const enpsScore = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;

    return {
      score: enpsScore,
      surveyName: survey.title,
      surveyId: survey.id,
      total,
      promoters,
      passives,
      detractors,
    };
  }

  // ─── Performance ──────────────────────────────────────────────────────

  private async getPerformanceSummary(
    tenantId: string,
    cycleId?: string,
    managerId?: string,
  ): Promise<any> {
    // Only load performance if a cycleId is explicitly provided
    if (!cycleId) {
      return { avgScore: 0, completionRate: 0, totalAssignments: 0, completedAssignments: 0, cycleName: null, cycleId: null };
    }

    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });
    if (!cycle) {
      return { avgScore: 0, completionRate: 0, totalAssignments: 0, completedAssignments: 0, cycleName: null, cycleId: null };
    }

    // Build assignment query, scoped to manager's direct reports if applicable
    const assignmentWhere: any = { cycleId: cycle.id };
    if (managerId) {
      const directReports = await this.userRepo.find({
        where: { tenantId, managerId, isActive: true },
        select: ['id'],
      });
      const reportIds = directReports.map((u) => u.id);
      if (reportIds.length === 0) {
        return { avgScore: 0, completionRate: 0, totalAssignments: 0, completedAssignments: 0, cycleName: cycle.name, cycleId: cycle.id };
      }
      assignmentWhere.evaluateeId = In(reportIds);
    }

    const totalAssignments = await this.assignmentRepo.count({ where: assignmentWhere });
    const completedAssignments = await this.assignmentRepo.count({
      where: { ...assignmentWhere, status: AssignmentStatus.COMPLETED },
    });

    // Average score from responses
    const qb = this.responseRepo
      .createQueryBuilder('r')
      .select('AVG(r.overallScore)', 'avg')
      .innerJoin('r.assignment', 'a')
      .where('a.cycleId = :cycleId', { cycleId: cycle.id })
      .andWhere('r.overallScore IS NOT NULL');

    if (managerId && assignmentWhere.evaluateeId) {
      const reportIds = assignmentWhere.evaluateeId.value;
      qb.andWhere('a.evaluateeId IN (:...reportIds)', { reportIds });
    }

    const scoreResult = await qb.getRawOne();

    const avgScore = scoreResult?.avg ? Number(Number(scoreResult.avg).toFixed(2)) : 0;
    const completionRate = totalAssignments > 0 ? Number(((completedAssignments / totalAssignments) * 100).toFixed(1)) : 0;

    return {
      avgScore,
      completionRate,
      totalAssignments,
      completedAssignments,
      cycleName: cycle.name,
      cycleId: cycle.id,
    };
  }

  // ─── Objectives ───────────────────────────────────────────────────────

  private async getObjectivesSummary(tenantId: string, managerId?: string): Promise<any> {
    const where: any = { tenantId };
    if (managerId) {
      // Get direct reports' objectives
      const directReports = await this.userRepo.find({
        where: { tenantId, managerId, isActive: true },
        select: ['id'],
      });
      // If manager, only count objectives of their team
      if (directReports.length > 0) {
        const reportIds = directReports.map((u) => u.id);
        const objectives = await this.objectiveRepo.find({
          where: { tenantId, userId: In(reportIds) },
          select: ['id', 'status'],
        });
        return this.computeObjectiveStats(objectives);
      }
      return { total: 0, completed: 0, inProgress: 0, draft: 0, pendingApproval: 0, abandoned: 0, completionPct: 0 };
    }

    const objectives = await this.objectiveRepo.find({ where, select: ['id', 'status'] });
    return this.computeObjectiveStats(objectives);
  }

  private computeObjectiveStats(objectives: Array<{ id: string; status: ObjectiveStatus }>): any {
    const total = objectives.length;
    const completed = objectives.filter((o) => o.status === ObjectiveStatus.COMPLETED).length;
    const active = objectives.filter((o) => o.status === ObjectiveStatus.ACTIVE).length;
    const draft = objectives.filter((o) => o.status === ObjectiveStatus.DRAFT).length;
    const pending = objectives.filter((o) => o.status === ObjectiveStatus.PENDING_APPROVAL).length;
    const abandoned = objectives.filter((o) => o.status === ObjectiveStatus.ABANDONED).length;

    return {
      total,
      completed,
      inProgress: active,
      draft,
      pendingApproval: pending,
      abandoned,
      completionPct: total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0,
    };
  }

  // ─── Org Development ──────────────────────────────────────────────────

  private async getOrgDevelopmentSummary(tenantId: string): Promise<any> {
    const [plans, initiatives] = await Promise.all([
      this.orgPlanRepo.find({ where: { tenantId }, select: ['id', 'status'] }),
      this.orgInitiativeRepo.find({ where: { tenantId }, select: ['id', 'status'] }),
    ]);

    const activePlans = plans.filter((p) => p.status === 'activo').length;
    const totalInitiatives = initiatives.length;
    const completedInitiatives = initiatives.filter((i) => i.status === 'completada').length;
    const inProgressInitiatives = initiatives.filter((i) => i.status === 'en_progreso').length;
    const pendingInitiatives = initiatives.filter((i) => i.status === 'pendiente').length;

    return {
      totalPlans: plans.length,
      activePlans,
      totalInitiatives,
      completedInitiatives,
      inProgressInitiatives,
      pendingInitiatives,
    };
  }
}
