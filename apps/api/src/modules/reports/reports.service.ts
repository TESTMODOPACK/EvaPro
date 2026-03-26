import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment, AssignmentStatus, RelationType } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { Objective, ObjectiveStatus } from '../objectives/entities/objective.entity';
import { FormTemplate } from '../templates/entities/form-template.entity';
import { User } from '../users/entities/user.entity';
import { RoleCompetency } from '../development/entities/role-competency.entity';
import { Competency } from '../development/entities/competency.entity';

export interface ReportFilters {
  department?: string;
  position?: string;
}

/**
 * Privacy threshold: reports with fewer than this many people
 * will not return individual-level data to prevent identification.
 */
const PRIVACY_MIN_PEOPLE = 5;

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
    @InjectRepository(EvaluationAssignment)
    private readonly assignmentRepo: Repository<EvaluationAssignment>,
    @InjectRepository(EvaluationResponse)
    private readonly responseRepo: Repository<EvaluationResponse>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Objective)
    private readonly objectiveRepo: Repository<Objective>,
    @InjectRepository(FormTemplate)
    private readonly templateRepo: Repository<FormTemplate>,
    @InjectRepository(RoleCompetency)
    private readonly roleCompetencyRepo: Repository<RoleCompetency>,
    @InjectRepository(Competency)
    private readonly competencyRepo: Repository<Competency>,
  ) {}

  // ─── Shared filter interface ──────────────────────────────────────────
  // Applied to any query that joins the `users` table to filter results.

  private applyUserFilters(
    qb: any,
    filters?: ReportFilters,
    userAlias = 'u',
  ): void {
    if (!filters) return;
    if (filters.department) {
      qb.andWhere(`${userAlias}.department = :department`, { department: filters.department });
    }
    if (filters.position) {
      qb.andWhere(`${userAlias}.position = :position`, { position: filters.position });
    }
  }

  async cycleSummary(cycleId: string, tenantId: string, filters?: ReportFilters) {
    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });
    if (!cycle) throw new NotFoundException('Ciclo no encontrado');

    // Build filtered queries
    const totalQb = this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin(User, 'u', 'u.id = a.evaluatee_id')
      .where('a.cycleId = :cycleId', { cycleId })
      .andWhere('a.tenantId = :tenantId', { tenantId });
    this.applyUserFilters(totalQb, filters);
    const totalAssignments = await totalQb.getCount();

    const completedQb = this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin(User, 'u', 'u.id = a.evaluatee_id')
      .where('a.cycleId = :cycleId', { cycleId })
      .andWhere('a.tenantId = :tenantId', { tenantId })
      .andWhere('a.status = :status', { status: AssignmentStatus.COMPLETED });
    this.applyUserFilters(completedQb, filters);
    const completedAssignments = await completedQb.getCount();

    const avgQb = this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
      .innerJoin(User, 'u', 'u.id = a.evaluatee_id')
      .where('a.cycleId = :cycleId', { cycleId })
      .andWhere('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL')
      .select('AVG(r.overall_score)', 'avg');
    this.applyUserFilters(avgQb, filters);
    const avgResult = await avgQb.getRawOne();

    // Department breakdown
    const deptQb = this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
      .innerJoin(User, 'u', 'u.id = a.evaluatee_id')
      .where('a.cycleId = :cycleId', { cycleId })
      .andWhere('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL')
      .andWhere('u.department IS NOT NULL')
      .select('u.department', 'department')
      .addSelect('AVG(r.overall_score)', 'avgScore')
      .addSelect('COUNT(DISTINCT u.id)', 'count')
      .groupBy('u.department')
      .orderBy('AVG(r.overall_score)', 'DESC');
    this.applyUserFilters(deptQb, filters);
    const deptBreakdown = await deptQb.getRawMany();

    // Available filters for UI
    const departments = await this.userRepo
      .createQueryBuilder('u')
      .select('DISTINCT u.department', 'department')
      .where('u.tenantId = :tenantId', { tenantId })
      .andWhere('u.department IS NOT NULL')
      .andWhere('u.isActive = true')
      .orderBy('u.department', 'ASC')
      .getRawMany();

    const positions = await this.userRepo
      .createQueryBuilder('u')
      .select('DISTINCT u.position', 'position')
      .where('u.tenantId = :tenantId', { tenantId })
      .andWhere('u.position IS NOT NULL')
      .andWhere('u.isActive = true')
      .orderBy('u.position', 'ASC')
      .getRawMany();

    return {
      cycle,
      totalAssignments,
      completedAssignments,
      completionRate: totalAssignments > 0
        ? Math.round((completedAssignments / totalAssignments) * 100)
        : 0,
      averageScore: avgResult?.avg ? parseFloat(avgResult.avg).toFixed(1) : null,
      departmentBreakdown: deptBreakdown.map((d) => ({
        department: d.department,
        avgScore: parseFloat(d.avgScore).toFixed(1),
        count: parseInt(d.count),
      })),
      appliedFilters: filters || {},
      availableFilters: {
        departments: departments.map((d) => d.department).filter(Boolean),
        positions: positions.map((p) => p.position).filter(Boolean),
      },
    };
  }

  async individualResults(
    cycleId: string,
    userId: string,
    tenantId: string,
    requestingUserId?: string,
    requestingUserRole?: string,
  ) {
    const assignments = await this.assignmentRepo.find({
      where: { cycleId, evaluateeId: userId, tenantId },
      relations: ['evaluator', 'cycle'],
    });

    // B2.13: Read anonymity settings from cycle
    const cycle = assignments[0]?.cycle;
    const anonymitySettings: Record<string, boolean> = cycle?.settings?.anonymity || {
      peer: true,
      direct_report: true,
      external: true,
      manager: false,
      self: false,
    };

    // Batch load all responses for these assignments
    const assignmentIds = assignments.map((a) => a.id);
    const allResponses = assignmentIds.length > 0
      ? await this.responseRepo.find({ where: { assignmentId: In(assignmentIds) } })
      : [];
    const responseByAssignment = new Map(allResponses.map((r) => [r.assignmentId, r]));

    // Determine if requesting user is NOT the evaluatee themselves
    const isExternalViewer = requestingUserId && requestingUserId !== userId;

    const results = [];
    for (const assignment of assignments) {
      const response = responseByAssignment.get(assignment.id) ?? null;

      // P1-#4: Manager/admin cannot see self-evaluation until it's submitted
      // If the requesting user is not the evaluatee, and this is a self-evaluation
      // that hasn't been submitted yet, hide it completely
      if (
        isExternalViewer &&
        assignment.relationType === 'self' &&
        assignment.status !== AssignmentStatus.COMPLETED
      ) {
        results.push({
          relationType: assignment.relationType,
          evaluatorName: null,
          isAnonymous: false,
          status: 'pending_submission',
          score: null,
          answers: null,
          submittedAt: null,
          hiddenReason: 'La autoevaluación aún no ha sido enviada',
        });
        continue;
      }

      // Apply anonymity: hide evaluator name if anonymity is enabled for this relation type
      const isAnonymous = anonymitySettings[assignment.relationType] ?? false;
      const evaluatorName = isAnonymous
        ? null
        : assignment.evaluator
          ? `${assignment.evaluator.firstName} ${assignment.evaluator.lastName}`
          : null;

      results.push({
        relationType: assignment.relationType,
        evaluatorName,
        isAnonymous,
        status: assignment.status,
        score: response?.overallScore ?? null,
        answers: response?.answers ?? null,
        submittedAt: response?.submittedAt ?? null,
      });
    }

    return { userId, cycleId, evaluations: results };
  }

  async teamResults(cycleId: string, managerId: string, tenantId: string) {
    const teamMembers = await this.userRepo.find({
      where: { managerId, tenantId, isActive: true },
    });

    if (teamMembers.length === 0) {
      return { managerId, cycleId, team: [] };
    }

    const memberIds = teamMembers.map((m) => m.id);

    // Single query: all completed assignments for all team members in this cycle
    const allAssignments = await this.assignmentRepo.find({
      where: { cycleId, tenantId, status: AssignmentStatus.COMPLETED, evaluateeId: In(memberIds) },
    });

    // Single query: all responses for those assignments
    const assignmentIds = allAssignments.map((a) => a.id);
    const allResponses = assignmentIds.length > 0
      ? await this.responseRepo.find({ where: { assignmentId: In(assignmentIds) } })
      : [];

    // Index responses by assignmentId
    const responseByAssignment = new Map(allResponses.map((r) => [r.assignmentId, r]));

    const results = teamMembers.map((member) => {
      const memberAssignments = allAssignments.filter((a) => a.evaluateeId === member.id);
      let totalScore = 0;
      let scoreCount = 0;
      for (const a of memberAssignments) {
        const resp = responseByAssignment.get(a.id);
        if (resp?.overallScore != null) {
          totalScore += Number(resp.overallScore);
          scoreCount++;
        }
      }

      return {
        userId: member.id,
        name: `${member.firstName} ${member.lastName}`,
        department: member.department,
        position: member.position,
        completedEvaluations: memberAssignments.length,
        averageScore: scoreCount > 0 ? (totalScore / scoreCount).toFixed(1) : null,
      };
    });

    return { managerId, cycleId, team: results };
  }

  async exportCsv(cycleId: string, tenantId: string): Promise<string> {
    const assignments = await this.assignmentRepo.find({
      where: { cycleId, tenantId, status: AssignmentStatus.COMPLETED },
      relations: ['evaluatee', 'evaluator'],
    });

    // Batch load all responses for these assignments
    const assignmentIds = assignments.map((a) => a.id);
    const allResponses = assignmentIds.length > 0
      ? await this.responseRepo.find({ where: { assignmentId: In(assignmentIds) } })
      : [];
    const responseByAssignment = new Map(allResponses.map((r) => [r.assignmentId, r]));

    // Helper: escape CSV field (wrap in quotes, escape internal quotes)
    const escapeCsvField = (val: string | number | null | undefined): string => {
      const str = val != null ? String(val) : '';
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = ['Evaluado,Evaluador,Relación,Puntaje,Fecha'];
    for (const a of assignments) {
      const resp = responseByAssignment.get(a.id);
      rows.push([
        escapeCsvField(a.evaluatee ? `${a.evaluatee.firstName} ${a.evaluatee.lastName}` : 'N/A'),
        escapeCsvField(a.evaluator ? `${a.evaluator.firstName} ${a.evaluator.lastName}` : 'N/A'),
        escapeCsvField(a.relationType),
        escapeCsvField(resp?.overallScore ?? ''),
        escapeCsvField(resp?.submittedAt?.toISOString().split('T')[0] ?? ''),
      ].join(','));
    }
    // BOM UTF-8 prefix for Excel to correctly display accented characters
    return '\uFEFF' + rows.join('\n');
  }

  async exportPdf(cycleId: string, tenantId: string): Promise<Buffer> {
    const summary = await this.cycleSummary(cycleId, tenantId);
    const assignments = await this.assignmentRepo.find({
      where: { cycleId, tenantId, status: AssignmentStatus.COMPLETED },
      relations: ['evaluatee', 'evaluator'],
    });

    const relationLabels: Record<string, string> = {
      self: 'Autoevaluaci\u00f3n',
      manager: 'Encargado',
      peer: 'Par',
      direct_report: 'Reporte directo',
      external: 'Externo',
    };

    // Build evaluation detail rows
    const evalRows: string[][] = [];
    for (const a of assignments) {
      const resp = await this.responseRepo.findOne({ where: { assignmentId: a.id } });
      evalRows.push([
        a.evaluatee ? `${a.evaluatee.firstName} ${a.evaluatee.lastName}` : 'N/A',
        a.evaluator ? `${a.evaluator.firstName} ${a.evaluator.lastName}` : 'N/A',
        relationLabels[a.relationType] || a.relationType,
        resp?.overallScore != null ? Number(resp.overallScore).toFixed(1) : '\u2013',
        resp?.submittedAt ? new Date(resp.submittedAt).toLocaleDateString('es-CL') : '\u2013',
      ]);
    }

    // Create PDF
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    const accent = [99, 102, 241]; // #6366f1
    const pageWidth = doc.internal.pageSize.getWidth();

    // ─── Header ───
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.rect(0, 0, pageWidth, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Reporte de Evaluaci\u00f3n', 14, 13);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(summary.cycle.name, 14, 20);
    const dateRange = `${new Date(summary.cycle.startDate).toLocaleDateString('es-CL')} al ${new Date(summary.cycle.endDate).toLocaleDateString('es-CL')}`;
    doc.text(dateRange, 14, 25);

    // ─── KPIs ───
    let y = 36;
    doc.setTextColor(30, 30, 60);
    const kpiData = [
      { label: 'Promedio Global', value: summary.averageScore || '\u2013' },
      { label: 'Completadas', value: `${summary.completedAssignments}/${summary.totalAssignments}` },
      { label: 'Tasa Completado', value: `${summary.completionRate}%` },
    ];
    const kpiWidth = (pageWidth - 28 - 20) / 3;
    kpiData.forEach((kpi, i) => {
      const x = 14 + i * (kpiWidth + 10);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(x, y, kpiWidth, 18, 2, 2, 'FD');
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(accent[0], accent[1], accent[2]);
      doc.text(String(kpi.value), x + kpiWidth / 2, y + 9, { align: 'center' });
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.label, x + kpiWidth / 2, y + 15, { align: 'center' });
    });
    y += 26;

    // ─── Department Comparison ───
    const deptData = (summary.departmentBreakdown || []);
    if (deptData.length > 0) {
      doc.setTextColor(51, 65, 85);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Promedio por Departamento', 14, y);
      y += 2;
      autoTable(doc, {
        startY: y,
        head: [['Departamento', 'Promedio', 'Personas']],
        body: deptData.map((d: any) => [d.department || 'Sin depto.', d.avgScore, d.count]),
        margin: { left: 14, right: 14 },
        headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 30, 60] },
        alternateRowStyles: { fillColor: [250, 250, 250] },
        styles: { cellPadding: 2.5, lineColor: [226, 232, 240], lineWidth: 0.25 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }

    // ─── Evaluation Detail ───
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Detalle de Evaluaciones', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Evaluado', 'Evaluador', 'Relaci\u00f3n', 'Puntaje', 'Fecha']],
      body: evalRows,
      margin: { left: 14, right: 14 },
      headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: [30, 30, 60] },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      styles: { cellPadding: 2.5, lineColor: [226, 232, 240], lineWidth: 0.25 },
      columnStyles: { 3: { halign: 'center' }, 4: { halign: 'center' } },
    });

    // ─── Footer ───
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      const footerY = doc.internal.pageSize.getHeight() - 8;
      doc.text(`Generado por EvaPro \u2014 ${new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' })}`, 14, footerY);
      doc.text(`P\u00e1gina ${p} de ${pageCount}`, pageWidth - 14, footerY, { align: 'right' });
    }

    // Return as Buffer
    const arrayBuffer = doc.output('arraybuffer');
    return Buffer.from(arrayBuffer);
  }

  // ─── Performance History ────────────────────────────────────────────────

  async getPerformanceHistory(tenantId: string, userId: string, filters?: { cycleType?: string }) {
    const whereClause: any = { tenantId };
    if (filters?.cycleType) {
      whereClause.type = filters.cycleType;
    }

    const cycles = await this.cycleRepo.find({
      where: whereClause,
      order: { startDate: 'ASC' },
    });

    if (cycles.length === 0) {
      return { userId, history: [] };
    }

    const cycleIds = cycles.map((c) => c.id);

    // Single query: all assignments for this user across all cycles
    const allAssignments = await this.assignmentRepo.find({
      where: { evaluateeId: userId, tenantId, cycleId: In(cycleIds) },
    });

    // Single query: all responses for those assignments
    const assignmentIds = allAssignments.map((a) => a.id);
    const allResponses = assignmentIds.length > 0
      ? await this.responseRepo.find({ where: { assignmentId: In(assignmentIds) } })
      : [];
    const responseByAssignment = new Map(allResponses.map((r) => [r.assignmentId, r]));

    // Single query: completed objectives count per cycle
    const completedObjByCycle = new Map<string, number>();
    if (cycleIds.length > 0) {
      const objCounts = await this.objectiveRepo
        .createQueryBuilder('o')
        .select('o.cycleId', 'cycleId')
        .addSelect('COUNT(*)', 'cnt')
        .where('o.tenantId = :tenantId', { tenantId })
        .andWhere('o.userId = :userId', { userId })
        .andWhere('o.cycleId IN (:...cycleIds)', { cycleIds })
        .andWhere('o.status = :status', { status: ObjectiveStatus.COMPLETED })
        .groupBy('o.cycleId')
        .getRawMany();
      for (const row of objCounts) {
        completedObjByCycle.set(row.cycleId, parseInt(row.cnt, 10));
      }
    }

    // Group assignments by cycle
    const assignmentsByCycle = new Map<string, typeof allAssignments>();
    for (const a of allAssignments) {
      const list = assignmentsByCycle.get(a.cycleId) || [];
      list.push(a);
      assignmentsByCycle.set(a.cycleId, list);
    }

    const avg = (arr: number[]) => arr.length > 0
      ? parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1))
      : null;

    const history = [];
    for (const cycle of cycles) {
      const cycleAssignments = assignmentsByCycle.get(cycle.id);
      if (!cycleAssignments || cycleAssignments.length === 0) continue;

      const scoresByType: Record<string, number[]> = {
        self: [], manager: [], peer: [], direct_report: [],
      };

      for (const a of cycleAssignments) {
        const resp = responseByAssignment.get(a.id);
        if (resp?.overallScore != null) {
          const key = a.relationType;
          if (scoresByType[key]) scoresByType[key].push(Number(resp.overallScore));
        }
      }

      const allScores = Object.values(scoresByType).flat();

      history.push({
        cycleId: cycle.id,
        cycleName: cycle.name,
        cycleType: cycle.type,
        period: cycle.period,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        avgSelf: avg(scoresByType.self),
        avgManager: avg(scoresByType.manager),
        avgPeer: avg(scoresByType.peer),
        avgOverall: avg(allScores),
        completedObjectives: completedObjByCycle.get(cycle.id) ?? 0,
      });
    }

    return { userId, history };
  }

  // ─── Analytics ──────────────────────────────────────────────────────────

  async getAnalytics(tenantId: string, cycleId: string) {
    // Score distribution (buckets of 0.5 in scale 0-10)
    const responses = await this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
      .where('a.cycleId = :cycleId', { cycleId })
      .andWhere('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL')
      .select('r.overall_score', 'score')
      .getRawMany();

    const buckets = Array.from({ length: 20 }, (_, i) => ({
      range: `${(i * 0.5).toFixed(1)}-${((i + 1) * 0.5).toFixed(1)}`,
      count: 0,
    }));
    for (const r of responses) {
      const score = Number(r.score);
      const idx = Math.min(Math.floor(score / 0.5), 19);
      buckets[idx].count++;
    }

    // Department comparison
    const deptComparison = await this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
      .innerJoin(User, 'u', 'u.id = a.evaluatee_id')
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

    // Team benchmarks (by manager)
    const teamBenchmarks = await this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
      .innerJoin(User, 'u', 'u.id = a.evaluatee_id')
      .innerJoin(User, 'm', 'm.id = u.manager_id')
      .where('a.cycleId = :cycleId', { cycleId })
      .andWhere('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL')
      .select('m.id', 'managerId')
      .addSelect("m.first_name || ' ' || m.last_name", 'managerName')
      .addSelect('AVG(r.overall_score)', 'avgScore')
      .addSelect('COUNT(DISTINCT u.id)', 'teamSize')
      .groupBy('m.id')
      .addGroupBy('m.first_name')
      .addGroupBy('m.last_name')
      .orderBy('AVG(r.overall_score)', 'DESC')
      .getRawMany();

    return {
      scoreDistribution: buckets,
      departmentComparison: deptComparison.map((d) => ({
        department: d.department,
        avgScore: parseFloat(d.avgScore).toFixed(1),
        count: parseInt(d.count),
      })),
      teamBenchmarks: teamBenchmarks.map((t) => ({
        managerId: t.managerId,
        managerName: t.managerName,
        avgScore: parseFloat(t.avgScore).toFixed(1),
        teamSize: parseInt(t.teamSize),
      })),
    };
  }

  // ─── Bell Curve (B4 Item 16) ──────────────────────────────────────────────

  async bellCurve(cycleId: string, tenantId: string, filters?: ReportFilters) {
    const qb = this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
      .innerJoin(User, 'u', 'u.id = a.evaluatee_id')
      .where('a.cycleId = :cycleId', { cycleId })
      .andWhere('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL')
      .select('r.overall_score', 'score');
    this.applyUserFilters(qb, filters);
    const responses = await qb.getRawMany();

    const scores = responses.map((r) => Number(r.score));
    if (scores.length === 0) {
      return { cycleId, histogram: [], normalCurve: [], mean: 0, stddev: 0, count: 0 };
    }
    if (scores.length < PRIVACY_MIN_PEOPLE) {
      return {
        cycleId,
        histogram: [],
        normalCurve: [],
        mean: 0,
        stddev: 0,
        count: scores.length,
        privacyRestricted: true,
        message: `Se requieren al menos ${PRIVACY_MIN_PEOPLE} evaluaciones para mostrar la distribución (actualmente: ${scores.length})`,
      };
    }

    // Calculate mean and stddev
    const count = scores.length;
    const mean = scores.reduce((s, v) => s + v, 0) / count;
    const variance = scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (count > 1 ? count - 1 : 1);
    const stddev = Math.sqrt(variance);

    // Histogram buckets (0.5 increments from 0-10)
    const histogram = Array.from({ length: 20 }, (_, i) => ({
      range: `${(i * 0.5).toFixed(1)}`,
      rangeLabel: `${(i * 0.5).toFixed(1)}-${((i + 1) * 0.5).toFixed(1)}`,
      count: 0,
      normalY: 0,
    }));
    for (const score of scores) {
      const idx = Math.min(Math.floor(score / 0.5), 19);
      histogram[idx].count++;
    }

    // Normal distribution curve points
    if (stddev > 0) {
      for (const bucket of histogram) {
        const x = parseFloat(bucket.range) + 0.25; // midpoint of bucket
        const exponent = -Math.pow(x - mean, 2) / (2 * variance);
        const normalDensity = (1 / (stddev * Math.sqrt(2 * Math.PI))) * Math.exp(exponent);
        // Scale to histogram: density * total_count * bucket_width
        bucket.normalY = parseFloat((normalDensity * count * 0.5).toFixed(2));
      }
    }

    return {
      cycleId,
      histogram,
      mean: parseFloat(mean.toFixed(2)),
      stddev: parseFloat(stddev.toFixed(2)),
      count,
    };
  }

  // ─── C1: Competency Radar (section-level scores per evaluatee) ─────────

  async competencyRadar(cycleId: string, userId: string, tenantId: string) {
    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });
    if (!cycle) throw new NotFoundException('Ciclo no encontrado');

    let template: FormTemplate | null = null;
    if (cycle.templateId) {
      template = await this.templateRepo.findOne({ where: { id: cycle.templateId } });
    }
    if (!template || !template.sections) {
      return { userId, cycleId, sections: [], message: 'Sin plantilla asociada al ciclo' };
    }

    // Fix C2: Batch load responses (no N+1)
    const assignments = await this.assignmentRepo.find({
      where: { cycleId, evaluateeId: userId, tenantId, status: AssignmentStatus.COMPLETED },
    });

    if (assignments.length === 0) {
      return { userId, cycleId, sections: [], message: 'Este colaborador no tiene evaluaciones completadas en este ciclo' };
    }

    const assignmentIds = assignments.map((a) => a.id);
    const allResponses = assignmentIds.length > 0
      ? await this.responseRepo
          .createQueryBuilder('r')
          .where('r.assignmentId IN (:...ids)', { ids: assignmentIds })
          .getMany()
      : [];

    const responseMap = new Map(allResponses.map((r) => [r.assignmentId, r]));
    const responses = assignments
      .filter((a) => responseMap.has(a.id))
      .map((a) => ({ relationType: a.relationType, answers: responseMap.get(a.id)!.answers || {} }));

    if (responses.length === 0) {
      return { userId, cycleId, sections: [], message: 'Las evaluaciones completadas aún no tienen respuestas registradas' };
    }

    // Build section-level averages
    const sections = template.sections.map((sec: any) => {
      const scaleQuestions = (sec.questions || []).filter((q: any) => q.type === 'scale');
      if (scaleQuestions.length === 0) return null;

      const questionIds = scaleQuestions.map((q: any) => q.id);
      // Fix C4: Calculate maxScale from ALL scale questions
      const maxScale = Math.max(...scaleQuestions.map((q: any) => q.scale?.max ?? 5));

      const byRelation: Record<string, { sum: number; count: number }> = {};
      let allSum = 0;
      let allCount = 0;

      for (const resp of responses) {
        const rel = resp.relationType || 'unknown';
        if (!byRelation[rel]) byRelation[rel] = { sum: 0, count: 0 };

        for (const qId of questionIds) {
          const val = Number(resp.answers[qId]);
          if (!isNaN(val) && val > 0) {
            byRelation[rel].sum += val;
            byRelation[rel].count++;
            allSum += val;
            allCount++;
          }
        }
      }

      const relationScores: Record<string, number> = {};
      for (const [rel, data] of Object.entries(byRelation)) {
        relationScores[rel] = data.count > 0 ? Math.round((data.sum / data.count) * 100) / 100 : 0;
      }

      return {
        section: sec.title || sec.id || 'Sin nombre',
        overall: allCount > 0 ? Math.round((allSum / allCount) * 100) / 100 : 0,
        maxScale,
        byRelation: relationScores,
        questionCount: scaleQuestions.length,
      };
    }).filter(Boolean);

    if (sections.length === 0 && template.sections.length > 0) {
      return { userId, cycleId, sections: [], message: 'La plantilla no contiene preguntas de escala para generar el radar' };
    }

    return { userId, cycleId, sections };
  }

  // ─── C2: Self vs Others comparison ─────────────────────────────────────

  async selfVsOthers(cycleId: string, userId: string, tenantId: string) {
    // Fix C2: Batch load (no N+1)
    const assignments = await this.assignmentRepo.find({
      where: { cycleId, evaluateeId: userId, tenantId, status: AssignmentStatus.COMPLETED },
    });
    const assignmentIds = assignments.map((a) => a.id);
    const allResponses = assignmentIds.length > 0
      ? await this.responseRepo
          .createQueryBuilder('r')
          .where('r.assignmentId IN (:...ids)', { ids: assignmentIds })
          .getMany()
      : [];
    const responseMap = new Map(allResponses.map((r) => [r.assignmentId, r]));

    let selfScore: number | null = null;
    const otherScores: { relationType: string; score: number }[] = [];

    for (const a of assignments) {
      const resp = responseMap.get(a.id);
      if (!resp || resp.overallScore == null) continue;

      if (a.relationType === RelationType.SELF) {
        selfScore = Number(resp.overallScore);
      } else {
        otherScores.push({ relationType: a.relationType, score: Number(resp.overallScore) });
      }
    }

    const othersAvg = otherScores.length > 0
      ? Math.round((otherScores.reduce((s, o) => s + o.score, 0) / otherScores.length) * 100) / 100
      : null;

    // Fix C4: Removed dead code. Group and average by relation type directly.
    const grouped: Record<string, number[]> = {};
    for (const o of otherScores) {
      if (!grouped[o.relationType]) grouped[o.relationType] = [];
      grouped[o.relationType].push(o.score);
    }
    const byRelationAvg: Record<string, number | null> = {};
    // Include all possible relation types for completeness
    for (const rel of ['self', 'manager', 'peer', 'direct_report', 'external']) {
      if (rel === 'self') continue; // self is separate
      const scores = grouped[rel];
      byRelationAvg[rel] = scores && scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
        : null;
    }

    const gap = selfScore != null && othersAvg != null
      ? Math.round((selfScore - othersAvg) * 100) / 100
      : null;

    return {
      userId,
      cycleId,
      selfScore,
      othersAvg,
      gap,
      byRelation: byRelationAvg,
      interpretation: gap != null
        ? gap > 1 ? 'El colaborador se autoevalúa significativamente más alto que sus evaluadores'
          : gap < -1 ? 'El colaborador se autoevalúa significativamente más bajo que sus evaluadores'
            : 'La autoevaluación es consistente con la evaluación de otros'
        : null,
    };
  }

  // ─── C4: Performance Heatmap (department × score ranges) ───────────────

  async performanceHeatmap(cycleId: string, tenantId: string, filters?: ReportFilters) {
    const qb = this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
      .innerJoin(User, 'u', 'u.id = a.evaluatee_id')
      .where('a.cycleId = :cycleId', { cycleId })
      .andWhere('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL')
      .select('u.department', 'department')
      .addSelect('r.overall_score', 'score')
      .addSelect("COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')", 'name')
      .addSelect('u.id', 'userId');
    this.applyUserFilters(qb, filters);
    const raw = await qb.getRawMany();

    // Fix C3: Deduplicate users — average scores per user first
    const userMap: Record<string, { name: string; department: string; scores: number[] }> = {};
    for (const r of raw) {
      const uid = r.userId;
      if (!userMap[uid]) {
        userMap[uid] = {
          name: (r.name || '').trim(),
          department: r.department || 'Sin departamento',
          scores: [],
        };
      }
      userMap[uid].scores.push(Number(r.score));
    }

    // Group unique users by department with their average score
    const deptMap: Record<string, { users: { name: string; userId: string; score: number }[] }> = {};
    for (const [uid, data] of Object.entries(userMap)) {
      const dept = data.department;
      if (!deptMap[dept]) deptMap[dept] = { users: [] };
      const avgScore = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
      deptMap[dept].users.push({ name: data.name, userId: uid, score: Math.round(avgScore * 100) / 100 });
    }

    const heatmap = Object.entries(deptMap).map(([dept, data]) => {
      const scores = data.users.map((u) => u.score);
      // Fix C3: Guard against zero division
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const low = scores.filter((s) => s < 4).length;
      const mid = scores.filter((s) => s >= 4 && s < 7).length;
      const high = scores.filter((s) => s >= 7).length;
      return {
        department: dept,
        avgScore: Math.round(avg * 100) / 100,
        total: scores.length,
        low,
        mid,
        high,
        // Privacy: only show individual users if department has >= PRIVACY_MIN_PEOPLE
        users: scores.length >= PRIVACY_MIN_PEOPLE
          ? data.users.sort((a, b) => b.score - a.score)
          : [],
        privacyRestricted: scores.length < PRIVACY_MIN_PEOPLE,
      };
    }).sort((a, b) => b.avgScore - a.avgScore);

    return { cycleId, heatmap, privacyThreshold: PRIVACY_MIN_PEOPLE };
  }

  // ─── C5: Competency Heatmap (department × competency/section) ───────────
  //
  // Cross-references template sections (as proxy for competencies) against
  // departments, showing average score per section per department.

  async competencyHeatmap(cycleId: string, tenantId: string, filters?: ReportFilters) {
    // 1. Get cycle + template
    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });
    if (!cycle) throw new NotFoundException('Ciclo no encontrado');
    if (!cycle.templateId) {
      return { cycleId, message: 'Este ciclo no tiene plantilla asignada', grid: [], sections: [], departments: [] };
    }
    const template = await this.templateRepo.findOne({ where: { id: cycle.templateId } });
    if (!template?.sections || !Array.isArray(template.sections)) {
      return { cycleId, message: 'La plantilla no tiene secciones definidas', grid: [], sections: [], departments: [] };
    }

    // 2. Load all responses with evaluatee department
    const qb = this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
      .innerJoin(User, 'u', 'u.id = a.evaluatee_id')
      .where('a.cycleId = :cycleId', { cycleId })
      .andWhere('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.answers IS NOT NULL')
      .select('r.answers', 'answers')
      .addSelect('u.department', 'department');
    this.applyUserFilters(qb, filters);
    const rows = await qb.getRawMany();

    if (rows.length === 0) {
      return { cycleId, message: 'Sin respuestas disponibles', grid: [], sections: [], departments: [] };
    }

    // 3. Build section → questions map from template
    const sectionMeta = template.sections.map((sec: any) => ({
      id: sec.id,
      title: sec.title || sec.id,
      questionIds: (sec.questions || [])
        .filter((q: any) => q.type === 'scale')
        .map((q: any) => q.id),
    }));

    // 4. Count unique evaluatees per department for privacy check
    const deptEvaluateeCount = new Map<string, number>();
    const qbCount = this.responseRepo
      .createQueryBuilder('r2')
      .innerJoin('r2.assignment', 'a2')
      .innerJoin(User, 'u2', 'u2.id = a2.evaluatee_id')
      .where('a2.cycleId = :cycleId', { cycleId })
      .andWhere('r2.tenantId = :tenantId', { tenantId })
      .select('u2.department', 'department')
      .addSelect('COUNT(DISTINCT u2.id)', 'userCount')
      .groupBy('u2.department');
    const deptCounts = await qbCount.getRawMany();
    for (const dc of deptCounts) {
      deptEvaluateeCount.set(dc.department || 'Sin departamento', parseInt(dc.userCount));
    }

    // 5. Calculate avg score per section per department
    const grid: Record<string, Record<string, { sum: number; count: number }>> = {};
    const deptSet = new Set<string>();

    for (const row of rows) {
      const dept = row.department || 'Sin departamento';
      deptSet.add(dept);
      let answers: any;
      try {
        answers = typeof row.answers === 'string' ? JSON.parse(row.answers) : row.answers;
      } catch {
        continue; // Skip malformed JSON
      }
      if (!answers) continue;

      for (const sec of sectionMeta) {
        if (!grid[sec.id]) grid[sec.id] = {};
        if (!grid[sec.id][dept]) grid[sec.id][dept] = { sum: 0, count: 0 };

        for (const qId of sec.questionIds) {
          const val = answers[qId];
          if (val != null && typeof val === 'number') {
            grid[sec.id][dept].sum += val;
            grid[sec.id][dept].count++;
          }
        }
      }
    }

    // 6. Build output grid with privacy enforcement
    const departments = Array.from(deptSet).sort();
    const sections = sectionMeta.map((sec: any) => sec.title);

    const heatmapGrid = sectionMeta.map((sec: any) => ({
      section: sec.title,
      values: departments.map((dept) => {
        const cell = grid[sec.id]?.[dept];
        const deptUserCount = deptEvaluateeCount.get(dept) || 0;
        // Privacy: hide scores if department has fewer than PRIVACY_MIN_PEOPLE unique evaluatees
        if (deptUserCount < PRIVACY_MIN_PEOPLE) {
          return { department: dept, avg: null, count: 0, privacyRestricted: true };
        }
        if (!cell || cell.count === 0) return { department: dept, avg: null, count: 0 };
        return {
          department: dept,
          avg: Math.round((cell.sum / cell.count) * 100) / 100,
          count: cell.count,
        };
      }),
    }));

    return { cycleId, sections, departments, grid: heatmapGrid, privacyThreshold: PRIVACY_MIN_PEOPLE };
  }

  // ─── Gap Analysis: Individual Employee ──────────────────────────────────

  async gapAnalysisIndividual(cycleId: string, userId: string, tenantId: string) {
    // 1. Get user and their position
    const user = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // 2. Get expected competency levels for this role/position
    const roleCompetencies = await this.roleCompetencyRepo.find({
      where: { tenantId, position: user.position || '' },
      relations: ['competency'],
    });

    if (roleCompetencies.length === 0) {
      return {
        userId,
        userName: `${user.firstName} ${user.lastName}`,
        position: user.position,
        gaps: [],
        summary: { totalCompetencies: 0, avgGap: 0, criticalGaps: 0 },
        message: 'No hay perfil de competencias definido para este cargo',
      };
    }

    // 3. Get the cycle and template to map competencies to form sections
    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });
    if (!cycle) throw new NotFoundException('Ciclo no encontrado');

    let template: FormTemplate | null = null;
    if (cycle.templateId) {
      template = await this.templateRepo.findOne({ where: { id: cycle.templateId } });
    }

    // 4. Get evaluation responses for this user in this cycle
    const assignments = await this.assignmentRepo.find({
      where: { cycleId, evaluateeId: userId, tenantId, status: AssignmentStatus.COMPLETED },
    });
    const assignmentIds = assignments.map((a) => a.id);
    const allResponses = assignmentIds.length > 0
      ? await this.responseRepo.find({ where: { assignmentId: In(assignmentIds) } })
      : [];

    // 5. Calculate observed scores per competency (by matching section names to competency names)
    const observedScores = new Map<string, { sum: number; count: number }>();

    if (template?.sections) {
      for (const resp of allResponses) {
        if (!resp.answers) continue;
        for (const section of template.sections as any[]) {
          const scaleQuestions = (section.questions || []).filter((q: any) => q.type === 'scale');
          if (scaleQuestions.length === 0) continue;

          let sectionSum = 0;
          let sectionCount = 0;
          for (const q of scaleQuestions) {
            const val = Number(resp.answers[q.id]);
            if (!isNaN(val) && val > 0) {
              sectionSum += val;
              sectionCount++;
            }
          }

          if (sectionCount > 0) {
            const sectionName = (section.title || '').toLowerCase().trim();
            const existing = observedScores.get(sectionName) || { sum: 0, count: 0 };
            existing.sum += sectionSum / sectionCount;
            existing.count += 1;
            observedScores.set(sectionName, existing);
          }
        }
      }
    }

    // 6. Build gap analysis for each expected competency
    const gaps = roleCompetencies.map((rc) => {
      const competencyName = rc.competency?.name || '';
      const competencyNameLower = competencyName.toLowerCase().trim();
      const observed = observedScores.get(competencyNameLower);
      const observedLevel = observed
        ? Math.round((observed.sum / observed.count) * 100) / 100
        : null;
      const gap = observedLevel !== null ? observedLevel - rc.expectedLevel : null;

      return {
        competencyId: rc.competencyId,
        competencyName,
        category: rc.competency?.category || null,
        expectedLevel: rc.expectedLevel,
        observedLevel,
        gap,
        gapPercentage: gap !== null && rc.expectedLevel > 0
          ? Math.round((gap / rc.expectedLevel) * 100)
          : null,
        status: gap === null ? 'sin_datos'
          : gap >= 0 ? 'cumple'
          : gap >= -1 ? 'brecha_menor'
          : 'brecha_critica',
      };
    });

    const gapsWithData = gaps.filter((g) => g.gap !== null);
    const criticalGaps = gaps.filter((g) => g.status === 'brecha_critica');

    return {
      userId,
      cycleId,
      userName: `${user.firstName} ${user.lastName}`,
      position: user.position,
      department: user.department,
      gaps: gaps.sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0)),
      summary: {
        totalCompetencies: gaps.length,
        withData: gapsWithData.length,
        avgGap: gapsWithData.length > 0
          ? Math.round((gapsWithData.reduce((s, g) => s + (g.gap ?? 0), 0) / gapsWithData.length) * 100) / 100
          : 0,
        criticalGaps: criticalGaps.length,
        meetsExpectation: gaps.filter((g) => g.status === 'cumple').length,
      },
    };
  }

  // ─── Gap Analysis: Team ──────────────────────────────────────────────────

  async gapAnalysisTeam(cycleId: string, managerId: string, tenantId: string) {
    // 1. Get all team members
    const teamMembers = await this.userRepo.find({
      where: { managerId, tenantId, isActive: true },
    });

    if (teamMembers.length === 0) {
      return { managerId, cycleId, members: [], teamSummary: null };
    }

    // 2. Run individual gap analysis for each member (reuse method)
    const memberGaps = await Promise.all(
      teamMembers.map((m) => this.gapAnalysisIndividual(cycleId, m.id, tenantId)),
    );

    // 3. Aggregate team-level competency gaps
    const competencyAgg = new Map<string, {
      name: string; category: string | null; expectedSum: number; observedSum: number;
      count: number; criticalCount: number;
    }>();

    for (const member of memberGaps) {
      for (const gap of member.gaps) {
        if (gap.observedLevel === null) continue;
        const agg = competencyAgg.get(gap.competencyId) || {
          name: gap.competencyName,
          category: gap.category,
          expectedSum: 0, observedSum: 0, count: 0, criticalCount: 0,
        };
        agg.expectedSum += gap.expectedLevel;
        agg.observedSum += gap.observedLevel;
        agg.count += 1;
        if (gap.status === 'brecha_critica') agg.criticalCount += 1;
        competencyAgg.set(gap.competencyId, agg);
      }
    }

    const teamCompetencyGaps = [...competencyAgg.entries()].map(([id, agg]) => ({
      competencyId: id,
      competencyName: agg.name,
      category: agg.category,
      avgExpected: Math.round((agg.expectedSum / agg.count) * 100) / 100,
      avgObserved: Math.round((agg.observedSum / agg.count) * 100) / 100,
      avgGap: Math.round(((agg.observedSum - agg.expectedSum) / agg.count) * 100) / 100,
      membersEvaluated: agg.count,
      criticalCount: agg.criticalCount,
    })).sort((a, b) => a.avgGap - b.avgGap);

    return {
      managerId,
      cycleId,
      members: memberGaps.map((m) => ({
        userId: m.userId,
        userName: m.userName,
        position: m.position,
        department: m.department,
        summary: m.summary,
      })),
      teamCompetencyGaps,
      teamSummary: {
        totalMembers: teamMembers.length,
        membersWithGaps: memberGaps.filter((m) => m.summary.criticalGaps > 0).length,
        avgTeamGap: teamCompetencyGaps.length > 0
          ? Math.round((teamCompetencyGaps.reduce((s, g) => s + g.avgGap, 0) / teamCompetencyGaps.length) * 100) / 100
          : 0,
        topCriticalCompetencies: teamCompetencyGaps
          .filter((g) => g.avgGap < -1)
          .slice(0, 5)
          .map((g) => g.competencyName),
      },
    };
  }
}
