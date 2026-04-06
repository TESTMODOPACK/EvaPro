import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan, In, IsNull, Not } from 'typeorm';
import { DevelopmentPlan } from '../development/entities/development-plan.entity';
import { DevelopmentAction } from '../development/entities/development-action.entity';
import { User } from '../users/entities/user.entity';
import { UserDeparture } from '../users/entities/user-departure.entity';
import { UserMovement } from '../users/entities/user-movement.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { EvaluationCycle, CycleStatus } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(DevelopmentPlan)
    private readonly planRepo: Repository<DevelopmentPlan>,
    @InjectRepository(DevelopmentAction)
    private readonly actionRepo: Repository<DevelopmentAction>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(UserDeparture)
    private readonly departureRepo: Repository<UserDeparture>,
    @InjectRepository(UserMovement)
    private readonly movementRepo: Repository<UserMovement>,
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
    @InjectRepository(EvaluationResponse)
    private readonly responseRepo: Repository<EvaluationResponse>,
    @InjectRepository(EvaluationAssignment)
    private readonly assignmentRepo: Repository<EvaluationAssignment>,
  ) {}

  // ─── 1. Cumplimiento PDI ────────────────────────────────────────────

  async getPdiCompliance(tenantId: string, managerId?: string): Promise<any> {
    const where: any = { tenantId };
    const plans = await this.planRepo.find({ where, relations: ['user', 'actions'] });

    // If manager, filter to direct reports
    let filtered = plans;
    if (managerId) {
      const directReports = await this.userRepo.find({ where: { tenantId, managerId }, select: ['id'] });
      const ids = new Set(directReports.map(u => u.id));
      ids.add(managerId);
      filtered = plans.filter(p => ids.has(p.userId));
    }

    const total = filtered.length;
    const byStatus: Record<string, number> = {};
    let totalActions = 0;
    let completedActions = 0;
    let overdueActions = 0;
    const byDepartment: Record<string, { total: number; completed: number; avgProgress: number; plans: any[] }> = {};
    const now = new Date();

    for (const plan of filtered) {
      byStatus[plan.status] = (byStatus[plan.status] || 0) + 1;
      const actions = plan.actions || [];
      for (const a of actions) {
        totalActions++;
        if (a.status === 'completada' || a.status === 'completed') completedActions++;
        if (a.dueDate && new Date(a.dueDate) < now && a.status !== 'completada' && a.status !== 'completed') overdueActions++;
      }

      const dept = (plan.user as any)?.department || 'Sin departamento';
      if (!byDepartment[dept]) byDepartment[dept] = { total: 0, completed: 0, avgProgress: 0, plans: [] };
      byDepartment[dept].total++;
      if (plan.status === 'completado') byDepartment[dept].completed++;
      const progress = actions.length > 0 ? Math.round(actions.filter((a: any) => a.status === 'completada' || a.status === 'completed').length / actions.length * 100) : 0;
      byDepartment[dept].avgProgress += progress;
      const rawName = (plan.user as any) ? `${(plan.user as any).firstName || ''} ${(plan.user as any).lastName || ''}`.trim() : '';
      const userName = rawName || 'N/A';
      byDepartment[dept].plans.push({
        userName,
        planTitle: plan.title || 'Sin título',
        status: plan.status,
        progress,
      });
    }

    // Finalize department averages
    for (const dept of Object.keys(byDepartment)) {
      if (byDepartment[dept].total > 0) {
        byDepartment[dept].avgProgress = Math.round(byDepartment[dept].avgProgress / byDepartment[dept].total);
      }
    }

    const completionRate = total > 0 ? Math.round(((byStatus['completado'] || 0) / total) * 100) : 0;
    const actionCompletionRate = totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : 0;

    return {
      totalPlans: total,
      byStatus,
      completionRate,
      totalActions,
      completedActions,
      overdueActions,
      actionCompletionRate,
      byDepartment: Object.entries(byDepartment).map(([dept, data]) => ({ department: dept, ...data })).sort((a, b) => b.avgProgress - a.avgProgress),
    };
  }

  // ─── 2. Uso del Sistema ─────────────────────────────────────────────

  async getSystemUsage(tenantId?: string): Promise<any> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const where: any = { createdAt: MoreThan(thirtyDaysAgo) };
    if (tenantId) where.tenantId = tenantId;

    // Count total users
    const userWhere: any = tenantId ? { tenantId, isActive: true } : { isActive: true };
    const totalUsers = await this.userRepo.count({ where: userWhere });

    // Active users (distinct users who logged in)
    const loginLogs = await this.auditRepo.createQueryBuilder('log')
      .where('log.action = :action', { action: 'login' })
      .andWhere('log.createdAt > :since', { since: thirtyDaysAgo })
      .andWhere(tenantId ? 'log.tenantId = :tenantId' : '1=1', { tenantId })
      .select('log.userId')
      .addSelect('log.createdAt')
      .getMany();

    const mauSet = new Set(loginLogs.map(l => l.userId));
    const wauSet = new Set(loginLogs.filter(l => new Date(l.createdAt) > sevenDaysAgo).map(l => l.userId));

    // Actions by module (entity type)
    const moduleUsage = await this.auditRepo.createQueryBuilder('log')
      .where('log.createdAt > :since', { since: thirtyDaysAgo })
      .andWhere(tenantId ? 'log.tenantId = :tenantId' : '1=1', { tenantId })
      .andWhere('log.entityType IS NOT NULL')
      .select('log.entityType', 'module')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.entityType')
      .orderBy('COUNT(*)', 'DESC')
      .limit(15)
      .getRawMany();

    // Top actions
    const topActions = await this.auditRepo.createQueryBuilder('log')
      .where('log.createdAt > :since', { since: thirtyDaysAgo })
      .andWhere(tenantId ? 'log.tenantId = :tenantId' : '1=1', { tenantId })
      .select('log.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.action')
      .orderBy('COUNT(*)', 'DESC')
      .limit(10)
      .getRawMany();

    // Daily activity (last 30 days)
    const dailyActivity = await this.auditRepo.createQueryBuilder('log')
      .where('log.createdAt > :since', { since: thirtyDaysAgo })
      .andWhere(tenantId ? 'log.tenantId = :tenantId' : '1=1', { tenantId })
      .select("TO_CHAR(log.createdAt, 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COUNT(DISTINCT log.userId)', 'users')
      .groupBy("TO_CHAR(log.createdAt, 'YYYY-MM-DD')")
      .orderBy("TO_CHAR(log.createdAt, 'YYYY-MM-DD')", 'ASC')
      .getRawMany();

    return {
      totalUsers,
      mau: mauSet.size,
      wau: wauSet.size,
      adoptionRate: totalUsers > 0 ? Math.round((mauSet.size / totalUsers) * 100) : 0,
      moduleUsage: moduleUsage.map((m: any) => ({ module: m.module, count: Number(m.count) })),
      topActions: topActions.map((a: any) => ({ action: a.action, count: Number(a.count) })),
      dailyActivity: dailyActivity.map((d: any) => ({ date: d.date, actions: Number(d.count), users: Number(d.users) })),
    };
  }

  // ─── 3. Comparativa entre Ciclos ────────────────────────────────────

  async getCycleComparison(tenantId: string, managerId?: string): Promise<any> {
    const closedCycles = await this.cycleRepo.find({
      where: { tenantId, status: CycleStatus.CLOSED },
      order: { startDate: 'ASC' },
    });

    const result: any[] = [];

    for (const cycle of closedCycles) {
      const assignments = await this.assignmentRepo.find({
        where: { cycleId: cycle.id, tenantId },
        relations: ['evaluatee'],
      });

      // Load responses for these assignments
      const assignmentIds = assignments.map(a => a.id);
      const responses = assignmentIds.length > 0
        ? await this.responseRepo.find({ where: { assignmentId: In(assignmentIds) } })
        : [];
      const responseByAssignment = new Map(responses.map(r => [r.assignmentId, r]));

      // If manager, filter to direct reports
      let filtered = assignments;
      if (managerId) {
        const directReports = await this.userRepo.find({ where: { tenantId, managerId }, select: ['id'] });
        const ids = new Set(directReports.map(u => u.id));
        ids.add(managerId);
        filtered = assignments.filter(a => ids.has(a.evaluateeId));
      }

      // Match responses with assignments
      const withScores: { assignment: any; score: number }[] = [];
      for (const a of filtered) {
        const resp = responseByAssignment.get(a.id);
        if (resp?.overallScore != null) {
          withScores.push({ assignment: a, score: Number(resp.overallScore) });
        }
      }

      const scores = withScores.map(w => w.score);
      const avg = scores.length > 0 ? Number((scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2)) : null;
      const min = scores.length > 0 ? Math.min(...scores) : null;
      const max = scores.length > 0 ? Math.max(...scores) : null;

      // Department breakdown
      const deptScores: Record<string, number[]> = {};
      for (const w of withScores) {
        const dept = (w.assignment.evaluatee as any)?.department || 'Sin departamento';
        if (!deptScores[dept]) deptScores[dept] = [];
        deptScores[dept].push(w.score);
      }

      result.push({
        cycleId: cycle.id,
        cycleName: cycle.name,
        cycleType: cycle.type,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        totalEvaluated: filtered.length,
        withScores: withScores.length,
        avgScore: avg,
        minScore: min,
        maxScore: max,
        byDepartment: Object.entries(deptScores).map(([dept, s]) => ({
          department: dept,
          avgScore: Number((s.reduce((a, b) => a + b, 0) / s.length).toFixed(2)),
          count: s.length,
        })).sort((a, b) => b.avgScore - a.avgScore),
      });
    }

    return { cycles: result };
  }

  // ─── 4. Análisis de Rotación ────────────────────────────────────────

  async getTurnoverAnalysis(tenantId: string): Promise<any> {
    const activeUsers = await this.userRepo.count({ where: { tenantId, isActive: true } });
    const inactiveUsers = await this.userRepo.count({ where: { tenantId, isActive: false } });

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    // ── Primary source: user_departures table ──
    const departures = await this.departureRepo.find({
      where: { tenantId, departureDate: MoreThan(twelveMonthsAgo) },
      relations: ['user'],
      order: { departureDate: 'DESC' },
    });

    // ── Fallback: audit logs for old deactivations without departure record ──
    const departureUserIds = new Set(departures.map(d => d.userId));
    const auditDeactivations = await this.auditRepo.find({
      where: { tenantId, action: In(['user.deactivated', 'user.deleted', 'user.departed']), createdAt: MoreThan(twelveMonthsAgo) },
    });
    const legacyCount = auditDeactivations.filter(a => a.userId && !departureUserIds.has(a.userId)).length;

    const totalDepartures = departures.length + legacyCount;

    // By month
    const byMonth: Record<string, number> = {};
    for (const d of departures) {
      const month = new Date(d.departureDate).toISOString().slice(0, 7);
      byMonth[month] = (byMonth[month] || 0) + 1;
    }

    // By department
    const byDepartment: Record<string, number> = {};
    for (const d of departures) {
      const dept = d.lastDepartment || (d.user as any)?.department || 'Sin departamento';
      byDepartment[dept] = (byDepartment[dept] || 0) + 1;
    }

    // By departure type
    const byType: Record<string, number> = {};
    for (const d of departures) {
      byType[d.departureType] = (byType[d.departureType] || 0) + 1;
    }

    // By reason category
    const byReason: Record<string, number> = {};
    for (const d of departures) {
      if (d.reasonCategory) {
        byReason[d.reasonCategory] = (byReason[d.reasonCategory] || 0) + 1;
      }
    }

    // Voluntary vs involuntary
    const voluntary = departures.filter(d => d.isVoluntary).length;
    const involuntary = departures.filter(d => !d.isVoluntary).length;

    // Would rehire stats
    const wouldRehireYes = departures.filter(d => d.wouldRehire === true).length;
    const wouldRehireNo = departures.filter(d => d.wouldRehire === false).length;

    // Tenure at departure (using actual departure date, not now)
    const tenureGroups = { '<6m': 0, '6-12m': 0, '1-2a': 0, '2-5a': 0, '>5a': 0 };
    for (const d of departures) {
      const hireDate = (d.user as any)?.hireDate;
      if (!hireDate) continue;
      const months = Math.floor((new Date(d.departureDate).getTime() - new Date(hireDate).getTime()) / (1000 * 60 * 60 * 24 * 30));
      if (months < 6) tenureGroups['<6m']++;
      else if (months < 12) tenureGroups['6-12m']++;
      else if (months < 24) tenureGroups['1-2a']++;
      else if (months < 60) tenureGroups['2-5a']++;
      else tenureGroups['>5a']++;
    }

    const totalAtStart = activeUsers + totalDepartures;
    const turnoverRate = totalAtStart > 0 ? Math.round((totalDepartures / totalAtStart) * 100) : 0;

    return {
      activeUsers,
      inactiveUsers,
      totalDeactivations12m: totalDepartures,
      turnoverRate,
      voluntary,
      involuntary,
      wouldRehire: { yes: wouldRehireYes, no: wouldRehireNo, noAnswer: departures.length - wouldRehireYes - wouldRehireNo },
      byMonth: Object.entries(byMonth).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
      byDepartment: Object.entries(byDepartment).map(([dept, count]) => ({ department: dept, count })).sort((a, b) => b.count - a.count),
      byType: Object.entries(byType).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      byReason: Object.entries(byReason).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      byTenure: Object.entries(tenureGroups).map(([range, count]) => ({ range, count })),
    };
  }

  // ─── 4b. Análisis de Movimientos Internos ──────────────────────────

  async getInternalMovementAnalysis(tenantId: string): Promise<any> {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const movements = await this.movementRepo.find({
      where: { tenantId, effectiveDate: MoreThan(twelveMonthsAgo) },
      relations: ['user'],
      order: { effectiveDate: 'DESC' },
    });

    // By type
    const byType: Record<string, number> = {};
    for (const m of movements) {
      byType[m.movementType] = (byType[m.movementType] || 0) + 1;
    }

    // By month
    const byMonth: Record<string, number> = {};
    for (const m of movements) {
      const month = new Date(m.effectiveDate).toISOString().slice(0, 7);
      byMonth[month] = (byMonth[month] || 0) + 1;
    }

    // Department flow (from → to)
    const flows: Record<string, number> = {};
    for (const m of movements) {
      if (m.fromDepartment && m.toDepartment && m.fromDepartment !== m.toDepartment) {
        const key = `${m.fromDepartment} → ${m.toDepartment}`;
        flows[key] = (flows[key] || 0) + 1;
      }
    }

    // Recent movements (last 10)
    const recent = movements.slice(0, 10).map(m => ({
      userName: m.user ? `${(m.user as any).firstName || ''} ${(m.user as any).lastName || ''}`.trim() || 'N/A' : 'N/A',
      movementType: m.movementType,
      effectiveDate: m.effectiveDate,
      fromDepartment: m.fromDepartment,
      toDepartment: m.toDepartment,
      fromPosition: m.fromPosition,
      toPosition: m.toPosition,
      reason: m.reason,
    }));

    return {
      totalMovements: movements.length,
      promotions: movements.filter(m => m.movementType === 'promotion').length,
      lateralTransfers: movements.filter(m => m.movementType === 'lateral_transfer' || m.movementType === 'department_change').length,
      positionChanges: movements.filter(m => m.movementType === 'position_change').length,
      demotions: movements.filter(m => m.movementType === 'demotion').length,
      byType: Object.entries(byType).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      byMonth: Object.entries(byMonth).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
      departmentFlows: Object.entries(flows).map(([flow, count]) => ({ flow, count })).sort((a, b) => b.count - a.count),
      recent,
    };
  }

  // ─── PDI Compliance Export ─────────────────────────────────────────────

  exportPdiComplianceCsv(data: any): string {
    const esc = (v: string) => `"${String(v || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    const lines: string[] = [];
    lines.push('Cumplimiento de Desarrollo (PDI) — Resumen');
    lines.push(`Total Planes,${data.totalPlans}`);
    lines.push(`Tasa Completitud,${data.completionRate}%`);
    lines.push(`Acciones Completadas,${data.completedActions}/${data.totalActions} (${data.actionCompletionRate}%)`);
    lines.push(`Acciones Vencidas,${data.overdueActions}`);
    lines.push('');
    if (data.byStatus) {
      lines.push('Distribución por Estado');
      lines.push('Estado,Cantidad');
      for (const [status, count] of Object.entries(data.byStatus)) lines.push(`${esc(status)},${count}`);
      lines.push('');
    }
    if (data.byDepartment?.length) {
      lines.push('Por Departamento');
      lines.push('Departamento,Total,Completados,Progreso Promedio');
      for (const d of data.byDepartment) lines.push(`${esc(d.department)},${d.total},${d.completed},${d.avgProgress}%`);
    }
    return '\uFEFF' + lines.join('\n');
  }

  async exportPdiComplianceXlsx(data: any): Promise<Buffer> {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws1 = wb.addWorksheet('Resumen PDI');
    ws1.columns = [{ width: 25 }, { width: 15 }];
    ws1.addRow(['Cumplimiento de Desarrollo (PDI)']).font = { bold: true, size: 14 };
    ws1.addRow([]);
    ws1.addRow(['Total Planes', data.totalPlans]);
    ws1.addRow(['Tasa Completitud', `${data.completionRate}%`]);
    ws1.addRow(['Acciones Completadas', `${data.completedActions}/${data.totalActions}`]);
    ws1.addRow(['Acciones Vencidas', data.overdueActions]);
    if (data.byDepartment?.length) {
      const ws2 = wb.addWorksheet('Por Departamento');
      ws2.columns = [{ header: 'Departamento', width: 25 }, { header: 'Total', width: 10 }, { header: 'Completados', width: 12 }, { header: 'Progreso %', width: 12 }];
      for (const d of data.byDepartment) ws2.addRow([d.department, d.total, d.completed, d.avgProgress]);
    }
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // ─── System Usage Export ──────────────────────────────────────────────

  exportSystemUsageCsv(data: any): string {
    const esc = (v: string) => `"${String(v || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    const lines: string[] = [];
    lines.push('Adopción y Uso del Sistema — Resumen');
    lines.push(`Usuarios Totales,${data.totalUsers}`);
    lines.push(`Activos Mes (MAU),${data.mau}`);
    lines.push(`Activos Semana (WAU),${data.wau}`);
    lines.push(`Tasa Adopción,${data.adoptionRate}%`);
    lines.push('');
    if (data.moduleUsage?.length) {
      lines.push('Uso por Módulo');
      lines.push('Módulo,Acciones');
      for (const m of data.moduleUsage) lines.push(`${esc(m.module)},${m.count}`);
      lines.push('');
    }
    if (data.topActions?.length) {
      lines.push('Acciones Más Frecuentes');
      lines.push('Acción,Cantidad');
      for (const a of data.topActions) lines.push(`${esc(a.action)},${a.count}`);
      lines.push('');
    }
    if (data.dailyActivity?.length) {
      lines.push('Actividad Diaria');
      lines.push('Fecha,Acciones,Usuarios');
      for (const d of data.dailyActivity) lines.push(`${d.date},${d.actions},${d.users}`);
    }
    return '\uFEFF' + lines.join('\n');
  }

  async exportSystemUsageXlsx(data: any): Promise<Buffer> {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 25 }, { width: 15 }];
    ws1.addRow(['Adopción y Uso del Sistema']).font = { bold: true, size: 14 };
    ws1.addRow([]);
    ws1.addRow(['Usuarios Totales', data.totalUsers]);
    ws1.addRow(['Activos Mes (MAU)', data.mau]);
    ws1.addRow(['Activos Semana (WAU)', data.wau]);
    ws1.addRow(['Tasa Adopción', `${data.adoptionRate}%`]);
    if (data.moduleUsage?.length) {
      const ws2 = wb.addWorksheet('Uso por Módulo');
      ws2.columns = [{ header: 'Módulo', width: 25 }, { header: 'Acciones', width: 12 }];
      for (const m of data.moduleUsage) ws2.addRow([m.module, m.count]);
    }
    if (data.dailyActivity?.length) {
      const ws3 = wb.addWorksheet('Actividad Diaria');
      ws3.columns = [{ header: 'Fecha', width: 12 }, { header: 'Acciones', width: 10 }, { header: 'Usuarios', width: 10 }];
      for (const d of data.dailyActivity) ws3.addRow([d.date, d.actions, d.users]);
    }
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // ─── Cycle Comparison Export ────────────────────────────────────────────

  exportCycleComparisonCsv(data: any): string {
    const esc = (v: string) => `"${String(v || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    const lines: string[] = [];

    lines.push('Comparativa de Ciclos de Evaluación');
    lines.push('');
    lines.push('Ciclo,Tipo,Fecha Inicio,Fecha Fin,Evaluados,Con Puntaje,Promedio,Mínimo,Máximo');
    for (const c of data.cycles || []) {
      lines.push([
        esc(c.cycleName), esc(c.cycleType),
        c.startDate ? new Date(c.startDate).toLocaleDateString('es-CL') : '',
        c.endDate ? new Date(c.endDate).toLocaleDateString('es-CL') : '',
        c.totalEvaluated, c.withScores,
        c.avgScore ?? '', c.minScore ?? '', c.maxScore ?? '',
      ].join(','));
    }
    lines.push('');

    // Department breakdown per cycle
    for (const c of data.cycles || []) {
      if (c.byDepartment?.length) {
        lines.push(`Desglose por Departamento — ${c.cycleName}`);
        lines.push('Departamento,Promedio,Evaluados');
        for (const d of c.byDepartment) {
          lines.push(`${esc(d.department)},${d.avgScore},${d.count}`);
        }
        lines.push('');
      }
    }

    return '\uFEFF' + lines.join('\n');
  }

  async exportCycleComparisonXlsx(data: any): Promise<Buffer> {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();

    // Sheet 1: Resumen
    const ws1 = wb.addWorksheet('Comparativa');
    ws1.columns = [
      { header: 'Ciclo', width: 25 }, { header: 'Tipo', width: 12 },
      { header: 'Inicio', width: 12 }, { header: 'Fin', width: 12 },
      { header: 'Evaluados', width: 12 }, { header: 'Con Puntaje', width: 12 },
      { header: 'Promedio', width: 10 }, { header: 'Mín', width: 8 }, { header: 'Máx', width: 8 },
    ];
    for (const c of data.cycles || []) {
      ws1.addRow([
        c.cycleName, c.cycleType,
        c.startDate ? new Date(c.startDate).toLocaleDateString('es-CL') : '',
        c.endDate ? new Date(c.endDate).toLocaleDateString('es-CL') : '',
        c.totalEvaluated, c.withScores,
        c.avgScore, c.minScore, c.maxScore,
      ]);
    }

    // Sheet 2: Department breakdown
    const ws2 = wb.addWorksheet('Por Departamento');
    ws2.columns = [
      { header: 'Ciclo', width: 25 }, { header: 'Departamento', width: 25 },
      { header: 'Promedio', width: 10 }, { header: 'Evaluados', width: 10 },
    ];
    for (const c of data.cycles || []) {
      for (const d of c.byDepartment || []) {
        ws2.addRow([c.cycleName, d.department, d.avgScore, d.count]);
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // ─── Turnover CSV Export ───────────────────────────────────────────────
  exportTurnoverCsv(data: any): string {
    const esc = (v: string) => `"${String(v || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    const lines: string[] = [];

    lines.push('Análisis de Rotación — Resumen');
    lines.push(`Usuarios activos,${data.activeUsers}`);
    lines.push(`Usuarios inactivos,${data.inactiveUsers}`);
    lines.push(`Bajas últimos 12 meses,${data.totalDeactivations12m}`);
    lines.push(`Tasa de rotación,${data.turnoverRate}%`);
    lines.push('');

    if (data.byMonth?.length) {
      lines.push('Bajas por Mes');
      lines.push('Mes,Bajas');
      for (const m of data.byMonth) lines.push(`${m.month},${m.count}`);
      lines.push('');
    }

    if (data.byDepartment?.length) {
      lines.push('Bajas por Departamento');
      lines.push('Departamento,Bajas');
      for (const d of data.byDepartment) lines.push(`${esc(d.department)},${d.count}`);
      lines.push('');
    }

    if (data.byTenure?.length) {
      lines.push('Antigüedad al Salir');
      lines.push('Rango,Cantidad');
      for (const t of data.byTenure) lines.push(`${esc(t.range)},${t.count}`);
    }

    return '\uFEFF' + lines.join('\n');
  }

  // ─── Turnover XLSX Export ──────────────────────────────────────────────
  async exportTurnoverXlsx(data: any): Promise<Buffer> {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();

    // Sheet 1: Resumen
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 30 }, { width: 15 }];
    ws1.addRow(['Análisis de Rotación']).font = { bold: true, size: 14 };
    ws1.addRow([]);
    ws1.addRow(['Usuarios activos', data.activeUsers]);
    ws1.addRow(['Usuarios inactivos', data.inactiveUsers]);
    ws1.addRow(['Bajas últimos 12 meses', data.totalDeactivations12m]);
    ws1.addRow(['Tasa de rotación', `${data.turnoverRate}%`]);

    // Sheet 2: Bajas por Mes
    if (data.byMonth?.length) {
      const ws2 = wb.addWorksheet('Bajas por Mes');
      ws2.columns = [{ header: 'Mes', width: 15 }, { header: 'Bajas', width: 10 }];
      for (const m of data.byMonth) ws2.addRow([m.month, m.count]);
    }

    // Sheet 3: Bajas por Departamento
    if (data.byDepartment?.length) {
      const ws3 = wb.addWorksheet('Bajas por Departamento');
      ws3.columns = [{ header: 'Departamento', width: 25 }, { header: 'Bajas', width: 10 }];
      for (const d of data.byDepartment) ws3.addRow([d.department, d.count]);
    }

    // Sheet 4: Antigüedad
    if (data.byTenure?.length) {
      const ws4 = wb.addWorksheet('Antigüedad al Salir');
      ws4.columns = [{ header: 'Rango', width: 15 }, { header: 'Cantidad', width: 10 }];
      for (const t of data.byTenure) ws4.addRow([t.range, t.count]);
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }
}
