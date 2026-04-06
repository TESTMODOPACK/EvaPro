import type ExcelJS from 'exceljs';
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
import { AuditService } from '../audit/audit.service';

export interface ReportFilters {
  department?: string;
  position?: string;
  gender?: string;
  seniorityLevel?: string;
  contractType?: string;
  workLocation?: string;
  nationality?: string;
  managerId?: string; // Filter evaluatees to a manager's direct reports
}

/**
 * Privacy threshold: reports with fewer than this many people
 * will not return individual-level data to prevent identification.
 */
const PRIVACY_MIN_PEOPLE = 3;

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
    private readonly auditService: AuditService,
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
    if (filters.gender) {
      qb.andWhere(`${userAlias}.gender = :gender`, { gender: filters.gender });
    }
    if (filters.seniorityLevel) {
      qb.andWhere(`${userAlias}.seniorityLevel = :seniorityLevel`, { seniorityLevel: filters.seniorityLevel });
    }
    if (filters.contractType) {
      qb.andWhere(`${userAlias}.contractType = :contractType`, { contractType: filters.contractType });
    }
    if (filters.workLocation) {
      qb.andWhere(`${userAlias}.workLocation = :workLocation`, { workLocation: filters.workLocation });
    }
    if (filters.nationality) {
      qb.andWhere(`${userAlias}.nationality = :nationality`, { nationality: filters.nationality });
    }
    if (filters.managerId) {
      qb.andWhere(`${userAlias}.managerId = :managerId`, { managerId: filters.managerId });
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

  // ─── Export Excel (.xlsx) ───────────────────────────────────────────────

  async exportXlsx(cycleId: string, tenantId: string): Promise<Buffer> {
    const ExcelJS = (await import('exceljs')).default;

    const summary = await this.cycleSummary(cycleId, tenantId);
    const assignments = await this.assignmentRepo.find({
      where: { cycleId, tenantId, status: AssignmentStatus.COMPLETED },
      relations: ['evaluatee', 'evaluator'],
    });

    const assignmentIds = assignments.map((a) => a.id);
    const allResponses = assignmentIds.length > 0
      ? await this.responseRepo.find({ where: { assignmentId: In(assignmentIds) } })
      : [];
    const responseByAssignment = new Map(allResponses.map((r) => [r.assignmentId, r]));

    const relationLabels: Record<string, string> = {
      self: 'Autoevaluación',
      manager: 'Encargado',
      peer: 'Par',
      direct_report: 'Reporte directo',
      external: 'Externo',
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'EvaPro';
    wb.created = new Date();

    const ACCENT = { argb: 'FF6366F1' };
    const ACCENT_LIGHT = { argb: 'FFE0E7FF' };
    const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
    const TITLE_FONT = { bold: true, name: 'Calibri', size: 13, color: { argb: 'FF1E1E3C' } };

    const styleHeader = (row: ExcelJS.Row) => {
      row.eachCell((cell: ExcelJS.Cell) => {
        cell.font = HEADER_FONT;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: ACCENT };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });
      row.height = 22;
    };

    // ── Sheet 1: Resumen ──────────────────────────────────────────────────
    const wsResumen = wb.addWorksheet('Resumen');
    wsResumen.columns = [
      { key: 'label', width: 30 },
      { key: 'value', width: 25 },
    ];

    const titleRow = wsResumen.addRow([`Reporte de Evaluación — ${summary.cycle.name}`, '']);
    wsResumen.mergeCells(`A${titleRow.number}:B${titleRow.number}`);
    titleRow.getCell('A').font = { bold: true, name: 'Calibri', size: 15, color: ACCENT };
    titleRow.height = 30;

    wsResumen.addRow([]);

    const metaRows: [string, string][] = [
      ['Ciclo', summary.cycle.name],
      ['Tipo', summary.cycle.type],
      ['Inicio', new Date(summary.cycle.startDate).toLocaleDateString('es-CL')],
      ['Cierre', new Date(summary.cycle.endDate).toLocaleDateString('es-CL')],
      ['Estado', summary.cycle.status],
      ['Generado el', new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' })],
    ];
    metaRows.forEach(([label, value]) => {
      const r = wsResumen.addRow([label, value]);
      r.getCell('A').font = { bold: true, name: 'Calibri', size: 10, color: { argb: 'FF64748B' } };
      r.getCell('B').font = { name: 'Calibri', size: 10 };
    });

    wsResumen.addRow([]);

    const kpiTitle = wsResumen.addRow(['Métricas Clave', '']);
    kpiTitle.getCell('A').font = TITLE_FONT;
    kpiTitle.height = 24;

    const kpiHeaderRow = wsResumen.addRow(['Indicador', 'Valor']);
    styleHeader(kpiHeaderRow);

    const kpis: [string, string | number][] = [
      ['Total de asignaciones', summary.totalAssignments],
      ['Evaluaciones completadas', summary.completedAssignments],
      ['Tasa de completitud', `${summary.completionRate}%`],
      ['Puntaje promedio global', summary.averageScore ? Number(summary.averageScore).toFixed(2) : '—'],
    ];
    kpis.forEach(([label, value]) => {
      const r = wsResumen.addRow([label, value]);
      r.getCell('A').font = { name: 'Calibri', size: 10 };
      r.getCell('B').font = { bold: true, name: 'Calibri', size: 10 };
      r.getCell('B').alignment = { horizontal: 'center' };
      r.getCell('B').fill = { type: 'pattern', pattern: 'solid', fgColor: ACCENT_LIGHT };
    });

    // ── Sheet 2: Por Departamento ─────────────────────────────────────────
    const wsDept = wb.addWorksheet('Por Departamento');
    wsDept.columns = [
      { key: 'dept', header: 'Departamento', width: 28 },
      { key: 'avg', header: 'Puntaje Promedio', width: 18 },
      { key: 'count', header: 'Evaluaciones', width: 16 },
    ];

    const deptHeader = wsDept.getRow(1);
    styleHeader(deptHeader);

    const deptSorted = [...(summary.departmentBreakdown || [])].sort(
      (a: any, b: any) => Number(b.avgScore) - Number(a.avgScore),
    );
    deptSorted.forEach((d: any, i: number) => {
      const r = wsDept.addRow({
        dept: d.department || 'Sin depto.',
        avg: Number(d.avgScore).toFixed(2),
        count: d.count,
      });
      if (i % 2 === 0) {
        r.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        });
      }
      r.getCell('avg').alignment = { horizontal: 'center' };
      r.getCell('count').alignment = { horizontal: 'center' };
    });

    // ── Sheet 3: Detalle de Evaluaciones ─────────────────────────────────
    const wsDetail = wb.addWorksheet('Detalle');
    wsDetail.columns = [
      { key: 'evaluatee', header: 'Evaluado', width: 26 },
      { key: 'dept', header: 'Departamento', width: 22 },
      { key: 'evaluator', header: 'Evaluador', width: 26 },
      { key: 'relation', header: 'Relación', width: 18 },
      { key: 'score', header: 'Puntaje', width: 12 },
      { key: 'date', header: 'Fecha', width: 14 },
    ];

    styleHeader(wsDetail.getRow(1));

    assignments.forEach((a, i) => {
      const resp = responseByAssignment.get(a.id);
      const r = wsDetail.addRow({
        evaluatee: a.evaluatee ? `${a.evaluatee.firstName} ${a.evaluatee.lastName}` : 'N/A',
        dept: (a.evaluatee as any)?.department || '—',
        evaluator: a.evaluator ? `${a.evaluator.firstName} ${a.evaluator.lastName}` : 'N/A',
        relation: relationLabels[a.relationType] || a.relationType,
        score: resp?.overallScore != null ? Number(resp.overallScore).toFixed(2) : '—',
        date: resp?.submittedAt ? new Date(resp.submittedAt).toLocaleDateString('es-CL') : '—',
      });
      if (i % 2 === 0) {
        r.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        });
      }
      r.getCell('score').alignment = { horizontal: 'center' };
      r.getCell('date').alignment = { horizontal: 'center' };
      // Color score cell by range
      const score = resp?.overallScore != null ? Number(resp.overallScore) : null;
      if (score !== null) {
        const color = score >= 7 ? 'FFD1FAE5' : score >= 4 ? 'FFFEF3C7' : 'FFFEE2E2';
        r.getCell('score').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      }
    });

    // ── Sheet 4: Resumen por Evaluado ─────────────────────────────────────
    const wsEvaluees = wb.addWorksheet('Por Evaluado');
    wsEvaluees.columns = [
      { key: 'name', header: 'Evaluado', width: 26 },
      { key: 'dept', header: 'Departamento', width: 22 },
      { key: 'completed', header: 'Eval. Recibidas', width: 16 },
      { key: 'avg', header: 'Puntaje Promedio', width: 18 },
    ];

    styleHeader(wsEvaluees.getRow(1));

    // Group by evaluatee
    const byEvaluatee = new Map<string, { name: string; dept: string; scores: number[] }>();
    assignments.forEach((a) => {
      const resp = responseByAssignment.get(a.id);
      if (!a.evaluatee || resp?.overallScore == null) return;
      const key = a.evaluateeId;
      if (!byEvaluatee.has(key)) {
        byEvaluatee.set(key, {
          name: `${a.evaluatee.firstName} ${a.evaluatee.lastName}`,
          dept: (a.evaluatee as any)?.department || '—',
          scores: [],
        });
      }
      byEvaluatee.get(key)!.scores.push(Number(resp.overallScore));
    });

    [...byEvaluatee.entries()]
      .map(([, v]) => ({
        name: v.name,
        dept: v.dept,
        completed: v.scores.length,
        avg: v.scores.length > 0
          ? (v.scores.reduce((s, x) => s + x, 0) / v.scores.length).toFixed(2)
          : '—',
      }))
      .sort((a, b) => Number(b.avg) - Number(a.avg))
      .forEach((row, i) => {
        const r = wsEvaluees.addRow(row);
        if (i % 2 === 0) {
          r.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          });
        }
        r.getCell('avg').alignment = { horizontal: 'center' };
        r.getCell('completed').alignment = { horizontal: 'center' };
      });

    // All sheets: freeze top row, auto-filter
    [wsResumen, wsDept, wsDetail, wsEvaluees].forEach((ws) => {
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    });
    [wsDept, wsDetail, wsEvaluees].forEach((ws) => {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
    });

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
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

  async getAnalytics(tenantId: string, cycleId: string, managerId?: string) {
    // Score distribution (buckets of 0.5 in scale 0-10)
    const responseQb = this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
      .where('a.cycleId = :cycleId', { cycleId })
      .andWhere('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL');

    // Manager scope: only show data for direct reports
    if (managerId) {
      responseQb.innerJoin(User, 'scope_u', 'scope_u.id = a.evaluatee_id AND scope_u.manager_id = :managerId', { managerId });
    }

    const responses = await responseQb.select('r.overall_score', 'score').getRawMany();

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
    const deptQb = this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
      .innerJoin(User, 'u', 'u.id = a.evaluatee_id')
      .where('a.cycleId = :cycleId', { cycleId })
      .andWhere('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL')
      .andWhere('u.department IS NOT NULL');
    if (managerId) {
      deptQb.andWhere('u.manager_id = :managerId', { managerId });
    }
    const deptComparison = await deptQb
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
      .addSelect('m.department', 'department')
      .addSelect('AVG(r.overall_score)', 'avgScore')
      .addSelect('COUNT(DISTINCT u.id)', 'teamSize')
      .groupBy('m.id')
      .addGroupBy('m.first_name')
      .addGroupBy('m.last_name')
      .addGroupBy('m.department')
      .orderBy('AVG(r.overall_score)', 'DESC')
      .getRawMany();

    return {
      scoreDistribution: buckets,
      departmentComparison: deptComparison.map((d) => ({
        department: d.department,
        avgScore: parseFloat(d.avgScore).toFixed(1),
        count: parseInt(d.count),
      })),
      teamBenchmarks: teamBenchmarks.map((t: any) => ({
        managerId: t.managerId,
        managerName: t.managerName,
        department: t.department || null,
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
      const maxScale = Math.max(...scaleQuestions.map((q: any) => q.scale?.max ?? 10));

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
    const sectionMeta = template.sections.map((sec: any) => {
      const scaleQs = (sec.questions || []).filter((q: any) => q.type === 'scale');
      return {
        id: sec.id,
        title: sec.title || sec.id,
        questionIds: scaleQs.map((q: any) => q.id),
        maxScale: scaleQs.length > 0 ? Math.max(...scaleQs.map((q: any) => q.scale?.max ?? 10)) : 10,
      };
    });

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
      maxScale: 10, // Always normalize to scale 1-10 for consistency
      values: departments.map((dept) => {
        const cell = grid[sec.id]?.[dept];
        const deptUserCount = deptEvaluateeCount.get(dept) || 0;
        // Privacy: hide scores if department has fewer than PRIVACY_MIN_PEOPLE unique evaluatees
        if (deptUserCount < PRIVACY_MIN_PEOPLE) {
          return { department: dept, avg: null, count: 0, privacyRestricted: true };
        }
        if (!cell || cell.count === 0) return { department: dept, avg: null, count: 0 };
        // Normalize to scale 1-10 (if original scale is 1-5, multiply by 2)
        const rawAvg = cell.sum / cell.count;
        const normalizedAvg = sec.maxScale < 10 ? (rawAvg / sec.maxScale) * 10 : rawAvg;
        return {
          department: dept,
          avg: Math.round(normalizedAvg * 100) / 100,
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

  // ─── Export PowerPoint ──────────────────────────────────────────────────

  async exportPptx(cycleId: string, tenantId: string): Promise<Buffer> {
    const PptxGenJS = (await import('pptxgenjs')).default;

    // Gather data
    const summary = await this.cycleSummary(cycleId, tenantId);
    const bellData = await this.bellCurve(cycleId, tenantId);
    const heatmapData = await this.performanceHeatmap(cycleId, tenantId);

    const pptx = new PptxGenJS();
    pptx.author = 'Eva360';
    pptx.title = `Reporte - ${summary.cycle.name}`;
    pptx.subject = 'Evaluación de Desempeño';

    const GOLD = 'C9933A';
    const GOLD_LIGHT = 'E8C97A';
    const DARK = '1a1206';
    const GRAY = '5a4a2e';
    const LIGHT_BG = 'F5F5F0';

    // ─── Slide 1: Title ─────────────────────────────────────────────
    const slide1 = pptx.addSlide();
    slide1.background = { color: DARK };
    slide1.addText('Eva360', {
      x: 0.8, y: 1.0, w: 8.4, h: 0.6,
      fontSize: 14, color: GOLD_LIGHT, fontFace: 'Arial',
    });
    slide1.addText(summary.cycle.name, {
      x: 0.8, y: 1.8, w: 8.4, h: 1.0,
      fontSize: 32, bold: true, color: 'FFFFFF', fontFace: 'Arial',
    });
    slide1.addText(
      `${summary.cycle.type} | ${new Date(summary.cycle.startDate).toLocaleDateString('es-CL')} - ${new Date(summary.cycle.endDate).toLocaleDateString('es-CL')}`,
      { x: 0.8, y: 2.9, w: 8.4, h: 0.4, fontSize: 14, color: GOLD, fontFace: 'Arial' },
    );
    slide1.addText(`Generado: ${new Date().toLocaleDateString('es-CL')}`, {
      x: 0.8, y: 4.5, w: 8.4, h: 0.3, fontSize: 10, color: '888888', fontFace: 'Arial',
    });

    // ─── Slide 2: Summary KPIs ──────────────────────────────────────
    const slide2 = pptx.addSlide();
    slide2.background = { color: LIGHT_BG };
    slide2.addText('Resumen del Ciclo', {
      x: 0.5, y: 0.3, w: 9, h: 0.5,
      fontSize: 22, bold: true, color: DARK, fontFace: 'Arial',
    });

    const kpis = [
      { label: 'Total Evaluaciones', value: String(summary.totalAssignments) },
      { label: 'Completadas', value: String(summary.completedAssignments) },
      { label: 'Completitud', value: `${summary.completionRate}%` },
      { label: 'Puntaje Promedio', value: summary.averageScore ? Number(summary.averageScore).toFixed(1) : 'N/A' },
    ];

    kpis.forEach((kpi, i) => {
      const col = i % 4;
      slide2.addShape(pptx.ShapeType.roundRect, {
        x: 0.5 + col * 2.3, y: 1.2, w: 2.0, h: 1.4,
        fill: { color: 'FFFFFF' }, line: { color: GOLD, width: 1 },
        rectRadius: 0.1,
      });
      slide2.addText(kpi.value, {
        x: 0.5 + col * 2.3, y: 1.35, w: 2.0, h: 0.7,
        fontSize: 28, bold: true, color: GOLD, align: 'center', fontFace: 'Arial',
      });
      slide2.addText(kpi.label, {
        x: 0.5 + col * 2.3, y: 2.05, w: 2.0, h: 0.4,
        fontSize: 10, color: GRAY, align: 'center', fontFace: 'Arial',
      });
    });

    // Department breakdown summary on same slide
    if (summary.departmentBreakdown && summary.departmentBreakdown.length > 0) {
      slide2.addText('Resumen por Departamento', {
        x: 0.5, y: 3.0, w: 9, h: 0.4,
        fontSize: 14, bold: true, color: DARK, fontFace: 'Arial',
      });
      const summaryRows: any[][] = [
        [
          { text: 'Departamento', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
          { text: 'Promedio', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
          { text: 'Evaluados', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
        ],
      ];
      for (const dept of summary.departmentBreakdown.slice(0, 8)) {
        summaryRows.push([dept.department, Number(dept.avgScore).toFixed(1), String(dept.count)]);
      }
      slide2.addTable(summaryRows, {
        x: 0.5, y: 3.5, w: 9,
        fontSize: 10, fontFace: 'Arial',
        border: { color: 'DDDDDD', pt: 0.5 },
        colW: [4, 2.5, 2.5],
      });
    }

    // ─── Slide 3: Department Breakdown ──────────────────────────────
    if (summary.departmentBreakdown && summary.departmentBreakdown.length > 0) {
      const slide3 = pptx.addSlide();
      slide3.background = { color: LIGHT_BG };
      slide3.addText('Resultados por Departamento', {
        x: 0.5, y: 0.3, w: 9, h: 0.5,
        fontSize: 22, bold: true, color: DARK, fontFace: 'Arial',
      });

      const deptRows: any[][] = [
        [
          { text: 'Departamento', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
          { text: 'Puntaje Promedio', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
          { text: 'Evaluados', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
        ],
      ];
      for (const dept of summary.departmentBreakdown) {
        deptRows.push([dept.department, Number(dept.avgScore).toFixed(1), String(dept.count)]);
      }
      slide3.addTable(deptRows, {
        x: 0.5, y: 1.0, w: 9,
        fontSize: 11, fontFace: 'Arial',
        border: { color: 'DDDDDD', pt: 0.5 },
        colW: [4, 2.5, 2.5],
      });
    }

    // ─── Slide 4: Bell Curve Stats ──────────────────────────────────
    if (bellData && !bellData.privacyRestricted && bellData.count > 0) {
      const slide4 = pptx.addSlide();
      slide4.background = { color: LIGHT_BG };
      slide4.addText('Distribución de Puntajes (Curva de Bell)', {
        x: 0.5, y: 0.3, w: 9, h: 0.5,
        fontSize: 22, bold: true, color: DARK, fontFace: 'Arial',
      });

      const bellKpis = [
        { label: 'Media', value: bellData.mean?.toFixed(2) || '0' },
        { label: 'Desv. Estándar', value: bellData.stddev?.toFixed(2) || '0' },
        { label: 'Total respuestas', value: String(bellData.count) },
      ];
      bellKpis.forEach((kpi, i) => {
        slide4.addShape(pptx.ShapeType.roundRect, {
          x: 0.5 + i * 3.0, y: 1.0, w: 2.5, h: 1.2,
          fill: { color: 'FFFFFF' }, line: { color: GOLD, width: 1 },
          rectRadius: 0.1,
        });
        slide4.addText(kpi.value, {
          x: 0.5 + i * 3.0, y: 1.1, w: 2.5, h: 0.6,
          fontSize: 24, bold: true, color: GOLD, align: 'center', fontFace: 'Arial',
        });
        slide4.addText(kpi.label, {
          x: 0.5 + i * 3.0, y: 1.7, w: 2.5, h: 0.35,
          fontSize: 10, color: GRAY, align: 'center', fontFace: 'Arial',
        });
      });

      // Histogram as table
      if (bellData.histogram && bellData.histogram.length > 0) {
        const topBuckets = bellData.histogram.filter((b: any) => b.count > 0);
        if (topBuckets.length > 0) {
          slide4.addText('Distribución por rango', {
            x: 0.5, y: 2.6, w: 9, h: 0.4,
            fontSize: 12, bold: true, color: DARK, fontFace: 'Arial',
          });
          const histRows: any[][] = [[
            { text: 'Rango', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
            { text: 'Cantidad', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
          ]];
          for (const b of topBuckets.slice(0, 15)) {
            histRows.push([b.rangeLabel || b.range, String(b.count)]);
          }
          slide4.addTable(histRows, {
            x: 0.5, y: 3.1, w: 6,
            fontSize: 9, fontFace: 'Arial',
            border: { color: 'DDDDDD', pt: 0.5 },
            colW: [3, 3],
          });
        }
      }
    }

    // ─── Slide 5: Heatmap ───────────────────────────────────────────
    if (heatmapData?.heatmap && heatmapData.heatmap.length > 0) {
      const slide5 = pptx.addSlide();
      slide5.background = { color: LIGHT_BG };
      slide5.addText('Mapa de Calor por Departamento', {
        x: 0.5, y: 0.3, w: 9, h: 0.5,
        fontSize: 22, bold: true, color: DARK, fontFace: 'Arial',
      });

      const heatRows: any[][] = [[
        { text: 'Departamento', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
        { text: 'Promedio', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
        { text: 'Evaluados', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
        { text: 'Bajo', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
        { text: 'Medio', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
        { text: 'Alto', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
      ]];
      for (const dept of heatmapData.heatmap) {
        heatRows.push([
          dept.department,
          String(dept.avgScore),
          String(dept.total),
          String(dept.low),
          String(dept.mid),
          String(dept.high),
        ]);
      }
      slide5.addTable(heatRows, {
        x: 0.5, y: 1.0, w: 9,
        fontSize: 10, fontFace: 'Arial',
        border: { color: 'DDDDDD', pt: 0.5 },
        colW: [2.5, 1.3, 1.3, 1.3, 1.3, 1.3],
      });
    }

    // ─── Slide 6: Closing ───────────────────────────────────────────
    const slideEnd = pptx.addSlide();
    slideEnd.background = { color: DARK };
    slideEnd.addText('Eva360', {
      x: 0.5, y: 2.0, w: 9, h: 0.8,
      fontSize: 28, bold: true, color: GOLD_LIGHT, align: 'center', fontFace: 'Arial',
    });
    slideEnd.addText('Reporte generado automáticamente', {
      x: 0.5, y: 3.0, w: 9, h: 0.4,
      fontSize: 12, color: '888888', align: 'center', fontFace: 'Arial',
    });
    slideEnd.addText(`${new Date().toLocaleDateString('es-CL')} — Confidencial`, {
      x: 0.5, y: 3.5, w: 9, h: 0.3,
      fontSize: 10, color: '666666', align: 'center', fontFace: 'Arial',
    });

    // Generate buffer
    const arrayBuffer = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer;
    return Buffer.from(arrayBuffer);
  }

  // ─── Analytics Cycle Export (Bell Curve + Competency Heatmap + Team Benchmarks) ───

  async exportAnalyticsCycleXlsx(cycleId: string, tenantId: string, managerId?: string): Promise<Buffer> {
    const ExcelJS = (await import('exceljs')).default;

    const analytics = await this.getAnalytics(tenantId, cycleId, managerId);
    const mgrFilter = managerId ? { managerId } : undefined;
    const bellData = await this.bellCurve(cycleId, tenantId, mgrFilter);
    const heatmapData = await this.competencyHeatmap(cycleId, tenantId, mgrFilter);
    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Eva360';
    wb.created = new Date();

    const ACCENT = { argb: 'FF6366F1' };
    const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
    const TITLE_FONT = { bold: true, name: 'Calibri', size: 13, color: { argb: 'FF1E1E3C' } };

    const styleHeader = (row: ExcelJS.Row) => {
      row.eachCell((cell: ExcelJS.Cell) => {
        cell.font = HEADER_FONT;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: ACCENT };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
      });
      row.height = 22;
    };

    // ── Sheet 1: Curva de Bell ───────────────────────────────────────
    const wsBell = wb.addWorksheet('Curva de Bell');
    const titleRow = wsBell.addRow([`Análisis de Ciclo — ${cycle?.name || cycleId}`]);
    titleRow.getCell('A').font = { bold: true, name: 'Calibri', size: 15, color: ACCENT };
    titleRow.height = 30;
    wsBell.addRow([]);

    if (bellData && !bellData.privacyRestricted && bellData.count > 0) {
      wsBell.addRow(['Estadísticas']).getCell('A').font = TITLE_FONT;
      wsBell.addRow(['Media', bellData.mean?.toFixed(2)]);
      wsBell.addRow(['Desviación Estándar', bellData.stddev?.toFixed(2)]);
      wsBell.addRow(['Total evaluaciones', bellData.count]);
      wsBell.addRow([]);

      const histTitle = wsBell.addRow(['Distribución por Rango']);
      histTitle.getCell('A').font = TITLE_FONT;
      const histHeader = wsBell.addRow(['Rango', 'Cantidad', 'Curva Normal']);
      styleHeader(histHeader);
      for (const b of (bellData.histogram || [])) {
        if (b.count > 0 || b.normalY > 0) {
          wsBell.addRow([b.rangeLabel || b.range, b.count, b.normalY?.toFixed(1) || '']);
        }
      }
    } else {
      wsBell.addRow(['Sin datos de curva de bell para este ciclo']);
    }
    wsBell.columns = [{ width: 25 }, { width: 15 }, { width: 15 }];

    // ── Sheet 2: Comparación por Departamento ────────────────────────
    if (analytics.departmentComparison && analytics.departmentComparison.length > 0) {
      const wsDept = wb.addWorksheet('Departamentos');
      const deptTitle = wsDept.addRow(['Comparación por Departamento']);
      deptTitle.getCell('A').font = TITLE_FONT;
      deptTitle.height = 26;
      wsDept.addRow([]);
      const deptHeader = wsDept.addRow(['Departamento', 'Puntaje Promedio', 'Evaluados']);
      styleHeader(deptHeader);
      for (const d of analytics.departmentComparison) {
        wsDept.addRow([d.department || 'Sin depto.', Number(d.avgScore), d.count]);
      }
      wsDept.columns = [{ width: 30 }, { width: 20 }, { width: 15 }];
    }

    // ── Sheet 3: Mapa de Competencias ────────────────────────────────
    if (heatmapData && heatmapData.grid && heatmapData.grid.length > 0 && heatmapData.departments && (heatmapData.departments as string[]).length > 0) {
      const wsComp = wb.addWorksheet('Mapa Competencias');
      const compTitle = wsComp.addRow(['Mapa de Competencias por Departamento (Escala 1-10)']);
      compTitle.getCell('A').font = TITLE_FONT;
      compTitle.height = 26;
      wsComp.addRow([]);

      const depts = heatmapData.departments as string[];
      const compHeader = wsComp.addRow(['Sección / Competencia', ...depts, 'Promedio Org.']);
      styleHeader(compHeader);

      for (const row of heatmapData.grid as any[]) {
        const vals = depts.map((dept) => {
          const cell = (row.values as any[]).find((v: any) => v.department === dept);
          if (!cell || cell.privacyRestricted) return 'N/D';
          return cell.avg !== null ? Number(cell.avg).toFixed(1) : '—';
        });
        const nonNull = (row.values as any[])
          .filter((v: any) => v.avg !== null && !v.privacyRestricted)
          .map((v: any) => v.avg as number);
        const orgAvg = nonNull.length > 0 ? (nonNull.reduce((a: number, b: number) => a + b, 0) / nonNull.length).toFixed(1) : '—';
        wsComp.addRow([row.section, ...vals, orgAvg]);
      }
      wsComp.columns = [{ width: 30 }, ...depts.map(() => ({ width: 16 })), { width: 16 }];
    }

    // ── Sheet 4: Rendimiento por Equipo ──────────────────────────────
    if (analytics.teamBenchmarks && analytics.teamBenchmarks.length > 0) {
      const wsTeam = wb.addWorksheet('Rendimiento Equipo');
      const teamTitle = wsTeam.addRow(['Rendimiento por Equipo']);
      teamTitle.getCell('A').font = TITLE_FONT;
      teamTitle.height = 26;
      wsTeam.addRow([]);
      const teamHeader = wsTeam.addRow(['Encargado de Equipo', 'Departamento', 'Puntaje Promedio', 'Tamaño Equipo']);
      styleHeader(teamHeader);
      const sorted = [...analytics.teamBenchmarks].sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore));
      for (const tb of sorted) {
        wsTeam.addRow([tb.managerName || tb.managerId, tb.department || '—', Number(tb.avgScore), tb.teamSize]);
      }
      wsTeam.columns = [{ width: 30 }, { width: 25 }, { width: 20 }, { width: 18 }];
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  async exportAnalyticsCyclePdf(cycleId: string, tenantId: string, managerId?: string): Promise<Buffer> {
    const analytics = await this.getAnalytics(tenantId, cycleId, managerId);
    const mgrFilter = managerId ? { managerId } : undefined;
    const bellData = await this.bellCurve(cycleId, tenantId, mgrFilter);
    const heatmapData = await this.competencyHeatmap(cycleId, tenantId, mgrFilter);
    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    const accent = [99, 102, 241];
    const pageWidth = doc.internal.pageSize.getWidth();

    // ─── Header ───
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.rect(0, 0, pageWidth, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Análisis de Ciclo', 14, 13);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(cycle?.name || cycleId, 14, 20);
    doc.text(`Generado: ${new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' })}`, 14, 25);

    let y = 36;
    doc.setTextColor(30, 30, 60);

    // ─── Bell Curve Stats ───
    if (bellData && !bellData.privacyRestricted && bellData.count > 0) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Distribución de Puntajes (Curva de Bell)', 14, y);
      y += 6;

      const bellKpis = [
        { label: 'Media', value: bellData.mean?.toFixed(2) || '0' },
        { label: 'Desv. Estándar', value: bellData.stddev?.toFixed(2) || '0' },
        { label: 'Total', value: String(bellData.count) },
      ];
      const kpiW = (pageWidth - 28 - 20) / 3;
      bellKpis.forEach((kpi, i) => {
        const x = 14 + i * (kpiW + 10);
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(x, y, kpiW, 16, 2, 2, 'FD');
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(accent[0], accent[1], accent[2]);
        doc.text(kpi.value, x + kpiW / 2, y + 7, { align: 'center' });
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text(kpi.label, x + kpiW / 2, y + 13, { align: 'center' });
      });
      y += 24;

      // Histogram table
      const histBuckets = (bellData.histogram || []).filter((b: any) => b.count > 0);
      if (histBuckets.length > 0) {
        doc.setTextColor(51, 65, 85);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Distribución por rango', 14, y);
        y += 2;
        autoTable(doc, {
          startY: y,
          head: [['Rango', 'Cantidad']],
          body: histBuckets.map((b: any) => [b.rangeLabel || b.range, String(b.count)]),
          margin: { left: 14, right: 14 },
          headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontStyle: 'bold', fontSize: 8 },
          bodyStyles: { fontSize: 8, textColor: [30, 30, 60] },
          alternateRowStyles: { fillColor: [250, 250, 250] },
          styles: { cellPadding: 2.5, lineColor: [226, 232, 240], lineWidth: 0.25 },
        });
        y = (doc as any).lastAutoTable.finalY + 8;
      }
    }

    // ─── Department Comparison ───
    if (analytics.departmentComparison && analytics.departmentComparison.length > 0) {
      if (y > 220) { doc.addPage(); y = 20; }
      doc.setTextColor(51, 65, 85);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Comparación por Departamento', 14, y);
      y += 2;
      autoTable(doc, {
        startY: y,
        head: [['Departamento', 'Promedio', 'Evaluados']],
        body: analytics.departmentComparison.map((d: any) => [d.department || 'Sin depto.', d.avgScore, String(d.count)]),
        margin: { left: 14, right: 14 },
        headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 30, 60] },
        alternateRowStyles: { fillColor: [250, 250, 250] },
        styles: { cellPadding: 2.5, lineColor: [226, 232, 240], lineWidth: 0.25 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }

    // ─── Competency Heatmap ───
    if (heatmapData && heatmapData.grid && heatmapData.grid.length > 0 && heatmapData.departments && (heatmapData.departments as string[]).length > 0) {
      if (y > 180) { doc.addPage(); y = 20; }
      doc.setTextColor(51, 65, 85);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Mapa de Competencias por Departamento (Escala 1-10)', 14, y);
      y += 2;

      const depts = heatmapData.departments as string[];
      const headRow = ['Competencia', ...depts.map((d: string) => d.length > 12 ? d.slice(0, 11) + '…' : d), 'Org.'];
      const bodyRows = (heatmapData.grid as any[]).map((row: any) => {
        const vals = depts.map((dept) => {
          const cell = (row.values as any[]).find((v: any) => v.department === dept);
          if (!cell || cell.privacyRestricted) return 'N/D';
          return cell.avg !== null ? Number(cell.avg).toFixed(1) : '—';
        });
        const nonNull = (row.values as any[]).filter((v: any) => v.avg !== null && !v.privacyRestricted).map((v: any) => v.avg as number);
        const orgAvg = nonNull.length > 0 ? (nonNull.reduce((a: number, b: number) => a + b, 0) / nonNull.length).toFixed(1) : '—';
        return [row.section.length > 20 ? row.section.slice(0, 19) + '…' : row.section, ...vals, orgAvg];
      });

      autoTable(doc, {
        startY: y,
        head: [headRow],
        body: bodyRows,
        margin: { left: 14, right: 14 },
        headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7, textColor: [30, 30, 60] },
        alternateRowStyles: { fillColor: [250, 250, 250] },
        styles: { cellPadding: 2, lineColor: [226, 232, 240], lineWidth: 0.25 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }

    // ─── Team Benchmarks ───
    if (analytics.teamBenchmarks && analytics.teamBenchmarks.length > 0) {
      if (y > 200) { doc.addPage(); y = 20; }
      doc.setTextColor(51, 65, 85);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Rendimiento por Equipo', 14, y);
      y += 2;
      const sorted = [...analytics.teamBenchmarks].sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore));
      autoTable(doc, {
        startY: y,
        head: [['Encargado', 'Departamento', 'Promedio', 'Tamaño Equipo']],
        body: sorted.map((tb: any) => [tb.managerName || tb.managerId, tb.department || '—', tb.avgScore, String(tb.teamSize)]),
        margin: { left: 14, right: 14 },
        headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 30, 60] },
        alternateRowStyles: { fillColor: [250, 250, 250] },
        styles: { cellPadding: 2.5, lineColor: [226, 232, 240], lineWidth: 0.25 },
        columnStyles: { 2: { halign: 'center' }, 3: { halign: 'center' } },
      });
    }

    // ─── Footer ───
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      const footerY = doc.internal.pageSize.getHeight() - 8;
      doc.text(`Generado por Eva360 — ${new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' })}`, 14, footerY);
      doc.text(`Página ${p} de ${pageCount}`, pageWidth - 14, footerY, { align: 'right' });
    }

    return Buffer.from(doc.output('arraybuffer'));
  }

  async exportAnalyticsCyclePptx(cycleId: string, tenantId: string, managerId?: string): Promise<Buffer> {
    const PptxGenJS = (await import('pptxgenjs')).default;

    const analytics = await this.getAnalytics(tenantId, cycleId, managerId);
    const mgrFilter = managerId ? { managerId } : undefined;
    const bellData = await this.bellCurve(cycleId, tenantId, mgrFilter);
    const heatmapData = await this.competencyHeatmap(cycleId, tenantId, mgrFilter);
    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });

    const pptx = new PptxGenJS();
    pptx.author = 'Eva360';
    pptx.title = `Análisis de Ciclo - ${cycle?.name || cycleId}`;
    pptx.subject = 'Análisis de Ciclo de Evaluación';

    const GOLD = 'C9933A';
    const GOLD_LIGHT = 'E8C97A';
    const DARK = '1a1206';
    const GRAY = '5a4a2e';
    const LIGHT_BG = 'F5F5F0';

    // ─── Slide 1: Title ─────────────────────────────────────────
    const slide1 = pptx.addSlide();
    slide1.background = { color: DARK };
    slide1.addText('Eva360', {
      x: 0.8, y: 1.0, w: 8.4, h: 0.6,
      fontSize: 14, color: GOLD_LIGHT, fontFace: 'Arial',
    });
    slide1.addText(`Análisis de Ciclo`, {
      x: 0.8, y: 1.8, w: 8.4, h: 0.7,
      fontSize: 28, bold: true, color: 'FFFFFF', fontFace: 'Arial',
    });
    slide1.addText(cycle?.name || cycleId, {
      x: 0.8, y: 2.6, w: 8.4, h: 0.5,
      fontSize: 18, color: GOLD, fontFace: 'Arial',
    });
    slide1.addText(`Generado: ${new Date().toLocaleDateString('es-CL')}`, {
      x: 0.8, y: 4.5, w: 8.4, h: 0.3,
      fontSize: 10, color: '888888', fontFace: 'Arial',
    });

    // ─── Slide 2: Bell Curve Stats ──────────────────────────────
    if (bellData && !bellData.privacyRestricted && bellData.count > 0) {
      const slide2 = pptx.addSlide();
      slide2.background = { color: LIGHT_BG };
      slide2.addText('Distribución de Puntajes (Curva de Bell)', {
        x: 0.5, y: 0.3, w: 9, h: 0.5,
        fontSize: 22, bold: true, color: DARK, fontFace: 'Arial',
      });

      const bellKpis = [
        { label: 'Media', value: bellData.mean?.toFixed(2) || '0' },
        { label: 'Desv. Estándar', value: bellData.stddev?.toFixed(2) || '0' },
        { label: 'Total respuestas', value: String(bellData.count) },
      ];
      bellKpis.forEach((kpi, i) => {
        slide2.addShape(pptx.ShapeType.roundRect, {
          x: 0.5 + i * 3.0, y: 1.0, w: 2.5, h: 1.2,
          fill: { color: 'FFFFFF' }, line: { color: GOLD, width: 1 },
          rectRadius: 0.1,
        });
        slide2.addText(kpi.value, {
          x: 0.5 + i * 3.0, y: 1.1, w: 2.5, h: 0.6,
          fontSize: 24, bold: true, color: GOLD, align: 'center', fontFace: 'Arial',
        });
        slide2.addText(kpi.label, {
          x: 0.5 + i * 3.0, y: 1.7, w: 2.5, h: 0.35,
          fontSize: 10, color: GRAY, align: 'center', fontFace: 'Arial',
        });
      });

      // Histogram
      const histBuckets = (bellData.histogram || []).filter((b: any) => b.count > 0);
      if (histBuckets.length > 0) {
        slide2.addText('Distribución por rango', {
          x: 0.5, y: 2.6, w: 9, h: 0.4,
          fontSize: 12, bold: true, color: DARK, fontFace: 'Arial',
        });
        const histRows: any[][] = [[
          { text: 'Rango', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
          { text: 'Cantidad', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
        ]];
        for (const b of histBuckets.slice(0, 15)) {
          histRows.push([b.rangeLabel || b.range, String(b.count)]);
        }
        slide2.addTable(histRows, {
          x: 0.5, y: 3.1, w: 6,
          fontSize: 9, fontFace: 'Arial',
          border: { color: 'DDDDDD', pt: 0.5 },
          colW: [3, 3],
        });
      }
    }

    // ─── Slide 3: Department Comparison ─────────────────────────
    if (analytics.departmentComparison && analytics.departmentComparison.length > 0) {
      const slide3 = pptx.addSlide();
      slide3.background = { color: LIGHT_BG };
      slide3.addText('Comparación por Departamento', {
        x: 0.5, y: 0.3, w: 9, h: 0.5,
        fontSize: 22, bold: true, color: DARK, fontFace: 'Arial',
      });
      const deptRows: any[][] = [[
        { text: 'Departamento', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
        { text: 'Puntaje Promedio', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
        { text: 'Evaluados', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
      ]];
      for (const d of analytics.departmentComparison) {
        deptRows.push([d.department || 'Sin depto.', d.avgScore, String(d.count)]);
      }
      slide3.addTable(deptRows, {
        x: 0.5, y: 1.0, w: 9,
        fontSize: 11, fontFace: 'Arial',
        border: { color: 'DDDDDD', pt: 0.5 },
        colW: [4, 2.5, 2.5],
      });
    }

    // ─── Slide 4: Competency Heatmap ────────────────────────────
    if (heatmapData && heatmapData.grid && heatmapData.grid.length > 0 && heatmapData.departments && (heatmapData.departments as string[]).length > 0) {
      const slide4 = pptx.addSlide();
      slide4.background = { color: LIGHT_BG };
      slide4.addText('Mapa de Competencias por Departamento (Escala 1-10)', {
        x: 0.5, y: 0.3, w: 9, h: 0.5,
        fontSize: 20, bold: true, color: DARK, fontFace: 'Arial',
      });

      const depts = heatmapData.departments as string[];
      const colCount = depts.length + 2; // section + depts + org avg
      const colW = [2.5, ...depts.map(() => Math.min(1.5, 6.5 / depts.length)), 1.2];

      const heatHead: any[] = [
        { text: 'Competencia', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
        ...depts.map((d) => ({ text: d.length > 10 ? d.slice(0, 9) + '…' : d, options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } })),
        { text: 'Org.', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
      ];
      const heatRows: any[][] = [heatHead];
      for (const row of heatmapData.grid as any[]) {
        const vals = depts.map((dept) => {
          const cell = (row.values as any[]).find((v: any) => v.department === dept);
          if (!cell || cell.privacyRestricted) return 'N/D';
          return cell.avg !== null ? Number(cell.avg).toFixed(1) : '—';
        });
        const nonNull = (row.values as any[]).filter((v: any) => v.avg !== null && !v.privacyRestricted).map((v: any) => v.avg as number);
        const orgAvg = nonNull.length > 0 ? (nonNull.reduce((a: number, b: number) => a + b, 0) / nonNull.length).toFixed(1) : '—';
        heatRows.push([row.section.length > 18 ? row.section.slice(0, 17) + '…' : row.section, ...vals, orgAvg]);
      }
      slide4.addTable(heatRows, {
        x: 0.3, y: 1.0, w: 9.4,
        fontSize: 8, fontFace: 'Arial',
        border: { color: 'DDDDDD', pt: 0.5 },
        colW,
      });
    }

    // ─── Slide 5: Team Benchmarks ───────────────────────────────
    if (analytics.teamBenchmarks && analytics.teamBenchmarks.length > 0) {
      const slide5 = pptx.addSlide();
      slide5.background = { color: LIGHT_BG };
      slide5.addText('Rendimiento por Equipo', {
        x: 0.5, y: 0.3, w: 9, h: 0.5,
        fontSize: 22, bold: true, color: DARK, fontFace: 'Arial',
      });

      const teamRows: any[][] = [[
        { text: 'Encargado', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
        { text: 'Departamento', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
        { text: 'Promedio', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
        { text: 'Tamaño Equipo', options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } },
      ]];
      const sorted = [...analytics.teamBenchmarks].sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore));
      for (const tb of sorted) {
        teamRows.push([tb.managerName || tb.managerId, tb.department || '—', tb.avgScore, String(tb.teamSize)]);
      }
      slide5.addTable(teamRows, {
        x: 0.5, y: 1.0, w: 9,
        fontSize: 10, fontFace: 'Arial',
        border: { color: 'DDDDDD', pt: 0.5 },
        colW: [3, 2.5, 1.75, 1.75],
      });
    }

    // ─── Slide 6: Closing ───────────────────────────────────────
    const slideEnd = pptx.addSlide();
    slideEnd.background = { color: DARK };
    slideEnd.addText('Eva360', {
      x: 0.5, y: 2.0, w: 9, h: 0.8,
      fontSize: 28, bold: true, color: GOLD_LIGHT, align: 'center', fontFace: 'Arial',
    });
    slideEnd.addText('Análisis de Ciclo — Reporte generado automáticamente', {
      x: 0.5, y: 3.0, w: 9, h: 0.4,
      fontSize: 12, color: '888888', align: 'center', fontFace: 'Arial',
    });
    slideEnd.addText(`${new Date().toLocaleDateString('es-CL')} — Confidencial`, {
      x: 0.5, y: 3.5, w: 9, h: 0.3,
      fontSize: 10, color: '666666', align: 'center', fontFace: 'Arial',
    });

    const arrayBuffer = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer;
    return Buffer.from(arrayBuffer);
  }
}
