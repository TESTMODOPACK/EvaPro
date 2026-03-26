import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';

const PRIVACY_MIN = 5; // Minimum group size for DEI metrics

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
  ) {}

  // ─── Demographic Composition ────────────────────────────────────────

  async getDemographicOverview(tenantId: string) {
    const users = await this.userRepo.find({
      where: { tenantId, isActive: true },
      select: ['id', 'gender', 'birthDate', 'nationality', 'department', 'position',
        'seniorityLevel', 'contractType', 'workLocation', 'hireDate', 'role'],
    });

    const total = users.length;
    if (total === 0) return { total: 0, message: 'Sin usuarios activos' };

    return {
      total,
      gender: this.groupBy(users, 'gender', total),
      seniority: this.groupBy(users, 'seniorityLevel', total),
      contractType: this.groupBy(users, 'contractType', total),
      workLocation: this.groupBy(users, 'workLocation', total),
      nationality: this.groupBy(users, 'nationality', total),
      ageRanges: this.calculateAgeRanges(users, total),
      tenureRanges: this.calculateTenureRanges(users, total),
      departmentBreakdown: this.departmentDiversity(users),
      dataCompleteness: this.calculateDataCompleteness(users),
    };
  }

  // ─── Evaluation Equity Analysis ─────────────────────────────────────

  async getEquityAnalysis(tenantId: string, cycleId: string) {
    // Get all completed responses with evaluatee demographics
    const rows = await this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
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
    const genderScores = this.groupScores(rows, 'gender');
    const genderAlert = this.detectBias(genderScores, 'Género');
    if (genderAlert) alerts.push(genderAlert);

    // Seniority equity
    const seniorityScores = this.groupScores(rows, 'seniority');
    const seniorityAlert = this.detectBias(seniorityScores, 'Nivel de seniority');
    if (seniorityAlert) alerts.push(seniorityAlert);

    // Age equity
    const rowsWithAge = rows.map((r) => ({
      ...r,
      ageGroup: r.birthDate ? this.getAgeGroup(new Date(r.birthDate)) : null,
    }));
    const ageScores = this.groupScores(rowsWithAge, 'ageGroup');
    const ageAlert = this.detectBias(ageScores, 'Rango etario');
    if (ageAlert) alerts.push(ageAlert);

    // Tenure equity
    const rowsWithTenure = rows.map((r) => ({
      ...r,
      tenureGroup: r.hireDate ? this.getTenureGroup(new Date(r.hireDate)) : null,
    }));
    const tenureScores = this.groupScores(rowsWithTenure, 'tenureGroup');
    const tenureAlert = this.detectBias(tenureScores, 'Antigüedad');
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
    const validDimensions = ['gender', 'seniority', 'department', 'nationality'];
    const col = validDimensions.includes(dimension) ? dimension : 'gender';
    const colMap: Record<string, string> = { gender: 'u.gender', seniority: 'u.seniority_level', department: 'u.department', nationality: 'u.nationality' };

    const rows = await this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
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
      .having('COUNT(DISTINCT u.id) >= :min', { min: PRIVACY_MIN })
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
      privacyThreshold: PRIVACY_MIN,
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

  private groupScores(rows: any[], field: string) {
    const groups: Record<string, number[]> = {};
    for (const r of rows) {
      const val = r[field] || 'Sin especificar';
      if (!groups[val]) groups[val] = [];
      groups[val].push(Number(r.score));
    }

    return Object.entries(groups)
      .filter(([_, scores]) => scores.length >= PRIVACY_MIN)
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

  private detectBias(groupScores: any[], dimensionName: string) {
    if (groupScores.length < 2) return null;
    const maxAvg = Math.max(...groupScores.map((g: any) => g.avgScore));
    const minAvg = Math.min(...groupScores.map((g: any) => g.avgScore));
    const gap = maxAvg - minAvg;

    if (gap >= 1.5) {
      const highGroup = groupScores.find((g: any) => g.avgScore === maxAvg);
      const lowGroup = groupScores.find((g: any) => g.avgScore === minAvg);
      return {
        type: 'score_gap',
        severity: gap >= 2.0 ? 'high' : 'medium',
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

  private departmentDiversity(users: User[]) {
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
    .filter((d) => d.total >= PRIVACY_MIN) // Privacy: exclude small departments
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
}
