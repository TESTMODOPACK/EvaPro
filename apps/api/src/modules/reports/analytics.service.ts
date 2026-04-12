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
    // Defense-in-depth tenant guard on the JOIN — see getInternalMovementAnalysis.
    const plans = await this.planRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.user', 'u', 'u.tenant_id = p.tenant_id')
      .leftJoinAndSelect('p.actions', 'a')
      .where('p.tenant_id = :tenantId', { tenantId })
      .getMany();

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
        id: plan.id,
        userName,
        planTitle: plan.title || 'Sin título',
        status: plan.status,
        progress,
        totalActions: actions.length,
        completedActions: actions.filter((a: any) => a.status === 'completada' || a.status === 'completed').length,
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

  // ─── 1b. PDI Historical ─────────────────────────────────────────────

  async getPdiHistorical(tenantId: string): Promise<any> {
    // Defense-in-depth tenant guard on the JOIN — see getInternalMovementAnalysis.
    const allPlans = await this.planRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.user', 'u', 'u.tenant_id = p.tenant_id')
      .leftJoinAndSelect('p.actions', 'a')
      .where('p.tenant_id = :tenantId', { tenantId })
      .getMany();

    const total = allPlans.length;
    const completed = allPlans.filter(p => p.status === 'completado').length;
    const cancelled = allPlans.filter(p => p.status === 'cancelado').length;
    const completedPct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const cancelledPct = total > 0 ? Math.round((cancelled / total) * 100) : 0;

    // Average duration of completed plans (days)
    const completedPlans = allPlans.filter(p => p.status === 'completado' && p.completedAt && p.startDate);
    const avgDurationDays = completedPlans.length > 0
      ? Math.round(completedPlans.reduce((sum, p) => sum + (new Date(p.completedAt!).getTime() - new Date(p.startDate).getTime()) / (1000 * 60 * 60 * 24), 0) / completedPlans.length)
      : 0;

    // Total actions across all plans
    let totalActions = 0, completedActions = 0;
    for (const p of allPlans) {
      const actions = p.actions || [];
      totalActions += actions.length;
      completedActions += actions.filter((a: any) => a.status === 'completada' || a.status === 'completed').length;
    }

    // Top departments by completed plans
    const deptCompleted: Record<string, number> = {};
    for (const p of allPlans.filter(pl => pl.status === 'completado')) {
      const dept = (p.user as any)?.department || 'Sin departamento';
      deptCompleted[dept] = (deptCompleted[dept] || 0) + 1;
    }
    const topDepartments = Object.entries(deptCompleted)
      .map(([dept, count]) => ({ department: dept, completed: count }))
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 10);

    // Plans by year (with plan details for collapsible list)
    const byYear: Record<string, { total: number; completed: number; plans: any[] }> = {};
    for (const p of allPlans) {
      const year = p.startDate ? new Date(p.startDate).getFullYear().toString() : 'Sin fecha';
      if (!byYear[year]) byYear[year] = { total: 0, completed: 0, plans: [] };
      byYear[year].total++;
      if (p.status === 'completado') byYear[year].completed++;
      const actions = p.actions || [];
      const completedActs = actions.filter((a: any) => a.status === 'completada' || a.status === 'completed').length;
      byYear[year].plans.push({
        id: p.id,
        title: p.title,
        status: p.status,
        userName: (p.user as any) ? `${(p.user as any).firstName} ${(p.user as any).lastName}` : 'Sin asignar',
        department: (p.user as any)?.department || null,
        progress: p.progress || 0,
        totalActions: actions.length,
        completedActions: completedActs,
        startDate: p.startDate,
      });
    }

    return {
      totalPlansAllTime: total,
      completedAllTime: completed,
      cancelledAllTime: cancelled,
      completedPct,
      cancelledPct,
      avgDurationDays,
      totalActions,
      completedActions,
      actionCompletionPct: totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : 0,
      topDepartments,
      // Explicit assignment (not spread) to guarantee the `plans` array is
      // always present and populated in the response — defensive fix for a
      // bug where the historical tab reported "no plans" despite total > 0.
      byYear: Object.entries(byYear).map(([year, d]) => ({
        year,
        total: d.total,
        completed: d.completed,
        plans: Array.isArray(d.plans) ? d.plans : [],
      })).sort((a, b) => b.year.localeCompare(a.year)),
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

    // Pre-load direct reports ONCE outside the cycle loop (N+1 fix).
    // Before: if manager filters + 10 closed cycles, the same query for
    // directReports ran 10 times with identical results.
    let managerFilterIds: Set<string> | null = null;
    if (managerId) {
      const directReports = await this.userRepo.find({ where: { tenantId, managerId }, select: ['id'] });
      managerFilterIds = new Set(directReports.map(u => u.id));
      managerFilterIds.add(managerId);
    }

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

      // If manager, filter to direct reports (pre-loaded above)
      let filtered = assignments;
      if (managerFilterIds) {
        filtered = assignments.filter(a => managerFilterIds!.has(a.evaluateeId));
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
    // Same defense-in-depth JOIN condition as getInternalMovementAnalysis:
    // enforce u.tenant_id = d.tenant_id to prevent cross-tenant user leaks
    // when departure rows have stale userIds pointing to users in other tenants.
    const departures = await this.departureRepo
      .createQueryBuilder('d')
      .innerJoinAndSelect('d.user', 'u', 'u.tenant_id = d.tenant_id')
      .where('d.tenant_id = :tenantId', { tenantId })
      .andWhere('d.departure_date > :cutoff', { cutoff: twelveMonthsAgo })
      .orderBy('d.departure_date', 'DESC')
      .getMany();

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

    // Defense-in-depth: the join enforces u.tenant_id = m.tenant_id. Without
    // that constraint, a stale user_movements row that points at a user in
    // ANOTHER tenant would leak that other user's name into this tenant's
    // report. This happened in prod (Rodrigo Monasterio of Cesce showing up
    // in Demo Company's movements).
    const movements = await this.movementRepo
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.user', 'u', 'u.tenant_id = m.tenant_id')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.effective_date > :cutoff', { cutoff: twelveMonthsAgo })
      .orderBy('m.effective_date', 'DESC')
      .getMany();

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

  // ─── System Usage PDF Export ────────────────────────────────────────────

  async exportSystemUsagePdf(data: any): Promise<Buffer> {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF('l', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;

    // Header
    doc.setFillColor(26, 18, 6);
    doc.rect(0, 0, pageW, 30, 'F');
    doc.setTextColor(245, 228, 168);
    doc.setFontSize(16);
    doc.text('Adopción y Uso del Sistema', margin, 16);
    doc.setFontSize(9);
    doc.setTextColor(201, 147, 58);
    doc.text(`Exportado el ${new Date().toLocaleDateString('es-CL')}`, margin, 24);

    let y = 38;

    // KPIs
    const kpis = [
      { label: 'Usuarios Totales', value: `${data.totalUsers || 0}` },
      { label: 'Activos Mes (MAU)', value: `${data.mau || 0}` },
      { label: 'Activos Semana (WAU)', value: `${data.wau || 0}` },
      { label: 'Tasa Adopción', value: `${data.adoptionRate || 0}%` },
    ];
    const kpiW = (pageW - 2 * margin - 3 * 4) / 4;
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
    y += 26;

    // Module usage table
    if (data.moduleUsage?.length) {
      doc.setFontSize(10);
      doc.setTextColor(26, 18, 6);
      doc.text('Uso por Módulo', margin, y + 4);
      y += 8;
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: pageW / 2 + 10 },
        head: [['Módulo', 'Acciones']],
        body: data.moduleUsage.map((m: any) => [m.module, m.count]),
        headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
    }

    // Top actions table
    if (data.topActions?.length) {
      const rightX = pageW / 2 + 20;
      doc.setFontSize(10);
      doc.setTextColor(26, 18, 6);
      doc.text('Acciones Más Frecuentes', rightX, y - 4);
      autoTable(doc, {
        startY: y,
        margin: { left: rightX, right: margin },
        head: [['Acción', 'Cantidad']],
        body: data.topActions.slice(0, 10).map((a: any) => [a.action, a.count]),
        headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
    }

    // Daily activity table on new page
    if (data.dailyActivity?.length) {
      doc.addPage();
      doc.setFontSize(10);
      doc.setTextColor(26, 18, 6);
      doc.text('Actividad Diaria (Últimos 30 días)', margin, 16);
      autoTable(doc, {
        startY: 22,
        margin: { left: margin, right: margin },
        head: [['Fecha', 'Acciones', 'Usuarios Únicos']],
        body: data.dailyActivity.map((d: any) => [d.date, d.actions, d.users]),
        headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
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

    lines.push('Análisis de Dotación — Resumen');
    lines.push(`Usuarios activos,${data.activeUsers}`);
    lines.push(`Usuarios inactivos,${data.inactiveUsers}`);
    lines.push(`Bajas últimos 12 meses,${data.totalDeactivations12m}`);
    lines.push(`Tasa de rotación,${data.turnoverRate}%`);
    lines.push(`Salidas voluntarias,${data.voluntary || 0}`);
    lines.push(`Salidas involuntarias,${data.involuntary || 0}`);
    lines.push('');

    if (data.byType?.length) {
      lines.push('Por Tipo de Salida');
      lines.push('Tipo,Cantidad');
      for (const t of data.byType) lines.push(`${esc(t.type)},${t.count}`);
      lines.push('');
    }

    if (data.byReason?.length) {
      lines.push('Por Categoría de Motivo');
      lines.push('Motivo,Cantidad');
      for (const r of data.byReason) lines.push(`${esc(r.reason)},${r.count}`);
      lines.push('');
    }

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
      lines.push('');
    }

    if (data.wouldRehire) {
      lines.push('Recontratarías');
      lines.push(`Sí,${data.wouldRehire.yes || 0}`);
      lines.push(`No,${data.wouldRehire.no || 0}`);
      lines.push(`Sin respuesta,${data.wouldRehire.noAnswer || 0}`);
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
    ws1.addRow(['Análisis de Dotación']).font = { bold: true, size: 14 };
    ws1.addRow([]);
    ws1.addRow(['Usuarios activos', data.activeUsers]);
    ws1.addRow(['Usuarios inactivos', data.inactiveUsers]);
    ws1.addRow(['Bajas últimos 12 meses', data.totalDeactivations12m]);
    ws1.addRow(['Tasa de rotación', `${data.turnoverRate}%`]);
    ws1.addRow(['Salidas voluntarias', data.voluntary || 0]);
    ws1.addRow(['Salidas involuntarias', data.involuntary || 0]);

    // Sheet 2: Por Tipo de Salida
    if (data.byType?.length) {
      const ws = wb.addWorksheet('Por Tipo');
      ws.columns = [{ header: 'Tipo', width: 25 }, { header: 'Cantidad', width: 12 }];
      for (const t of data.byType) ws.addRow([t.type, t.count]);
    }

    // Sheet 3: Por Motivo
    if (data.byReason?.length) {
      const ws = wb.addWorksheet('Por Motivo');
      ws.columns = [{ header: 'Categoría', width: 30 }, { header: 'Cantidad', width: 12 }];
      for (const r of data.byReason) ws.addRow([r.reason, r.count]);
    }

    // Sheet 4: Bajas por Mes
    if (data.byMonth?.length) {
      const ws = wb.addWorksheet('Bajas por Mes');
      ws.columns = [{ header: 'Mes', width: 15 }, { header: 'Bajas', width: 10 }];
      for (const m of data.byMonth) ws.addRow([m.month, m.count]);
    }

    // Sheet 5: Bajas por Departamento
    if (data.byDepartment?.length) {
      const ws = wb.addWorksheet('Bajas por Departamento');
      ws.columns = [{ header: 'Departamento', width: 25 }, { header: 'Bajas', width: 10 }];
      for (const d of data.byDepartment) ws.addRow([d.department, d.count]);
    }

    // Sheet 6: Antigüedad
    if (data.byTenure?.length) {
      const ws = wb.addWorksheet('Antigüedad al Salir');
      ws.columns = [{ header: 'Rango', width: 15 }, { header: 'Cantidad', width: 10 }];
      for (const t of data.byTenure) ws.addRow([t.range, t.count]);
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // ─── Turnover PDF Export ──────────────────────────────────────────────

  async exportTurnoverPdf(data: any): Promise<Buffer> {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF('l', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;

    // Header
    doc.setFillColor(26, 18, 6);
    doc.rect(0, 0, pageW, 30, 'F');
    doc.setTextColor(245, 228, 168);
    doc.setFontSize(16);
    doc.text('Análisis de Dotación', margin, 16);
    doc.setFontSize(9);
    doc.setTextColor(201, 147, 58);
    doc.text(`Exportado el ${new Date().toLocaleDateString('es-CL')}`, margin, 24);

    let y = 38;

    // KPIs
    const kpis = [
      { label: 'Activos', value: `${data.activeUsers || 0}` },
      { label: 'Inactivos', value: `${data.inactiveUsers || 0}` },
      { label: 'Bajas 12m', value: `${data.totalDeactivations12m || 0}` },
      { label: 'Tasa Rotación', value: `${data.turnoverRate || 0}%` },
      { label: 'Voluntarias', value: `${data.voluntary || 0}` },
      { label: 'Involuntarias', value: `${data.involuntary || 0}` },
    ];
    const kpiW = (pageW - 2 * margin - 5 * 4) / 6;
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
    y += 26;

    // By Type table
    if (data.byType?.length) {
      doc.setFontSize(10);
      doc.setTextColor(26, 18, 6);
      doc.text('Salidas por Tipo', margin, y + 4);
      y += 8;
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: pageW / 2 + 10 },
        head: [['Tipo', 'Cantidad']],
        body: data.byType.map((t: any) => [t.type, t.count]),
        headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
    }

    // By Reason table
    if (data.byReason?.length) {
      const rightX = pageW / 2 + 20;
      doc.setFontSize(10);
      doc.setTextColor(26, 18, 6);
      doc.text('Salidas por Motivo', rightX, y - 4);
      autoTable(doc, {
        startY: y,
        margin: { left: rightX, right: margin },
        head: [['Motivo', 'Cantidad']],
        body: data.byReason.map((r: any) => [r.reason, r.count]),
        headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
    }

    // Page 2: Monthly + Department + Tenure
    doc.addPage();
    let y2 = 16;

    if (data.byMonth?.length) {
      doc.setFontSize(10);
      doc.setTextColor(26, 18, 6);
      doc.text('Bajas por Mes (Últimos 12 meses)', margin, y2);
      y2 += 4;
      autoTable(doc, {
        startY: y2,
        margin: { left: margin, right: pageW * 0.65 },
        head: [['Mes', 'Bajas']],
        body: data.byMonth.map((m: any) => [m.month, m.count]),
        headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
    }

    if (data.byDepartment?.length) {
      const colX = pageW * 0.38;
      doc.setFontSize(10);
      doc.setTextColor(26, 18, 6);
      doc.text('Bajas por Departamento', colX, y2 - 4);
      autoTable(doc, {
        startY: y2,
        margin: { left: colX, right: pageW * 0.3 },
        head: [['Departamento', 'Bajas']],
        body: data.byDepartment.map((d: any) => [d.department, d.count]),
        headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
    }

    if (data.byTenure?.length) {
      const colX = pageW * 0.72;
      doc.setFontSize(10);
      doc.setTextColor(26, 18, 6);
      doc.text('Antigüedad al Salir', colX, y2 - 4);
      autoTable(doc, {
        startY: y2,
        margin: { left: colX, right: margin },
        head: [['Rango', 'Cantidad']],
        body: data.byTenure.map((t: any) => [t.range, t.count]),
        headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
    }

    // Would rehire stats
    if (data.wouldRehire) {
      const wr = data.wouldRehire;
      const lastY = (doc as any).lastAutoTable?.finalY || y2 + 40;
      doc.setFontSize(9);
      doc.setTextColor(26, 18, 6);
      doc.text(`Recontrataría: Sí ${wr.yes || 0} | No ${wr.no || 0} | Sin dato ${wr.noAnswer || 0}`, margin, lastY + 10);
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
