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

    // Prefer native NPS; fall back to derived eNPS from likert_5 ×2.
    const npsQuestions = await this.surveyQuestionRepo.find({
      where: { surveyId: survey.id, questionType: 'nps' },
    });
    const likertQuestions = await this.surveyQuestionRepo.find({
      where: { surveyId: survey.id, questionType: 'likert_5' },
    });

    const useNps = npsQuestions.length > 0;
    const sourceQuestions = useNps ? npsQuestions : likertQuestions;
    if (sourceQuestions.length === 0) return null;

    const sourceIds = new Set(sourceQuestions.map((q) => q.id));

    // Get responses
    const responses = await this.surveyResponseRepo.find({
      where: { surveyId: survey.id, tenantId, isComplete: true },
    });

    let promoters = 0;
    let passives = 0;
    let detractors = 0;

    for (const r of responses) {
      const scores: number[] = [];
      for (const ans of r.answers) {
        if (!sourceIds.has(ans.questionId)) continue;
        const raw = typeof ans.value === 'number' ? ans.value : parseFloat(ans.value as string);
        if (isNaN(raw)) continue;
        scores.push(useNps ? raw : raw * 2);
      }
      if (scores.length === 0) continue;
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avg >= 9) promoters++;
      else if (avg >= 7) passives++;
      else detractors++;
    }

    const total = promoters + passives + detractors;
    if (total === 0) return null;
    const enpsScore = Math.round(((promoters - detractors) / total) * 100);

    return {
      score: enpsScore,
      surveyName: survey.title,
      surveyId: survey.id,
      total,
      promoters,
      passives,
      detractors,
      source: useNps ? 'nps_question' : 'likert_derived',
    };
  }

  // ─── Public eNPS methods for API ──────────────────────────────────────

  async getClosedSurveys(tenantId: string): Promise<any[]> {
    const surveys = await this.surveyRepo.find({
      where: { tenantId, status: 'closed' },
      order: { endDate: 'DESC' },
      select: ['id', 'title', 'startDate', 'endDate', 'status'],
    });
    return surveys;
  }

  async getENPSBySurveyId(tenantId: string, surveyId: string): Promise<any> {
    const survey = await this.surveyRepo.findOne({
      where: { id: surveyId, tenantId, status: 'closed' },
    });
    if (!survey) return null;

    const npsQuestions = await this.surveyQuestionRepo.find({
      where: { surveyId: survey.id, questionType: 'nps' },
    });
    const likertQuestions = await this.surveyQuestionRepo.find({
      where: { surveyId: survey.id, questionType: 'likert_5' },
    });
    const useNps = npsQuestions.length > 0;
    const sourceQuestions = useNps ? npsQuestions : likertQuestions;
    if (sourceQuestions.length === 0) return null;

    const responses = await this.surveyResponseRepo.find({
      where: { surveyId: survey.id, tenantId, isComplete: true },
    });

    let promoters = 0, passives = 0, detractors = 0;
    const sourceIds = new Set(sourceQuestions.map((q) => q.id));

    for (const r of responses) {
      const scores: number[] = [];
      for (const ans of r.answers) {
        if (!sourceIds.has(ans.questionId)) continue;
        const raw = typeof ans.value === 'number' ? ans.value : parseFloat(ans.value as string);
        if (isNaN(raw)) continue;
        scores.push(useNps ? raw : raw * 2);
      }
      if (scores.length === 0) continue;
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avg >= 9) promoters++;
      else if (avg >= 7) passives++;
      else detractors++;
    }

    const total = promoters + passives + detractors;
    if (total === 0) return null;
    const enpsScore = Math.round(((promoters - detractors) / total) * 100);

    return {
      score: enpsScore,
      surveyName: survey.title,
      surveyId: survey.id,
      total,
      promoters,
      passives,
      detractors,
      source: useNps ? 'nps_question' : 'likert_derived',
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

    // Build assignment query, scoped to tenant + optional manager reports
    const assignmentWhere: any = { tenantId, cycleId: cycle.id };
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

    // Average score from responses — tenant guard on the JOIN + where clause.
    const qb = this.responseRepo
      .createQueryBuilder('r')
      .select('AVG(r.overallScore)', 'avg')
      .innerJoin('r.assignment', 'a', 'a.tenant_id = r.tenant_id')
      .where('r.tenantId = :tenantId', { tenantId })
      .andWhere('a.cycleId = :cycleId', { cycleId: cycle.id })
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
    const inProgressInitiatives = initiatives.filter((i) => i.status === 'en_curso').length;
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

  // ─── Export Dashboard PDF (multi-tab) ─────────────────────────────────

  async exportDashboardPdf(tenantId: string, cycleId: string, surveyId?: string, managerId?: string): Promise<Buffer> {
    // Gather data — team-filtered for managers + org-wide for comparison
    const [execData, orgData, turnover] = await Promise.all([
      this.getExecutiveSummary(tenantId, cycleId, managerId),
      managerId ? this.getExecutiveSummary(tenantId, cycleId).catch(() => null) : Promise.resolve(null),
      this.getTurnoverForExport(tenantId).catch(() => null),
    ]);

    // Department breakdown — calculated directly (no dep on ReportsService)
    let cycleSummary: any = null;
    try {
      const deptData = await this.responseRepo
        .createQueryBuilder('r')
        .innerJoin('r.assignment', 'a', 'a.tenant_id = r.tenant_id')
        .innerJoin(User, 'u', 'u.id = a.evaluatee_id AND u.tenant_id = a.tenant_id')
        .where('a.cycleId = :cycleId', { cycleId })
        .andWhere('r.tenantId = :tenantId', { tenantId })
        .andWhere('r.overall_score IS NOT NULL')
        .andWhere('u.department IS NOT NULL')
        .select('u.department', 'department')
        .addSelect('AVG(r.overall_score)', 'avgScore')
        .addSelect('COUNT(DISTINCT u.id)', 'count')
        .groupBy('u.department')
        .orderBy('AVG(r.overall_score)', 'DESC')
        .getRawMany();
      if (deptData.length > 0) {
        cycleSummary = { departmentBreakdown: deptData };
      }
    } catch { /* ignore — PDF will skip department table */ }
    const movements: any = null;
    const pdiCompliance: any = null;
    let enpsData: any = null;
    if (surveyId) {
      enpsData = await this.getENPSBySurveyId(tenantId, surveyId).catch(() => null);
    } else {
      enpsData = await this.getLatestENPS(tenantId).catch(() => null);
    }

    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF('l', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14;

    const addHeader = (title: string, subtitle: string) => {
      doc.setFillColor(26, 18, 6);
      doc.rect(0, 0, pageW, 28, 'F');
      doc.setTextColor(245, 228, 168);
      doc.setFontSize(15);
      doc.text(title, margin, 14);
      doc.setFontSize(9);
      doc.setTextColor(201, 147, 58);
      doc.text(subtitle, margin, 22);
      doc.text(`Exportado el ${new Date().toLocaleDateString('es-CL')}`, pageW - margin, 22, { align: 'right' });
    };

    const addKpiRow = (y: number, kpis: { label: string; value: string }[]) => {
      const kpiW = (pageW - 2 * margin - (kpis.length - 1) * 4) / kpis.length;
      kpis.forEach((kpi, i) => {
        const x = margin + i * (kpiW + 4);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(x, y, kpiW, 18, 2, 2, 'F');
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(kpi.label, x + kpiW / 2, y + 7, { align: 'center' });
        doc.setFontSize(12);
        doc.setTextColor(26, 18, 6);
        doc.text(kpi.value, x + kpiW / 2, y + 15, { align: 'center' });
      });
      return y + 24;
    };

    const addSectionTitle = (y: number, text: string) => {
      doc.setFontSize(10);
      doc.setTextColor(201, 147, 58);
      doc.text(text, margin, y);
      return y + 6;
    };

    const perf = execData.performance || {};
    const hc = execData.headcount || {};
    const obj = execData.objectives || {};
    const orgDev = execData.orgDevelopment || {};

    const isManagerView = !!managerId;

    // ═══ PAGE 1: PORTADA + RESUMEN GENERAL ═══
    addHeader(
      'Dashboard Ejecutivo',
      isManagerView ? 'Resumen de mi equipo y la organización' : 'Resumen integral de la organización',
    );
    let y = 36;

    // Organización KPIs (calculados desde depts si existen)
    const orgAvg = cycleSummary?.departmentBreakdown?.length > 0
      ? cycleSummary.departmentBreakdown.reduce((s: number, d: any) => s + Number(d.avgScore) * Number(d.count || 1), 0) / cycleSummary.departmentBreakdown.reduce((s: number, d: any) => s + Number(d.count || 1), 0)
      : Number(perf.avgScore || 0);
    const orgDeptCount = cycleSummary?.departmentBreakdown?.length || 0;

    // Org-wide data for manager PDF (unfiltered headcount, performance)
    const orgHc = orgData?.headcount || hc;
    const orgPerf = orgData?.performance || perf;

    if (isManagerView) {
      // Sección Organización
      y = addSectionTitle(y, '🏢 Organización');
      y = addKpiRow(y, [
        { label: 'Promedio Global', value: `${orgAvg.toFixed(1)}/10` },
        { label: 'eNPS', value: `${enpsData?.score ?? '--'}` },
        { label: 'Dotación', value: `${orgHc.active || 0} activos` },
        { label: 'Departamentos', value: `${orgDeptCount}` },
      ]);
      y += 2;

      // Sección Mi Equipo
      y = addSectionTitle(y, '👥 Mi Equipo');
      y = addKpiRow(y, [
        { label: 'Promedio Equipo', value: `${Number(perf.avgScore || 0).toFixed(1)}/10` },
        { label: 'Completitud', value: `${perf.completionRate || 0}%` },
        { label: 'Evaluaciones', value: `${perf.completedAssignments || 0}/${perf.totalAssignments || 0}` },
        { label: 'vs Organización', value: `${Number(perf.avgScore || 0) >= orgAvg ? '+' : ''}${(Number(perf.avgScore || 0) - orgAvg).toFixed(1)}` },
      ]);
    } else {
      y = addKpiRow(y, [
        { label: 'Promedio Global', value: `${Number(perf.avgScore || 0).toFixed(1)}/10` },
        { label: 'Completitud', value: `${perf.completionRate || 0}%` },
        { label: 'eNPS', value: `${enpsData?.score ?? '--'}` },
        { label: 'Dotación', value: `${hc.active || 0} activos` },
        { label: 'OKRs', value: `${obj.completionPct || 0}%` },
      ]);
    }
    y += 4;

    // Cycle info
    if (perf.cycleName) {
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`Ciclo: ${perf.cycleName}`, margin, y);
      y += 6;
    }

    // Summary analysis text
    y = addSectionTitle(y, 'Análisis General');
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    const avgScore = Number(perf.avgScore || 0);
    const scoreLabel = avgScore >= 9 ? 'Excepcional' : avgScore >= 7 ? 'Destacado' : avgScore >= 5 ? 'Competente' : avgScore >= 3 ? 'En desarrollo' : 'Insuficiente';
    doc.text(`Desempeño: Promedio global ${avgScore.toFixed(1)} (${scoreLabel}). ${perf.completionRate >= 80 ? 'Excelente participación.' : 'Participación mejorable.'}`, margin, y, { maxWidth: pageW - 2 * margin });
    y += 5;
    if (enpsData) {
      doc.text(`Clima: eNPS de ${enpsData.score} (${enpsData.score >= 50 ? 'Excelente' : enpsData.score >= 30 ? 'Muy bueno' : enpsData.score >= 0 ? 'Aceptable' : 'Bajo'}). ${enpsData.promoters} promotores, ${enpsData.detractors} detractores.`, margin, y, { maxWidth: pageW - 2 * margin });
      y += 5;
    }
    if (turnover) {
      doc.text(`Dotación: Tasa de rotación ${turnover.turnoverRate || 0}% (${turnover.turnoverRate > 15 ? 'Alta' : turnover.turnoverRate > 8 ? 'Moderada' : 'Saludable'}). ${turnover.totalDeactivations12m || 0} bajas en 12 meses.`, margin, y, { maxWidth: pageW - 2 * margin });
      y += 5;
    }
    doc.text(`Objetivos: ${obj.completionPct || 0}% cumplimiento. ${obj.completed || 0} completados de ${obj.total || 0}.`, margin, y, { maxWidth: pageW - 2 * margin });
    y += 10;

    // Department ranking table
    if (cycleSummary?.departmentBreakdown?.length) {
      y = addSectionTitle(y, 'Ranking Departamental');
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Departamento', 'Promedio', 'Evaluados', 'Nivel']],
        body: cycleSummary.departmentBreakdown
          .sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore))
          .map((d: any) => [d.department, Number(d.avgScore).toFixed(1), d.count || 0, Number(d.avgScore) >= 7 ? 'Alto' : Number(d.avgScore) >= 5 ? 'Medio' : 'Bajo']),
        headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
    }

    // ═══ PAGE 2: CLIMA LABORAL ═══
    if (enpsData) {
      doc.addPage();
      addHeader('Clima Laboral', `Encuesta: ${enpsData.surveyName || 'Última encuesta'}`);
      let y2 = 36;
      y2 = addKpiRow(y2, [
        { label: 'eNPS Score', value: `${enpsData.score ?? '--'}` },
        { label: 'Promotores', value: `${enpsData.promoters || 0}` },
        { label: 'Detractores', value: `${enpsData.detractors || 0}` },
        { label: 'Total Respuestas', value: `${enpsData.total || 0}` },
      ]);
      y2 += 4;
      y2 = addSectionTitle(y2, 'Interpretación');
      doc.setFontSize(8);
      doc.setTextColor(60, 60, 60);
      doc.text(
        enpsData.score >= 50 ? 'Excelente — alto nivel de compromiso y satisfacción organizacional.' :
        enpsData.score >= 30 ? 'Muy bueno — la mayoría son promotores de la organización.' :
        enpsData.score >= 0 ? 'Aceptable — hay espacio para mejorar. Investigar causas de insatisfacción.' :
        'Bajo — requiere intervención urgente. Revisar condiciones laborales y clima.',
        margin, y2, { maxWidth: pageW - 2 * margin },
      );
    }

    // ═══ PAGE 3: DOTACIÓN Y ROTACIÓN ═══
    if (turnover || movements) {
      doc.addPage();
      addHeader('Dotación y Rotación', 'Últimos 12 meses');
      let y3 = 36;
      y3 = addKpiRow(y3, [
        { label: 'Activos', value: `${hc.active || 0}` },
        { label: 'Total', value: `${hc.total || 0}` },
        { label: 'Tasa Rotación', value: `${turnover?.turnoverRate || 0}%` },
        { label: 'Bajas 12m', value: `${turnover?.totalDeactivations12m || 0}` },
        { label: 'Voluntarias', value: `${turnover?.voluntary || 0}` },
        { label: 'Involuntarias', value: `${turnover?.involuntary || 0}` },
      ]);
      y3 += 4;

      if (turnover?.byDepartment?.length) {
        y3 = addSectionTitle(y3, 'Bajas por Departamento');
        autoTable(doc, {
          startY: y3,
          margin: { left: margin, right: pageW / 2 + 10 },
          head: [['Departamento', 'Bajas']],
          body: turnover.byDepartment.map((d: any) => [d.department, d.count]),
          headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
          bodyStyles: { fontSize: 7 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
        });
      }

      if (movements) {
        const movY = y3;
        doc.setFontSize(10);
        doc.setTextColor(201, 147, 58);
        doc.text('Movimientos Internos', pageW / 2 + 20, movY);
        doc.setFontSize(8);
        doc.setTextColor(60, 60, 60);
        doc.text(`Total: ${movements.totalMovements || 0} | Promociones: ${movements.promotions || 0} | Transferencias: ${movements.lateralTransfers || 0}`, pageW / 2 + 20, movY + 6);
      }
    }

    // ═══ PAGE 4: OBJETIVOS ═══
    doc.addPage();
    addHeader('Objetivos y OKRs', 'Estado de cumplimiento');
    let y4 = 36;
    y4 = addKpiRow(y4, [
      { label: 'Cumplimiento', value: `${obj.completionPct || 0}%` },
      { label: 'Completados', value: `${obj.completed || 0}` },
      { label: 'En Progreso', value: `${obj.inProgress || 0}` },
      { label: 'Total', value: `${obj.total || 0}` },
    ]);
    y4 += 4;
    y4 = addSectionTitle(y4, 'Análisis');
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    doc.text(`${obj.completionPct >= 70 ? 'Buen avance en las metas organizacionales.' : obj.completionPct >= 40 ? 'Avance moderado — revisar priorización.' : 'Bajo cumplimiento — requiere atención urgente.'}`, margin, y4, { maxWidth: pageW - 2 * margin });
    y4 += 5;
    doc.text(`${obj.inProgress || 0} en progreso, ${obj.draft || 0} en borrador, ${obj.abandoned || 0} abandonados.`, margin, y4, { maxWidth: pageW - 2 * margin });

    // ═══ PAGE 5: DESARROLLO PDI ═══
    if (pdiCompliance) {
      doc.addPage();
      addHeader('Desarrollo (PDI)', 'Cumplimiento de planes de desarrollo');
      let y5 = 36;
      y5 = addKpiRow(y5, [
        { label: 'Total Planes', value: `${pdiCompliance.totalPlans || 0}` },
        { label: 'Completitud', value: `${pdiCompliance.completionRate || 0}%` },
        { label: 'Acciones OK', value: `${pdiCompliance.completedActions || 0}/${pdiCompliance.totalActions || 0}` },
        { label: 'Vencidas', value: `${pdiCompliance.overdueActions || 0}` },
      ]);
      y5 += 4;

      if (pdiCompliance.byDepartment?.length) {
        y5 = addSectionTitle(y5, 'PDI por Departamento');
        autoTable(doc, {
          startY: y5,
          margin: { left: margin, right: margin },
          head: [['Departamento', 'Planes', 'Completados', 'Progreso']],
          body: pdiCompliance.byDepartment.map((d: any) => [d.department, d.total, d.completed, `${d.avgProgress || 0}%`]),
          headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
          bodyStyles: { fontSize: 7 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
        });
      }
    }

    // ═══ FOOTER on all pages ═══
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text('Eva360 — Dashboard Ejecutivo', margin, pageH - 8);
      doc.text(`Página ${i} de ${pageCount}`, pageW - margin, pageH - 8, { align: 'right' });
    }

    return Buffer.from(doc.output('arraybuffer'));
  }

  // Helper: basic turnover data from user table
  private async getTurnoverForExport(tenantId: string): Promise<any> {
    const users = await this.userRepo.find({ where: { tenantId }, select: ['id', 'isActive'] });
    const active = users.filter(u => u.isActive).length;
    const total = users.length;
    const inactive = total - active;
    return { activeUsers: active, inactiveUsers: inactive, turnoverRate: total > 0 ? Math.round((inactive / total) * 100) : 0, totalDeactivations12m: inactive, voluntary: 0, involuntary: 0 };
  }
}
