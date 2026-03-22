import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment, AssignmentStatus } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
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
}
