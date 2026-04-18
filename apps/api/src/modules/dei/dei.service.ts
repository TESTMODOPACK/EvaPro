import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { DeiCorrectiveAction } from './entities/dei-corrective-action.entity';

const DEFAULT_PRIVACY_MIN = 5; // Minimum group size for DEI metrics (configurable by tenant)
const DEFAULT_MEDIUM_THRESHOLD = 1.5; // Gap >= 1.5 points = medium alert
const DEFAULT_HIGH_THRESHOLD = 2.0; // Gap >= 2.0 points = high alert

export interface GroupMetric {
  group: string;
  count: number;
  percentage: number;
}

@Injectable()
export class DeiService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(EvaluationResponse) private readonly responseRepo: Repository<EvaluationResponse>,
    @InjectRepository(EvaluationAssignment) private readonly assignRepo: Repository<EvaluationAssignment>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(DeiCorrectiveAction) private readonly correctiveActionRepo: Repository<DeiCorrectiveAction>,
  ) {}

  /** Get tenant-configurable DEI thresholds (falls back to defaults) */
  private async getThresholds(tenantId: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId }, select: ['id', 'settings'] });
    type DeiConfig = { privacyMin?: number; mediumThreshold?: number; highThreshold?: number };
    const dei: DeiConfig = (tenant?.settings?.dei as DeiConfig | undefined) || {};
    return {
      privacyMin: typeof dei.privacyMin === 'number' && dei.privacyMin >= 2 ? dei.privacyMin : DEFAULT_PRIVACY_MIN,
      mediumThreshold: typeof dei.mediumThreshold === 'number' && dei.mediumThreshold > 0 ? dei.mediumThreshold : DEFAULT_MEDIUM_THRESHOLD,
      highThreshold: typeof dei.highThreshold === 'number' && dei.highThreshold > 0 ? dei.highThreshold : DEFAULT_HIGH_THRESHOLD,
    };
  }

  // ─── Demographic Composition ────────────────────────────────────────

  async getDemographicOverview(tenantId: string) {
    const users = await this.userRepo.find({
      where: { tenantId, isActive: true },
      select: ['id', 'gender', 'birthDate', 'nationality', 'department', 'position',
        'seniorityLevel', 'contractType', 'workLocation', 'hireDate', 'role'],
    });

    const total = users.length;
    if (total === 0) return { total: 0, message: 'Sin usuarios activos' };

    const thresholds = await this.getThresholds(tenantId);

    return {
      total,
      gender: this.groupBy(users, 'gender', total),
      seniority: this.groupBy(users, 'seniorityLevel', total),
      contractType: this.groupBy(users, 'contractType', total),
      workLocation: this.groupBy(users, 'workLocation', total),
      nationality: this.groupBy(users, 'nationality', total),
      ageRanges: this.calculateAgeRanges(users, total),
      tenureRanges: this.calculateTenureRanges(users, total),
      departmentBreakdown: this.departmentDiversity(users, thresholds.privacyMin),
      dataCompleteness: this.calculateDataCompleteness(users),
      privacyThreshold: thresholds.privacyMin,
    };
  }

  // ─── Evaluation Equity Analysis ─────────────────────────────────────

  async getEquityAnalysis(tenantId: string, cycleId: string) {
    const thresholds = await this.getThresholds(tenantId);

    // Get all completed responses with evaluatee demographics
    const rows = await this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a', 'a.tenant_id = r.tenant_id')
      .innerJoin(User, 'u', 'u.id = a.evaluatee_id AND u.tenant_id = :tenantId')
      .where('a.cycle_id = :cycleId', { cycleId })
      .andWhere('r.tenant_id = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL')
      .select('r.overall_score', 'score')
      .addSelect('u.gender', 'gender')
      .addSelect('u.department', 'department')
      .addSelect('u.seniority_level', 'seniority')
      .addSelect('u.birth_date', 'birthDate')
      .addSelect('u.hire_date', 'hireDate')
      .getRawMany();

    if (rows.length === 0) {
      return { cycleId, message: 'Sin datos de evaluación disponibles', alerts: [] };
    }

    const alerts: Array<{ type: string; severity: string; message: string; data: any }> = [];

    // Gender equity
    const genderScores = this.groupScores(rows, 'gender', thresholds.privacyMin);
    const genderAlert = this.detectBias(genderScores, 'Género', thresholds);
    if (genderAlert) alerts.push(genderAlert);

    // Seniority equity
    const seniorityScores = this.groupScores(rows, 'seniority', thresholds.privacyMin);
    const seniorityAlert = this.detectBias(seniorityScores, 'Nivel de seniority', thresholds);
    if (seniorityAlert) alerts.push(seniorityAlert);

    // Age equity
    const rowsWithAge = rows.map((r) => ({
      ...r,
      ageGroup: r.birthDate ? this.getAgeGroup(new Date(r.birthDate)) : null,
    }));
    const ageScores = this.groupScores(rowsWithAge, 'ageGroup', thresholds.privacyMin);
    const ageAlert = this.detectBias(ageScores, 'Rango etario', thresholds);
    if (ageAlert) alerts.push(ageAlert);

    // Tenure equity
    const rowsWithTenure = rows.map((r) => ({
      ...r,
      tenureGroup: r.hireDate ? this.getTenureGroup(new Date(r.hireDate)) : null,
    }));
    const tenureScores = this.groupScores(rowsWithTenure, 'tenureGroup', thresholds.privacyMin);
    const tenureAlert = this.detectBias(tenureScores, 'Antigüedad', thresholds);
    if (tenureAlert) alerts.push(tenureAlert);

    return {
      cycleId,
      totalEvaluations: rows.length,
      equityByGender: genderScores,
      equityBySeniority: seniorityScores,
      equityByAge: ageScores,
      equityByTenure: tenureScores,
      alerts,
      alertCount: alerts.length,
      overallStatus: alerts.length === 0 ? 'equitativo' : alerts.some((a) => a.severity === 'high') ? 'requiere_atencion' : 'monitorear',
    };
  }

  // ─── Pay / Score Gap Report ─────────────────────────────────────────

  async getGapReport(tenantId: string, cycleId: string, dimension: string) {
    const thresholds = await this.getThresholds(tenantId);
    const validDimensions = ['gender', 'seniority', 'department', 'nationality'];
    const col = validDimensions.includes(dimension) ? dimension : 'gender';
    const colMap: Record<string, string> = { gender: 'u.gender', seniority: 'u.seniority_level', department: 'u.department', nationality: 'u.nationality' };

    const rows = await this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a', 'a.tenant_id = r.tenant_id')
      .innerJoin(User, 'u', 'u.id = a.evaluatee_id AND u.tenant_id = :tenantId')
      .where('a.cycle_id = :cycleId', { cycleId })
      .andWhere('r.tenant_id = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL')
      .andWhere(`${colMap[col]} IS NOT NULL`)
      .select(`${colMap[col]}`, 'groupName')
      .addSelect('AVG(r.overall_score)', 'avgScore')
      .addSelect('MIN(r.overall_score)', 'minScore')
      .addSelect('MAX(r.overall_score)', 'maxScore')
      .addSelect('COUNT(DISTINCT u.id)', 'userCount')
      .groupBy(`${colMap[col]}`)
      .having('COUNT(DISTINCT u.id) >= :min', { min: thresholds.privacyMin })
      .orderBy('AVG(r.overall_score)', 'DESC')
      .getRawMany();

    const overallAvg = rows.length > 0
      ? rows.reduce((s, r) => s + parseFloat(r.avgScore) * parseInt(r.userCount), 0)
        / rows.reduce((s, r) => s + parseInt(r.userCount), 0)
      : 0;

    return {
      cycleId,
      dimension: col,
      overallAvg: Math.round(overallAvg * 100) / 100,
      groups: rows.map((r) => ({
        group: r.groupName,
        avgScore: parseFloat(parseFloat(r.avgScore).toFixed(2)),
        minScore: parseFloat(parseFloat(r.minScore).toFixed(2)),
        maxScore: parseFloat(parseFloat(r.maxScore).toFixed(2)),
        userCount: parseInt(r.userCount),
        gapFromAvg: parseFloat((parseFloat(r.avgScore) - overallAvg).toFixed(2)),
      })),
      privacyThreshold: thresholds.privacyMin,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private groupBy(users: User[], field: keyof User, total: number): GroupMetric[] {
    const counts: Record<string, number> = {};
    for (const u of users) {
      const val = (u[field] as string) || 'Sin especificar';
      counts[val] = (counts[val] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([group, count]) => ({ group, count, percentage: Math.round((count / total) * 1000) / 10 }))
      .sort((a, b) => b.count - a.count);
  }

  private groupScores(rows: any[], field: string, privacyMin = DEFAULT_PRIVACY_MIN) {
    const groups: Record<string, number[]> = {};
    for (const r of rows) {
      const val = r[field] || 'Sin especificar';
      if (!groups[val]) groups[val] = [];
      groups[val].push(Number(r.score));
    }

    return Object.entries(groups)
      .filter(([_, scores]) => scores.length >= privacyMin)
      .map(([group, scores]) => {
        const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
        return {
          group,
          count: scores.length,
          avgScore: Math.round(avg * 100) / 100,
          minScore: Math.round(Math.min(...scores) * 100) / 100,
          maxScore: Math.round(Math.max(...scores) * 100) / 100,
        };
      })
      .sort((a, b) => b.avgScore - a.avgScore);
  }

  private detectBias(
    groupScores: any[],
    dimensionName: string,
    thresholds = { mediumThreshold: DEFAULT_MEDIUM_THRESHOLD, highThreshold: DEFAULT_HIGH_THRESHOLD },
  ) {
    if (groupScores.length < 2) return null;
    const maxAvg = Math.max(...groupScores.map((g: any) => g.avgScore));
    const minAvg = Math.min(...groupScores.map((g: any) => g.avgScore));
    const gap = maxAvg - minAvg;

    if (gap >= thresholds.mediumThreshold) {
      const highGroup = groupScores.find((g: any) => g.avgScore === maxAvg);
      const lowGroup = groupScores.find((g: any) => g.avgScore === minAvg);
      return {
        type: 'score_gap',
        severity: gap >= thresholds.highThreshold ? 'high' : 'medium',
        message: `Brecha de ${gap.toFixed(1)} puntos en ${dimensionName}: "${highGroup.group}" (${highGroup.avgScore}) vs "${lowGroup.group}" (${lowGroup.avgScore})`,
        data: { dimension: dimensionName, gap: Math.round(gap * 100) / 100, highGroup: highGroup.group, lowGroup: lowGroup.group },
      };
    }
    return null;
  }

  private getAgeGroup(birthDate: Date): string {
    const age = Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (age < 25) return '18-24';
    if (age < 35) return '25-34';
    if (age < 45) return '35-44';
    if (age < 55) return '45-54';
    return '55+';
  }

  private getTenureGroup(hireDate: Date): string {
    const months = Math.floor((Date.now() - hireDate.getTime()) / (30.44 * 24 * 60 * 60 * 1000));
    if (months < 6) return '< 6 meses';
    if (months < 12) return '6-12 meses';
    if (months < 24) return '1-2 años';
    if (months < 60) return '2-5 años';
    return '5+ años';
  }

  private calculateAgeRanges(users: User[], total: number): GroupMetric[] {
    const counts: Record<string, number> = {};
    for (const u of users) {
      const group = u.birthDate ? this.getAgeGroup(new Date(u.birthDate)) : 'Sin especificar';
      counts[group] = (counts[group] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([group, count]) => ({ group, count, percentage: Math.round((count / total) * 1000) / 10 }))
      .sort((a, b) => a.group.localeCompare(b.group));
  }

  private calculateTenureRanges(users: User[], total: number): GroupMetric[] {
    const counts: Record<string, number> = {};
    for (const u of users) {
      const group = u.hireDate ? this.getTenureGroup(new Date(u.hireDate)) : 'Sin especificar';
      counts[group] = (counts[group] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([group, count]) => ({ group, count, percentage: Math.round((count / total) * 1000) / 10 }))
      .sort((a, b) => a.group.localeCompare(b.group));
  }

  private departmentDiversity(users: User[], privacyMin = DEFAULT_PRIVACY_MIN) {
    const depts: Record<string, { total: number; genders: Record<string, number> }> = {};
    for (const u of users) {
      const dept = u.department || 'Sin departamento';
      if (!depts[dept]) depts[dept] = { total: 0, genders: {} };
      depts[dept].total++;
      const g = u.gender || 'Sin especificar';
      depts[dept].genders[g] = (depts[dept].genders[g] || 0) + 1;
    }
    return Object.entries(depts).map(([dept, data]) => ({
      department: dept,
      total: data.total,
      genderBreakdown: Object.entries(data.genders).map(([g, c]) => ({
        gender: g, count: c, percentage: Math.round((c / data.total) * 1000) / 10,
      })),
    }))
    .filter((d) => d.total >= privacyMin) // Privacy: exclude small departments
    .sort((a, b) => b.total - a.total);
  }

  private calculateDataCompleteness(users: User[]) {
    const total = users.length;
    const fields = ['gender', 'birthDate', 'nationality', 'seniorityLevel', 'contractType', 'workLocation'] as const;
    return fields.map((f) => {
      const filled = users.filter((u) => u[f] != null).length;
      return { field: f, filled, total, percentage: Math.round((filled / total) * 1000) / 10 };
    });
  }

  // ─── DEI Configuration ────────────────────────────────────────────────

  async getConfig(tenantId: string) {
    const thresholds = await this.getThresholds(tenantId);
    return thresholds;
  }

  async updateConfig(tenantId: string, config: { privacyMin?: number; mediumThreshold?: number; highThreshold?: number }) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    type DeiConfig = { privacyMin?: number; mediumThreshold?: number; highThreshold?: number };
    const currentDei: DeiConfig = (tenant.settings?.dei as DeiConfig | undefined) || {};

    if (config.privacyMin !== undefined) {
      const val = Number(config.privacyMin);
      if (!Number.isInteger(val) || val < 5 || val > 50) {
        throw new BadRequestException('El mínimo de personas debe ser un entero entre 5 y 50');
      }
      currentDei.privacyMin = val;
    }
    if (config.mediumThreshold !== undefined) {
      const val = Number(config.mediumThreshold);
      if (isNaN(val) || val < 0.5 || val > 5) {
        throw new BadRequestException('El umbral medio debe estar entre 0.5 y 5 puntos');
      }
      currentDei.mediumThreshold = Math.round(val * 10) / 10;
    }
    if (config.highThreshold !== undefined) {
      const val = Number(config.highThreshold);
      if (isNaN(val) || val < 0.5 || val > 5) {
        throw new BadRequestException('El umbral alto debe estar entre 0.5 y 5 puntos');
      }
      currentDei.highThreshold = Math.round(val * 10) / 10;
    }

    // Validate high > medium
    const effectiveMedium = currentDei.mediumThreshold ?? DEFAULT_MEDIUM_THRESHOLD;
    const effectiveHigh = currentDei.highThreshold ?? DEFAULT_HIGH_THRESHOLD;
    if (effectiveHigh <= effectiveMedium) {
      throw new BadRequestException(`El umbral alto (${effectiveHigh}) debe ser mayor al umbral medio (${effectiveMedium})`);
    }

    tenant.settings = { ...(tenant.settings || {}), dei: currentDei };
    await this.tenantRepo.save(tenant);
    return this.getThresholds(tenantId);
  }

  // ─── Corrective Actions CRUD ──────────────────────────────────────────

  async listCorrectiveActions(tenantId: string) {
    return this.correctiveActionRepo.find({
      where: { tenantId },
      relations: ['responsible', 'creator'],
      order: { createdAt: 'DESC' },
    });
  }

  async createCorrectiveAction(tenantId: string, createdBy: string, dto: {
    alertType: string;
    severity: string;
    alertMessage: string;
    cycleId?: string;
    action: string;
    responsibleId?: string;
  }) {
    const ca = this.correctiveActionRepo.create({
      tenantId,
      createdBy,
      alertType: dto.alertType,
      severity: dto.severity,
      alertMessage: dto.alertMessage,
      cycleId: dto.cycleId || null,
      action: dto.action,
      responsibleId: dto.responsibleId || null,
      status: 'pending',
    });
    return this.correctiveActionRepo.save(ca);
  }

  /** P3.3 — Firma tenantId opcional: super_admin cross-tenant → undefined
   *  busca por id sin filtro; la entity.tenantId queda authoritative. */
  async updateCorrectiveAction(tenantId: string | undefined, id: string, dto: {
    status?: string;
    action?: string;
    evidence?: string;
    responsibleId?: string;
  }) {
    const where = tenantId ? { id, tenantId } : { id };
    const ca = await this.correctiveActionRepo.findOne({ where });
    if (!ca) throw new NotFoundException('Acción correctiva no encontrada');
    const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
    if (dto.status !== undefined) {
      if (!VALID_STATUSES.includes(dto.status)) {
        throw new BadRequestException(`Estado no válido: ${dto.status}. Valores permitidos: ${VALID_STATUSES.join(', ')}`);
      }
      ca.status = dto.status;
    }
    if (dto.action !== undefined) ca.action = dto.action;
    if (dto.evidence !== undefined) ca.evidence = dto.evidence;
    if (dto.responsibleId !== undefined) ca.responsibleId = dto.responsibleId;
    return this.correctiveActionRepo.save(ca);
  }
}
