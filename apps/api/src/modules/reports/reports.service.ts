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
      relations: ['evaluator'],
    });

    const results = [];
    for (const assignment of assignments) {
      const response = await this.responseRepo.findOne({
        where: { assignmentId: assignment.id },
      });
      results.push({
        relationType: assignment.relationType,
        evaluatorName: assignment.evaluator
          ? `${assignment.evaluator.firstName} ${assignment.evaluator.lastName}`
          : null,
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
    // Score distribution (buckets of 10)
    const responses = await this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a')
      .where('a.cycleId = :cycleId', { cycleId })
      .andWhere('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL')
      .select('r.overall_score', 'score')
      .getRawMany();

    const buckets = Array.from({ length: 10 }, (_, i) => ({
      range: `${i * 10}-${i * 10 + 10}`,
      count: 0,
    }));
    for (const r of responses) {
      const idx = Math.min(Math.floor(Number(r.score) / 10), 9);
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
