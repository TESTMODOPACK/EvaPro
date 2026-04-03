import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan, In, IsNull, Not } from 'typeorm';
import { DevelopmentPlan } from '../development/entities/development-plan.entity';
import { DevelopmentAction } from '../development/entities/development-action.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { EvaluationCycle, CycleStatus } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';

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
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
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
    const byDepartment: Record<string, { total: number; completed: number; avgProgress: number }> = {};
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
      if (!byDepartment[dept]) byDepartment[dept] = { total: 0, completed: 0, avgProgress: 0 };
      byDepartment[dept].total++;
      if (plan.status === 'completado') byDepartment[dept].completed++;
      const progress = actions.length > 0 ? Math.round(actions.filter((a: any) => a.status === 'completada' || a.status === 'completed').length / actions.length * 100) : 0;
      byDepartment[dept].avgProgress += progress;
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
      const assignmentWhere: any = { cycleId: cycle.id, tenantId };
      const assignments = await this.assignmentRepo.find({
        where: assignmentWhere,
        relations: ['evaluatee'],
      });

      // If manager, filter to direct reports
      let filtered = assignments;
      if (managerId) {
        const directReports = await this.userRepo.find({ where: { tenantId, managerId }, select: ['id'] });
        const ids = new Set(directReports.map(u => u.id));
        ids.add(managerId);
        filtered = assignments.filter(a => ids.has(a.evaluateeId));
      }

      const withScores = filtered.filter((a: any) => a.response?.overallScore != null);
      const scores = withScores.map((a: any) => Number(a.response.overallScore));
      const avg = scores.length > 0 ? Number((scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2)) : null;
      const min = scores.length > 0 ? Math.min(...scores) : null;
      const max = scores.length > 0 ? Math.max(...scores) : null;

      // Department breakdown
      const deptScores: Record<string, number[]> = {};
      for (const a of withScores) {
        const dept = (a.evaluatee as any)?.department || 'Sin departamento';
        if (!deptScores[dept]) deptScores[dept] = [];
        deptScores[dept].push(Number((a as any).response.overallScore));
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
    // Active users
    const activeUsers = await this.userRepo.count({ where: { tenantId, isActive: true } });
    const inactiveUsers = await this.userRepo.count({ where: { tenantId, isActive: false } });

    // Deactivation events from audit log (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const deactivations = await this.auditRepo.find({
      where: {
        tenantId,
        action: In(['user.deactivated', 'user.deleted']),
        createdAt: MoreThan(twelveMonthsAgo),
      },
      order: { createdAt: 'DESC' },
    });

    // Group by month
    const byMonth: Record<string, number> = {};
    for (const d of deactivations) {
      const month = new Date(d.createdAt).toISOString().slice(0, 7); // YYYY-MM
      byMonth[month] = (byMonth[month] || 0) + 1;
    }

    // Get user details for deactivated users (department, hire date, last score)
    const deactivatedUserIds = deactivations
      .map(d => d.userId)
      .filter(Boolean) as string[];

    const deactivatedUsers = deactivatedUserIds.length > 0
      ? await this.userRepo.find({
          where: deactivatedUserIds.map(id => ({ id })),
          select: ['id', 'firstName', 'lastName', 'department', 'hireDate', 'isActive'],
        })
      : [];

    // Group by department
    const byDepartment: Record<string, number> = {};
    for (const u of deactivatedUsers) {
      const dept = u.department || 'Sin departamento';
      byDepartment[dept] = (byDepartment[dept] || 0) + 1;
    }

    // Tenure analysis (months at company)
    const tenureGroups = { '<6m': 0, '6-12m': 0, '1-2a': 0, '2-5a': 0, '>5a': 0 };
    for (const u of deactivatedUsers) {
      if (!u.hireDate) continue;
      const months = Math.floor((Date.now() - new Date(u.hireDate).getTime()) / (1000 * 60 * 60 * 24 * 30));
      if (months < 6) tenureGroups['<6m']++;
      else if (months < 12) tenureGroups['6-12m']++;
      else if (months < 24) tenureGroups['1-2a']++;
      else if (months < 60) tenureGroups['2-5a']++;
      else tenureGroups['>5a']++;
    }

    const totalAtStart = activeUsers + deactivations.length;
    const turnoverRate = totalAtStart > 0 ? Math.round((deactivations.length / totalAtStart) * 100) : 0;

    return {
      activeUsers,
      inactiveUsers,
      totalDeactivations12m: deactivations.length,
      turnoverRate,
      byMonth: Object.entries(byMonth).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
      byDepartment: Object.entries(byDepartment).map(([dept, count]) => ({ department: dept, count })).sort((a, b) => b.count - a.count),
      byTenure: Object.entries(tenureGroups).map(([range, count]) => ({ range, count })),
    };
  }
}
