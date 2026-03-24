import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TalentAssessment } from './entities/talent-assessment.entity';
import { CalibrationSession } from './entities/calibration-session.entity';
import { CalibrationEntry } from './entities/calibration-entry.entity';
import { EvaluationAssignment, AssignmentStatus } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { User } from '../users/entities/user.entity';

// Nine Box mapping:
//                 Potencial
//              Bajo    Medio    Alto
// Desempeño
//   Alto  |  6-Enigma | 8-HiPerf | 9-Star    |
//   Medio |  3-Risk   | 5-Core   | 7-HiPoten |
//   Bajo  |  1-Dysfun | 2-Under  | 4-Inconst |

const NINE_BOX_MAP: Record<string, { position: number; pool: string }> = {
  'low-low':    { position: 1, pool: 'dysfunctional' },
  'low-medium': { position: 2, pool: 'underperformer' },
  'low-high':   { position: 4, pool: 'inconsistent' },
  'medium-low': { position: 3, pool: 'risk' },
  'medium-medium': { position: 5, pool: 'core_player' },
  'medium-high':   { position: 7, pool: 'high_potential' },
  'high-low':    { position: 6, pool: 'enigma' },
  'high-medium': { position: 8, pool: 'high_performer' },
  'high-high':   { position: 9, pool: 'star' },
};

const NINE_BOX_LABELS: Record<number, string> = {
  1: 'Bajo rendimiento',
  2: 'Bajo rendimiento con potencial',
  3: 'Riesgo',
  4: 'Inconsistente',
  5: 'Profesional clave',
  6: 'Enigma',
  7: 'Alto potencial',
  8: 'Alto rendimiento',
  9: 'Estrella',
};

// Score scale is 0-10 (from evaluation responses)
// Low: 0-3.9, Medium: 4.0-7.0, High: 7.1-10
function getLevel(score: number): 'low' | 'medium' | 'high' {
  if (score < 4) return 'low';
  if (score <= 7) return 'medium';
  return 'high';
}

@Injectable()
export class TalentService {
  constructor(
    @InjectRepository(TalentAssessment)
    private readonly assessmentRepo: Repository<TalentAssessment>,
    @InjectRepository(CalibrationSession)
    private readonly sessionRepo: Repository<CalibrationSession>,
    @InjectRepository(CalibrationEntry)
    private readonly entryRepo: Repository<CalibrationEntry>,
    @InjectRepository(EvaluationAssignment)
    private readonly assignmentRepo: Repository<EvaluationAssignment>,
    @InjectRepository(EvaluationResponse)
    private readonly responseRepo: Repository<EvaluationResponse>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ─── Nine Box Calculation ──────────────────────────────────────────────

  calculateNineBox(performanceScore: number, potentialScore: number | null): { position: number; pool: string } {
    const potential = potentialScore ?? 50; // default to medium if not assessed
    const perfLevel = getLevel(performanceScore);
    const potLevel = getLevel(potential);
    return NINE_BOX_MAP[`${perfLevel}-${potLevel}`] || { position: 5, pool: 'core_player' };
  }

  // ─── Generate Assessments ─────────────────────────────────────────────

  async generateAssessments(tenantId: string, cycleId: string, assessedBy: string): Promise<TalentAssessment[]> {
    // Get all unique evaluatees in this cycle with completed assignments
    const evaluatees = await this.assignmentRepo
      .createQueryBuilder('a')
      .select('a.evaluatee_id', 'evaluateeId')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.cycle_id = :cycleId', { cycleId })
      .andWhere('a.status = :status', { status: AssignmentStatus.COMPLETED })
      .groupBy('a.evaluatee_id')
      .getRawMany();

    const results: TalentAssessment[] = [];

    for (const { evaluateeId } of evaluatees) {
      // Calculate average score from all completed responses for this evaluatee
      const avgResult = await this.responseRepo
        .createQueryBuilder('r')
        .innerJoin('r.assignment', 'a')
        .select('AVG(r.overall_score)', 'avgScore')
        .where('a.evaluatee_id = :evaluateeId', { evaluateeId })
        .andWhere('a.cycle_id = :cycleId', { cycleId })
        .andWhere('a.tenant_id = :tenantId', { tenantId })
        .andWhere('r.overall_score IS NOT NULL')
        .getRawOne();

      const performanceScore = Number(avgResult?.avgScore || 0);

      // Check if assessment already exists
      let assessment = await this.assessmentRepo.findOne({
        where: { tenantId, cycleId, userId: evaluateeId },
      });

      const nineBox = this.calculateNineBox(performanceScore, assessment?.potentialScore ?? null);

      if (assessment) {
        assessment.performanceScore = performanceScore;
        assessment.nineBoxPosition = nineBox.position;
        assessment.talentPool = nineBox.pool;
      } else {
        assessment = this.assessmentRepo.create({
          tenantId,
          cycleId,
          userId: evaluateeId,
          performanceScore,
          potentialScore: null,
          nineBoxPosition: nineBox.position,
          talentPool: nineBox.pool,
          assessedBy,
        });
      }

      results.push(await this.assessmentRepo.save(assessment));
    }

    return results;
  }

  // ─── CRUD Assessments ─────────────────────────────────────────────────

  async findByCycle(tenantId: string, cycleId: string): Promise<TalentAssessment[]> {
    return this.assessmentRepo.find({
      where: { tenantId, cycleId },
      relations: ['user'],
      order: { performanceScore: 'DESC' },
    });
  }

  async findByUser(tenantId: string, userId: string): Promise<TalentAssessment[]> {
    return this.assessmentRepo.find({
      where: { tenantId, userId },
      relations: ['cycle'],
      order: { createdAt: 'DESC' },
    });
  }

  async updateAssessment(id: string, dto: any, assessedBy: string): Promise<TalentAssessment> {
    const assessment = await this.assessmentRepo.findOne({ where: { id }, relations: ['user'] });
    if (!assessment) throw new NotFoundException('Assessment no encontrado');

    if (dto.potentialScore !== undefined) assessment.potentialScore = dto.potentialScore;
    if (dto.readiness !== undefined) assessment.readiness = dto.readiness;
    if (dto.flightRisk !== undefined) assessment.flightRisk = dto.flightRisk;
    if (dto.notes !== undefined) assessment.notes = dto.notes;
    assessment.assessedBy = assessedBy;

    // Recalculate nine box
    const nineBox = this.calculateNineBox(assessment.performanceScore, assessment.potentialScore);
    assessment.nineBoxPosition = nineBox.position;
    assessment.talentPool = nineBox.pool;

    return this.assessmentRepo.save(assessment);
  }

  async getNineBoxSummary(tenantId: string, cycleId: string): Promise<any> {
    const assessments = await this.findByCycle(tenantId, cycleId);

    const boxes: Record<number, { position: number; label: string; count: number; users: any[] }> = {};
    for (let i = 1; i <= 9; i++) {
      boxes[i] = { position: i, label: NINE_BOX_LABELS[i], count: 0, users: [] };
    }

    for (const a of assessments) {
      const pos = a.nineBoxPosition || 5;
      boxes[pos].count++;
      boxes[pos].users.push({
        id: a.id,
        userId: a.userId,
        firstName: a.user?.firstName,
        lastName: a.user?.lastName,
        department: a.user?.department,
        position: a.user?.position,
        performanceScore: a.performanceScore,
        potentialScore: a.potentialScore,
        talentPool: a.talentPool,
        readiness: a.readiness,
        flightRisk: a.flightRisk,
      });
    }

    return { boxes, total: assessments.length };
  }

  async getSegmentation(tenantId: string, cycleId: string): Promise<any> {
    const assessments = await this.findByCycle(tenantId, cycleId);

    const byPool: Record<string, number> = {};
    const byReadiness: Record<string, number> = {};
    const byRisk: Record<string, number> = {};

    for (const a of assessments) {
      const pool = a.talentPool || 'unassessed';
      byPool[pool] = (byPool[pool] || 0) + 1;
      if (a.readiness) byReadiness[a.readiness] = (byReadiness[a.readiness] || 0) + 1;
      if (a.flightRisk) byRisk[a.flightRisk] = (byRisk[a.flightRisk] || 0) + 1;
    }

    return { byPool, byReadiness, byRisk, total: assessments.length };
  }

  // ─── Calibration Sessions ─────────────────────────────────────────────

  async createSession(tenantId: string, dto: any): Promise<CalibrationSession> {
    const session = this.sessionRepo.create({
      tenantId,
      cycleId: dto.cycleId,
      name: dto.name,
      department: dto.department || null,
      moderatorId: dto.moderatorId,
      status: 'draft',
      notes: dto.notes || null,
    });
    return this.sessionRepo.save(session);
  }

  async findSessions(tenantId: string, cycleId?: string): Promise<CalibrationSession[]> {
    const where: any = { tenantId };
    if (cycleId) where.cycleId = cycleId;
    return this.sessionRepo.find({
      where,
      relations: ['cycle', 'moderator'],
      order: { createdAt: 'DESC' },
    });
  }

  async getSessionDetail(id: string): Promise<any> {
    const session = await this.sessionRepo.findOne({
      where: { id },
      relations: ['cycle', 'moderator'],
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');

    const entries = await this.entryRepo.find({
      where: { sessionId: id },
      relations: ['user'],
      order: { originalScore: 'DESC' },
    });

    return { ...session, entries };
  }

  async populateEntries(sessionId: string): Promise<CalibrationEntry[]> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sesión no encontrada');

    // Get assessments for this cycle (filtered by department if set)
    const qb = this.assessmentRepo.createQueryBuilder('ta')
      .leftJoinAndSelect('ta.user', 'u')
      .where('ta.tenant_id = :tenantId', { tenantId: session.tenantId })
      .andWhere('ta.cycle_id = :cycleId', { cycleId: session.cycleId });

    if (session.department) {
      qb.andWhere('u.department = :dept', { dept: session.department });
    }

    const assessments = await qb.getMany();

    const entries: CalibrationEntry[] = [];
    for (const a of assessments) {
      // Skip if entry already exists
      const existing = await this.entryRepo.findOne({
        where: { sessionId, userId: a.userId },
      });
      if (existing) {
        entries.push(existing);
        continue;
      }

      const entry = this.entryRepo.create({
        sessionId,
        userId: a.userId,
        originalScore: a.performanceScore,
        originalPotential: a.potentialScore,
        status: 'pending',
      });
      entries.push(await this.entryRepo.save(entry));
    }

    // Update session status
    session.status = 'in_progress';
    await this.sessionRepo.save(session);

    return entries;
  }

  async updateEntry(entryId: string, dto: any, discussedBy: string): Promise<CalibrationEntry> {
    const entry = await this.entryRepo.findOne({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Entry no encontrada');

    if (dto.adjustedScore !== undefined) entry.adjustedScore = dto.adjustedScore;
    if (dto.adjustedPotential !== undefined) entry.adjustedPotential = dto.adjustedPotential;
    if (dto.rationale !== undefined) entry.rationale = dto.rationale;
    entry.status = 'discussed';
    entry.discussedBy = discussedBy;

    return this.entryRepo.save(entry);
  }

  async completeSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sesión no encontrada');

    const entries = await this.entryRepo.find({ where: { sessionId } });

    // Apply adjusted scores to talent assessments
    for (const entry of entries) {
      if (entry.adjustedScore == null && entry.adjustedPotential == null) continue;

      const assessment = await this.assessmentRepo.findOne({
        where: { tenantId: session.tenantId, cycleId: session.cycleId, userId: entry.userId },
      });
      if (!assessment) continue;

      if (entry.adjustedScore != null) assessment.performanceScore = entry.adjustedScore;
      if (entry.adjustedPotential != null) assessment.potentialScore = entry.adjustedPotential;

      const nineBox = this.calculateNineBox(assessment.performanceScore, assessment.potentialScore);
      assessment.nineBoxPosition = nineBox.position;
      assessment.talentPool = nineBox.pool;

      await this.assessmentRepo.save(assessment);
    }

    // Mark all entries as agreed
    await this.entryRepo.update({ sessionId }, { status: 'agreed' });

    session.status = 'completed';
    await this.sessionRepo.save(session);
  }
}
