import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async calculateAll(tenantId: string): Promise<Array<{ kpi: CustomKpi; value: number | string; formattedValue: string }>> {
    const kpis = await this.findAll(tenantId);
    const results: Array<{ kpi: CustomKpi; value: number | string; formattedValue: string }> = [];

    for (const kpi of kpis) {
      try {
        const { value, formatted } = await this.calculateKpi(tenantId, kpi);
        results.push({ kpi, value, formattedValue: formatted });
      } catch {
        results.push({ kpi, value: 0, formattedValue: 'Error' });
      }
    }
    return results;
  }

  private async calculateKpi(tenantId: string, kpi: CustomKpi): Promise<{ value: number; formatted: string }> {
    switch (kpi.type) {
      case KpiType.CYCLE_COMPLETION: {
        const activeCycles = await this.cycleRepo.find({ where: { tenantId, status: CycleStatus.ACTIVE } });
        if (activeCycles.length === 0) return { value: 0, formatted: 'Sin ciclos activos' };
        const cycleId = kpi.config?.cycleId || activeCycles[0].id;
        const total = await this.assignRepo.count({ where: { cycleId, tenantId } });
        const completed = await this.assignRepo.count({ where: { cycleId, tenantId, status: AssignmentStatus.COMPLETED } });
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { value: pct, formatted: `${pct}%` };
      }

      case KpiType.AVG_SCORE: {
        const activeCycles = await this.cycleRepo.find({ where: { tenantId, status: CycleStatus.ACTIVE } });
        const closedCycles = await this.cycleRepo.find({ where: { tenantId, status: CycleStatus.CLOSED } });
        const cycles = [...activeCycles, ...closedCycles];
        if (cycles.length === 0) return { value: 0, formatted: 'N/A' };
        const cycleId = kpi.config?.cycleId || cycles[0].id;
        const result = await this.responseRepo
          .createQueryBuilder('r')
          .innerJoin('r.assignment', 'a')
          .where('a.cycleId = :cycleId', { cycleId })
          .andWhere('r.tenantId = :tenantId', { tenantId })
          .andWhere('r.overall_score IS NOT NULL')
          .select('AVG(r.overall_score)', 'avg')
          .getRawOne();
        const avg = result?.avg != null ? parseFloat(result.avg) : null;
        const rounded = avg != null ? Math.round(avg * 100) / 100 : 0;
        return { value: rounded, formatted: avg != null ? `${rounded.toFixed(1)} / 10` : 'N/A' };
      }

      case KpiType.DEPARTMENT_AVG: {
        const dept = kpi.config?.department;
        if (!dept) return { value: 0, formatted: 'Sin departamento configurado' };
        const result = await this.responseRepo
          .createQueryBuilder('r')
          .innerJoin('r.assignment', 'a')
          .innerJoin(User, 'u', 'u.id = a.evaluatee_id')
          .where('r.tenantId = :tenantId', { tenantId })
          .andWhere('u.department = :dept', { dept })
          .andWhere('r.overall_score IS NOT NULL')
          .select('AVG(r.overall_score)', 'avg')
          .getRawOne();
        const avg = result?.avg != null ? parseFloat(result.avg) : null;
        const rounded = avg != null ? Math.round(avg * 100) / 100 : 0;
        return { value: rounded, formatted: avg != null ? `${rounded.toFixed(1)}` : 'N/A' };
      }

      case KpiType.OBJECTIVE_COMPLETION: {
        const total = await this.objRepo.count({ where: { tenantId } });
        const completed = await this.objRepo.count({ where: { tenantId, status: ObjectiveStatus.COMPLETED } });
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { value: pct, formatted: `${pct}% (${completed}/${total})` };
      }

      case KpiType.FEEDBACK_COUNT: {
        const count = await this.feedbackRepo.count({ where: { tenantId } });
        return { value: count, formatted: String(count) };
      }

      case KpiType.ACTIVE_USERS: {
        const count = await this.userRepo.count({ where: { tenantId, isActive: true } });
        return { value: count, formatted: String(count) };
      }

      case KpiType.AT_RISK_OBJECTIVES: {
        const threshold = kpi.config?.threshold ?? 40;
        const atRisk = await this.objRepo
          .createQueryBuilder('o')
          .where('o.tenantId = :tenantId', { tenantId })
          .andWhere('o.status = :status', { status: ObjectiveStatus.ACTIVE })
          .andWhere('o.progress < :threshold', { threshold })
          .getCount();
        return { value: atRisk, formatted: String(atRisk) };
      }

      default:
        return { value: 0, formatted: 'Tipo no soportado' };
    }
  }
}
