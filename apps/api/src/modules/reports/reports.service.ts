import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment, AssignmentStatus, RelationType } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { Objective, ObjectiveStatus } from '../objectives/entities/objective.entity';
import { User } from '../users/entities/user.entity';

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
  ) {}

  async cycleSummary(cycleId: string, tenantId: string) {
    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });
    if (!cycle) throw new NotFoundException('Ciclo no encontrado');

    const totalAssignments = await this.assignmentRepo.count({
      where: { cycleId, tenantId },
    });
    const completedAssignments = await this.assignmentRepo.count({
      where: { cycleId, tenantId, status: AssignmentStatus.COMPLETED },
    });

    const avgResult = await this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
      .where('a.cycleId = :cycleId', { cycleId })
      .andWhere('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL')
      .select('AVG(r.overall_score)', 'avg')
      .getRawOne();

    // Department breakdown
    const deptBreakdown = await this.responseRepo
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
    };
  }

  async individualResults(cycleId: string, userId: string, tenantId: string) {
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

    const results = [];
    for (const assignment of assignments) {
      const response = await this.responseRepo.findOne({
        where: { assignmentId: assignment.id },
      });

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

    const results = [];
    for (const member of teamMembers) {
      const assignments = await this.assignmentRepo.find({
        where: { cycleId, evaluateeId: member.id, tenantId, status: AssignmentStatus.COMPLETED },
      });

      let totalScore = 0;
      let scoreCount = 0;
      for (const a of assignments) {
        const resp = await this.responseRepo.findOne({ where: { assignmentId: a.id } });
        if (resp?.overallScore) {
          totalScore += Number(resp.overallScore);
          scoreCount++;
        }
      }

      results.push({
        userId: member.id,
        name: `${member.firstName} ${member.lastName}`,
        department: member.department,
        position: member.position,
        completedEvaluations: assignments.length,
        averageScore: scoreCount > 0 ? (totalScore / scoreCount).toFixed(1) : null,
      });
    }

    return { managerId, cycleId, team: results };
  }

  async exportCsv(cycleId: string, tenantId: string): Promise<string> {
    const assignments = await this.assignmentRepo.find({
      where: { cycleId, tenantId, status: AssignmentStatus.COMPLETED },
      relations: ['evaluatee', 'evaluator'],
    });

    const rows = ['Evaluado,Evaluador,Relación,Puntaje,Fecha'];
    for (const a of assignments) {
      const resp = await this.responseRepo.findOne({ where: { assignmentId: a.id } });
      rows.push([
        `${a.evaluatee.firstName} ${a.evaluatee.lastName}`,
        `${a.evaluator.firstName} ${a.evaluator.lastName}`,
        a.relationType,
        resp?.overallScore ?? '',
        resp?.submittedAt?.toISOString().split('T')[0] ?? '',
      ].join(','));
    }
    return rows.join('\n');
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
        `${a.evaluatee.firstName} ${a.evaluatee.lastName}`,
        `${a.evaluator.firstName} ${a.evaluator.lastName}`,
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

  async getPerformanceHistory(tenantId: string, userId: string) {
    const cycles = await this.cycleRepo.find({
      where: { tenantId },
      order: { startDate: 'ASC' },
    });

    const history = [];
    for (const cycle of cycles) {
      const assignments = await this.assignmentRepo.find({
        where: { cycleId: cycle.id, evaluateeId: userId, tenantId },
      });
      if (assignments.length === 0) continue;

      const scoresByType: Record<string, number[]> = {
        self: [], manager: [], peer: [], direct_report: [],
      };

      for (const a of assignments) {
        const resp = await this.responseRepo.findOne({ where: { assignmentId: a.id } });
        if (resp?.overallScore != null) {
          const key = a.relationType;
          if (scoresByType[key]) scoresByType[key].push(Number(resp.overallScore));
        }
      }

      const avg = (arr: number[]) => arr.length > 0
        ? parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1))
        : null;

      const allScores = Object.values(scoresByType).flat();

      const completedObjectives = await this.objectiveRepo.count({
        where: { tenantId, userId, cycleId: cycle.id, status: ObjectiveStatus.COMPLETED },
      });

      history.push({
        cycleId: cycle.id,
        cycleName: cycle.name,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        avgSelf: avg(scoresByType.self),
        avgManager: avg(scoresByType.manager),
        avgPeer: avg(scoresByType.peer),
        avgOverall: avg(allScores),
        completedObjectives,
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
}
