import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async exportPdfHtml(cycleId: string, tenantId: string): Promise<string> {
    const summary = await this.cycleSummary(cycleId, tenantId);
    const assignments = await this.assignmentRepo.find({
      where: { cycleId, tenantId, status: AssignmentStatus.COMPLETED },
      relations: ['evaluatee', 'evaluator'],
    });

    const tableRows = [];
    for (const a of assignments) {
      const resp = await this.responseRepo.findOne({ where: { assignmentId: a.id } });
      tableRows.push(`
        <tr>
          <td>${a.evaluatee.firstName} ${a.evaluatee.lastName}</td>
          <td>${a.evaluator.firstName} ${a.evaluator.lastName}</td>
          <td>${a.relationType}</td>
          <td>${resp?.overallScore ?? '–'}</td>
          <td>${resp?.submittedAt ? new Date(resp.submittedAt).toLocaleDateString('es-ES') : '–'}</td>
        </tr>`);
    }

    const deptRows = (summary.departmentBreakdown || []).map((d: any) =>
      `<tr><td>${d.department}</td><td>${d.avgScore}</td><td>${d.count}</td></tr>`
    ).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Reporte - ${summary.cycle.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 2rem; color: #1a1a2e; max-width: 900px; margin: 0 auto; }
    h1 { color: #6366f1; margin-bottom: 0.25rem; }
    h2 { color: #334155; margin-top: 2rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; }
    .subtitle { color: #64748b; margin-bottom: 2rem; }
    .kpis { display: flex; gap: 1.5rem; margin-bottom: 2rem; flex-wrap: wrap; }
    .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem 1.5rem; min-width: 150px; }
    .kpi-value { font-size: 1.5rem; font-weight: 800; color: #6366f1; }
    .kpi-label { font-size: 0.8rem; color: #64748b; margin-top: 0.25rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.85rem; }
    th { background: #f1f5f9; text-align: left; padding: 0.6rem 0.8rem; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0; }
    td { padding: 0.5rem 0.8rem; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) { background: #fafafa; }
    .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; font-size: 0.75rem; color: #94a3b8; text-align: center; }
    @media print { body { padding: 0; } .no-print { display: none; } }
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()" style="background:#6366f1;color:white;border:none;padding:0.5rem 1.5rem;border-radius:6px;cursor:pointer;font-weight:600;margin-bottom:1rem;">Imprimir / Guardar PDF</button>
  <h1>Reporte de Evaluación</h1>
  <p class="subtitle">${summary.cycle.name} — ${new Date(summary.cycle.startDate).toLocaleDateString('es-ES')} al ${new Date(summary.cycle.endDate).toLocaleDateString('es-ES')}</p>

  <div class="kpis">
    <div class="kpi"><div class="kpi-value">${summary.averageScore || '–'}</div><div class="kpi-label">Promedio Global</div></div>
    <div class="kpi"><div class="kpi-value">${summary.completedAssignments}/${summary.totalAssignments}</div><div class="kpi-label">Completadas</div></div>
    <div class="kpi"><div class="kpi-value">${summary.completionRate}%</div><div class="kpi-label">Tasa de Completado</div></div>
  </div>

  ${deptRows ? `
  <h2>Promedio por Departamento</h2>
  <table>
    <thead><tr><th>Departamento</th><th>Promedio</th><th>Personas</th></tr></thead>
    <tbody>${deptRows}</tbody>
  </table>` : ''}

  <h2>Detalle de Evaluaciones</h2>
  <table>
    <thead><tr><th>Evaluado</th><th>Evaluador</th><th>Relación</th><th>Puntaje</th><th>Fecha</th></tr></thead>
    <tbody>${tableRows.join('')}</tbody>
  </table>

  <div class="footer">Generado por EvaPro — ${new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
</body>
</html>`;
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
