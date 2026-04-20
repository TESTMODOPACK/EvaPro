import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CustomKpi, KpiType } from './entities/custom-kpi.entity';
import { EvaluationCycle, CycleStatus } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment, AssignmentStatus } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { Objective, ObjectiveStatus } from '../objectives/entities/objective.entity';
import { QuickFeedback } from '../feedback/entities/quick-feedback.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class KpiService {
  constructor(
    @InjectRepository(CustomKpi) private readonly kpiRepo: Repository<CustomKpi>,
    @InjectRepository(EvaluationCycle) private readonly cycleRepo: Repository<EvaluationCycle>,
    @InjectRepository(EvaluationAssignment) private readonly assignRepo: Repository<EvaluationAssignment>,
    @InjectRepository(EvaluationResponse) private readonly responseRepo: Repository<EvaluationResponse>,
    @InjectRepository(Objective) private readonly objRepo: Repository<Objective>,
    @InjectRepository(QuickFeedback) private readonly feedbackRepo: Repository<QuickFeedback>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────

  async findAll(tenantId: string): Promise<CustomKpi[]> {
    return this.kpiRepo.find({
      where: { tenantId, isActive: true },
      order: { displayOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async create(tenantId: string, userId: string, dto: any): Promise<CustomKpi> {
    const kpi = this.kpiRepo.create({
      tenantId,
      name: dto.name,
      type: dto.type,
      config: dto.config || {},
      displayOrder: dto.displayOrder ?? 0,
      icon: dto.icon || '',
      target: dto.target ?? null,
      isActive: true,
      createdBy: userId,
    });
    return this.kpiRepo.save(kpi);
  }

  async update(tenantId: string, id: string, dto: any): Promise<CustomKpi> {
    const kpi = await this.kpiRepo.findOne({ where: { id, tenantId } });
    if (!kpi) throw new NotFoundException('KPI no encontrado');
    Object.assign(kpi, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.config !== undefined && { config: dto.config }),
      ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
      ...(dto.icon !== undefined && { icon: dto.icon }),
      ...(dto.target !== undefined && { target: dto.target }),
    });
    return this.kpiRepo.save(kpi);
  }

  async deactivate(tenantId: string, id: string): Promise<void> {
    const kpi = await this.kpiRepo.findOne({ where: { id, tenantId } });
    if (!kpi) throw new NotFoundException('KPI no encontrado');
    kpi.isActive = false;
    await this.kpiRepo.save(kpi);
  }

  // ─── Calculate KPI Values ─────────────────────────────────────────────

  /**
   * P7.1 — Si managerId está presente (caller es manager), pre-cargamos
   * sus reportes directos + self UNA vez y los propagamos a cada KPI
   * calculation. Admin pasa managerId=undefined → ve todos los KPIs de la
   * organización sin filtro.
   */
  async calculateAll(
    tenantId: string,
    managerId?: string,
  ): Promise<Array<{ kpi: CustomKpi; value: number | string; formattedValue: string }>> {
    const kpis = await this.findAll(tenantId);
    const results: Array<{ kpi: CustomKpi; value: number | string; formattedValue: string }> = [];

    // Pre-cargar team IDs si es manager.
    let teamIds: Set<string> | null = null;
    if (managerId) {
      const reports = await this.userRepo.find({
        where: { tenantId, managerId },
        select: ['id'],
      });
      teamIds = new Set(reports.map((u) => u.id));
      teamIds.add(managerId);
    }

    for (const kpi of kpis) {
      try {
        const { value, formatted } = await this.calculateKpi(tenantId, kpi, teamIds);
        results.push({ kpi, value, formattedValue: formatted });
      } catch {
        results.push({ kpi, value: 0, formattedValue: 'Error' });
      }
    }
    return results;
  }

  private async calculateKpi(
    tenantId: string,
    kpi: CustomKpi,
    teamIds: Set<string> | null = null,
  ): Promise<{ value: number; formatted: string }> {
    const teamFilter = teamIds ? [...teamIds] : null;
    switch (kpi.type) {
      case KpiType.CYCLE_COMPLETION: {
        const activeCycles = await this.cycleRepo.find({ where: { tenantId, status: CycleStatus.ACTIVE } });
        if (activeCycles.length === 0) return { value: 0, formatted: 'Sin ciclos activos' };
        const cycleId = kpi.config?.cycleId || activeCycles[0].id;
        const totalWhere: any = { cycleId, tenantId };
        const completedWhere: any = { cycleId, tenantId, status: AssignmentStatus.COMPLETED };
        if (teamFilter) {
          totalWhere.evaluateeId = In(teamFilter);
          completedWhere.evaluateeId = In(teamFilter);
        }
        const total = await this.assignRepo.count({ where: totalWhere });
        const completed = await this.assignRepo.count({ where: completedWhere });
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { value: pct, formatted: `${pct}%` };
      }

      case KpiType.AVG_SCORE: {
        const activeCycles = await this.cycleRepo.find({ where: { tenantId, status: CycleStatus.ACTIVE } });
        const closedCycles = await this.cycleRepo.find({ where: { tenantId, status: CycleStatus.CLOSED } });
        const cycles = [...activeCycles, ...closedCycles];
        if (cycles.length === 0) return { value: 0, formatted: 'N/A' };
        const cycleId = kpi.config?.cycleId || cycles[0].id;
        const qb = this.responseRepo
          .createQueryBuilder('r')
          .innerJoin('r.assignment', 'a', 'a.tenant_id = r.tenant_id')
          .where('a.cycleId = :cycleId', { cycleId })
          .andWhere('r.tenantId = :tenantId', { tenantId })
          .andWhere('r.overall_score IS NOT NULL');
        if (teamFilter) qb.andWhere('a.evaluatee_id IN (:...teamIds)', { teamIds: teamFilter });
        const result = await qb.select('AVG(r.overall_score)', 'avg').getRawOne();
        const avg = result?.avg != null ? parseFloat(result.avg) : null;
        const rounded = avg != null ? Math.round(avg * 100) / 100 : 0;
        return { value: rounded, formatted: avg != null ? `${rounded.toFixed(1)} / 10` : 'N/A' };
      }

      case KpiType.DEPARTMENT_AVG: {
        const deptId = kpi.config?.departmentId;
        const dept = kpi.config?.department;
        if (!deptId && !dept) return { value: 0, formatted: 'Sin departamento configurado' };
        const qb = this.responseRepo
          .createQueryBuilder('r')
          .innerJoin('r.assignment', 'a', 'a.tenant_id = r.tenant_id')
          .innerJoin(User, 'u', 'u.id = a.evaluatee_id AND u.tenant_id = a.tenant_id')
          .where('r.tenantId = :tenantId', { tenantId });
        if (deptId) {
          qb.andWhere('u.department_id = :deptId', { deptId });
        } else {
          qb.andWhere('u.department = :dept', { dept });
        }
        if (teamFilter) qb.andWhere('a.evaluatee_id IN (:...teamIds)', { teamIds: teamFilter });
        const result = await qb
          .andWhere('r.overall_score IS NOT NULL')
          .select('AVG(r.overall_score)', 'avg')
          .getRawOne();
        const avg = result?.avg != null ? parseFloat(result.avg) : null;
        const rounded = avg != null ? Math.round(avg * 100) / 100 : 0;
        return { value: rounded, formatted: avg != null ? `${rounded.toFixed(1)}` : 'N/A' };
      }

      case KpiType.OBJECTIVE_COMPLETION: {
        const totalWhere: any = { tenantId };
        const completedWhere: any = { tenantId, status: ObjectiveStatus.COMPLETED };
        if (teamFilter) {
          totalWhere.userId = In(teamFilter);
          completedWhere.userId = In(teamFilter);
        }
        const total = await this.objRepo.count({ where: totalWhere });
        const completed = await this.objRepo.count({ where: completedWhere });
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { value: pct, formatted: `${pct}% (${completed}/${total})` };
      }

      case KpiType.FEEDBACK_COUNT: {
        const where: any = { tenantId };
        if (teamFilter) where.toUserId = In(teamFilter);
        const count = await this.feedbackRepo.count({ where });
        return { value: count, formatted: String(count) };
      }

      case KpiType.ACTIVE_USERS: {
        const where: any = { tenantId, isActive: true };
        if (teamFilter) where.id = In(teamFilter);
        const count = await this.userRepo.count({ where });
        return { value: count, formatted: String(count) };
      }

      case KpiType.AT_RISK_OBJECTIVES: {
        const threshold = kpi.config?.threshold ?? 40;
        const qb = this.objRepo
          .createQueryBuilder('o')
          .where('o.tenantId = :tenantId', { tenantId })
          .andWhere('o.status = :status', { status: ObjectiveStatus.ACTIVE })
          .andWhere('o.progress < :threshold', { threshold });
        if (teamFilter) qb.andWhere('o.user_id IN (:...teamIds)', { teamIds: teamFilter });
        const atRisk = await qb.getCount();
        return { value: atRisk, formatted: String(atRisk) };
      }

      default:
        return { value: 0, formatted: 'Tipo no soportado' };
    }
  }
}
