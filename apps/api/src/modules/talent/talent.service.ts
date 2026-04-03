import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TalentAssessment } from './entities/talent-assessment.entity';
import { CalibrationSession } from './entities/calibration-session.entity';
import { CalibrationEntry } from './entities/calibration-entry.entity';
import { EvaluationAssignment, AssignmentStatus } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../audit/audit.service';

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
    private readonly auditService: AuditService,
  ) {}

  // ─── Nine Box Calculation ──────────────────────────────────────────────

  calculateNineBox(performanceScore: number, potentialScore: number | null): { position: number; pool: string } {
    const potential = potentialScore ?? 5; // default to medium on 0-10 scale if not assessed
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

  async findByCycle(tenantId: string, cycleId: string, managerId?: string): Promise<TalentAssessment[]> {
    const qb = this.assessmentRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.user', 'u')
      .where('a.tenantId = :tenantId', { tenantId })
      .andWhere('a.cycleId = :cycleId', { cycleId })
      .orderBy('a.performanceScore', 'DESC');

    // Manager scope: only show their direct reports
    if (managerId) {
      qb.andWhere('u.managerId = :managerId', { managerId });
    }

    return qb.getMany();
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

    // B8.2: Fresh justification is mandatory on every potential score change
    if (dto.potentialScore !== undefined) {
      if (!dto.potentialJustification || dto.potentialJustification.trim().length === 0) {
        throw new BadRequestException(
          'La evaluación de potencial requiere una justificación textual. Explique las razones de la calificación asignada.',
        );
      }
      assessment.potentialScore = dto.potentialScore;
      assessment.potentialJustification = dto.potentialJustification;
    } else if (dto.potentialJustification !== undefined) {
      assessment.potentialJustification = dto.potentialJustification;
    }
    if (dto.readiness !== undefined) assessment.readiness = dto.readiness;
    if (dto.flightRisk !== undefined) assessment.flightRisk = dto.flightRisk;
    if (dto.notes !== undefined) assessment.notes = dto.notes;
    assessment.assessedBy = assessedBy;

    // Recalculate nine box
    const nineBox = this.calculateNineBox(assessment.performanceScore, assessment.potentialScore);
    assessment.nineBoxPosition = nineBox.position;
    assessment.talentPool = nineBox.pool;

    const saved = await this.assessmentRepo.save(assessment);
    this.auditService.log(assessment.tenantId, assessedBy, 'talent.assessed', 'talent_assessment', assessment.id, {
      userName: assessment.user ? assessment.user.firstName + ' ' + assessment.user.lastName : assessment.userId,
      performanceScore: assessment.performanceScore,
      potentialScore: assessment.potentialScore,
      nineBoxPosition: nineBox.pool,
      assessedBy,
    }).catch(() => {});
    return saved;
  }

  async getNineBoxSummary(tenantId: string, cycleId: string, managerId?: string): Promise<any> {
    const assessments = await this.findByCycle(tenantId, cycleId, managerId);

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

  async getSegmentation(tenantId: string, cycleId: string, managerId?: string): Promise<any> {
    const assessments = await this.findByCycle(tenantId, cycleId, managerId);

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

  async getSessionDetail(id: string, tenantId?: string): Promise<any> {
    const whereClause: any = { id };
    if (tenantId) whereClause.tenantId = tenantId;
    const session = await this.sessionRepo.findOne({
      where: whereClause,
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

  async populateEntries(sessionId: string, tenantId?: string): Promise<CalibrationEntry[]> {
    const whereClause: any = { id: sessionId };
    if (tenantId) whereClause.tenantId = tenantId;
    const session = await this.sessionRepo.findOne({ where: whereClause });
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

    // B1.5: Require rationale if score change exceeds 1 point
    if (dto.adjustedScore !== undefined) {
      const scoreDiff = Math.abs(Number(dto.adjustedScore) - Number(entry.originalScore));
      if (scoreDiff > 1 && (!dto.rationale || dto.rationale.trim().length === 0)) {
        throw new BadRequestException(
          `El ajuste de puntaje supera 1 punto (${Number(entry.originalScore).toFixed(1)} → ${Number(dto.adjustedScore).toFixed(1)}). Debe incluir una justificación.`,
        );
      }
      // P2-#22: Score change >2 points requires CHRO/admin approval
      if (scoreDiff > 2) {
        entry.approvalStatus = 'pending_approval';
        entry.approvalRequired = true;
      }
    }
    if (dto.adjustedPotential !== undefined && entry.originalPotential != null) {
      const potDiff = Math.abs(Number(dto.adjustedPotential) - Number(entry.originalPotential));
      if (potDiff > 1 && (!dto.rationale || dto.rationale.trim().length === 0)) {
        throw new BadRequestException(
          `El ajuste de potencial supera 1 punto. Debe incluir una justificación.`,
        );
      }
      // Same rule for potential
      if (potDiff > 2) {
        entry.approvalStatus = 'pending_approval';
        entry.approvalRequired = true;
      }
    }

    // Gap 5: Record all changes in changelog for audit
    const log = Array.isArray(entry.changeLog) ? [...entry.changeLog] : [];
    const now = new Date().toISOString();

    if (dto.adjustedScore !== undefined && dto.adjustedScore !== entry.adjustedScore) {
      log.push({
        date: now,
        userId: discussedBy,
        field: 'adjustedScore',
        from: entry.adjustedScore,
        to: dto.adjustedScore,
        rationale: dto.rationale || undefined,
      });
      entry.adjustedScore = dto.adjustedScore;
    }
    if (dto.adjustedPotential !== undefined && dto.adjustedPotential !== entry.adjustedPotential) {
      log.push({
        date: now,
        userId: discussedBy,
        field: 'adjustedPotential',
        from: entry.adjustedPotential,
        to: dto.adjustedPotential,
        rationale: dto.rationale || undefined,
      });
      entry.adjustedPotential = dto.adjustedPotential;
    }
    if (dto.rationale !== undefined) entry.rationale = dto.rationale;
    entry.changeLog = log;
    entry.status = 'discussed';
    entry.discussedBy = discussedBy;

    const saved = await this.entryRepo.save(entry);
    // Get tenantId from session for audit
    const session = await this.sessionRepo.findOne({ where: { id: entry.sessionId }, select: ['id', 'tenantId'] });
    this.auditService.log(session?.tenantId || null, discussedBy, 'calibration.entry_adjusted', 'calibration_entry', entry.id, {
      originalScore: entry.originalScore, adjustedScore: entry.adjustedScore,
      rationale: dto.rationale, discussedBy,
    }).catch(() => {});
    return saved;
  }

  async approveCalibrationChange(entryId: string, approvedBy: string, approved: boolean): Promise<CalibrationEntry> {
    const entry = await this.entryRepo.findOne({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Entry no encontrada');
    if (entry.approvalStatus !== 'pending_approval') {
      throw new BadRequestException('Esta entrada no requiere aprobación o ya fue procesada');
    }
    entry.approvalStatus = approved ? 'approved' : 'rejected';
    entry.approvedBy = approvedBy;
    if (!approved) {
      // Revert to original scores
      entry.adjustedScore = entry.originalScore;
      entry.adjustedPotential = entry.originalPotential;
    }
    return this.entryRepo.save(entry);
  }

  async completeSession(sessionId: string, tenantId?: string): Promise<void> {
    const whereClause: any = { id: sessionId };
    if (tenantId) whereClause.tenantId = tenantId;
    const session = await this.sessionRepo.findOne({ where: whereClause });
    if (!session) throw new NotFoundException('Sesión no encontrada');

    const entries = await this.entryRepo.find({ where: { sessionId } });

    // P2-#21: Quorum validation
    const distinctParticipants = new Set(entries.filter((e) => e.discussedBy).map((e) => e.discussedBy));
    if (distinctParticipants.size < session.minQuorum) {
      throw new BadRequestException(
        `Se requiere un quórum mínimo de ${session.minQuorum} managers. Solo ${distinctParticipants.size} han participado.`,
      );
    }

    // P2-#22: Check no pending approvals
    const pendingApprovals = entries.filter((e) => e.approvalStatus === 'pending_approval');
    if (pendingApprovals.length > 0) {
      throw new BadRequestException(
        `Hay ${pendingApprovals.length} ajuste(s) pendientes de aprobación. Deben resolverse antes de completar la sesión.`,
      );
    }

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

    await this.entryRepo.update({ sessionId }, { status: 'agreed' });
    session.status = 'completed';
    await this.sessionRepo.save(session);
  }

  // ─── P2-#20: Distribution Analysis ──────────────────────────────────────

  async getDistributionAnalysis(sessionId: string) {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sesión no encontrada');

    const entries = await this.entryRepo.find({
      where: { sessionId },
      relations: ['user'],
    });

    const scores = entries
      .map((e) => Number(e.adjustedScore ?? e.originalScore))
      .filter((s) => !isNaN(s));

    if (scores.length === 0) {
      return { sessionId, distribution: [], expectedVsActual: [], message: 'Sin scores disponibles' };
    }

    const totalCount = scores.length;
    const actualMin = Math.min(...scores);
    const actualMax = Math.max(...scores);

    // Use ABSOLUTE ranges (0-2, 2-4, 4-6, 6-8, 8-10) for meaningful distribution
    const bucketLabels = ['Bajo (0-2)', 'Medio-Bajo (2-4)', 'Medio (4-6)', 'Medio-Alto (6-8)', 'Alto (8-10)'];
    const bucketRanges = [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10]];
    const bucketCounts = [0, 0, 0, 0, 0];

    for (const s of scores) {
      // Clamp to 0-10 range and classify
      const clamped = Math.max(0, Math.min(10, s));
      const idx = Math.min(Math.floor(clamped / 2), 4);
      bucketCounts[idx]++;
    }

    const actualDistribution = bucketCounts.map((c) => Math.round((c / totalCount) * 100));

    // Expected distribution (configurable per session or default bell curve)
    const expected = session.expectedDistribution || { low: 10, midLow: 20, mid: 40, midHigh: 20, high: 10 };
    const expectedArr = [expected.low, expected.midLow, expected.mid, expected.midHigh, expected.high];

    const expectedVsActual = bucketLabels.map((label, i) => ({
      bucket: label,
      rangeMin: bucketRanges[i][0],
      rangeMax: bucketRanges[i][1],
      actualCount: bucketCounts[i],
      actualPercent: actualDistribution[i],
      expectedPercent: expectedArr[i],
      deviation: actualDistribution[i] - expectedArr[i],
    }));

    // Chi-squared goodness-of-fit test (df=4, p=0.05 critical value = 9.49)
    const chiSquared = expectedVsActual.reduce((sum, b) => {
      const expectedCount = (b.expectedPercent / 100) * totalCount;
      if (expectedCount === 0) return sum;
      return sum + Math.pow(b.actualCount - expectedCount, 2) / expectedCount;
    }, 0);

    return {
      sessionId,
      totalEntries: totalCount,
      scoreRange: { min: Math.round(actualMin * 100) / 100, max: Math.round(actualMax * 100) / 100 },
      expectedVsActual,
      chiSquared: Math.round(chiSquared * 100) / 100,
      distributionFit: chiSquared < 9.49 ? 'aceptable' : 'desviada',
    };
  }

  // ─── P2-#23: Calibration PDF ────────────────────────────────────────────

  async generateCalibrationPdf(sessionId: string): Promise<Buffer> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['moderator', 'cycle'],
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');

    const entries = await this.entryRepo.find({
      where: { sessionId },
      relations: ['user', 'discusser'],
      order: { createdAt: 'ASC' },
    });

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('ACTA DE CALIBRACIÓN', pageWidth / 2, 20, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Sesión: ${session.name}`, 14, 35);
    doc.text(`Ciclo: ${session.cycle?.name || 'N/A'}`, 14, 41);
    doc.text(`Departamento: ${session.department || 'General'}`, 14, 47);
    doc.text(`Moderador: ${session.moderator ? `${session.moderator.firstName} ${session.moderator.lastName}` : 'N/A'}`, 14, 53);
    doc.text(`Estado: ${session.status}`, 14, 59);
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' })}`, 14, 65);

    // Participants (deduplicate by UUID, not object reference)
    const participantIds = [...new Set(entries.filter((e) => e.discussedBy).map((e) => e.discussedBy))];
    const participants = participantIds.map((pid) => entries.find((e) => e.discussedBy === pid)?.discusser).filter(Boolean);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Participantes', 14, 78);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const partNames = participants.map((p) => p ? `${p.firstName} ${p.lastName}` : 'N/A').join(', ') || 'Sin participantes registrados';
    doc.text(partNames, 14, 84, { maxWidth: pageWidth - 28 });

    // Results table
    const tableData = entries.map((e) => [
      e.user ? `${e.user.firstName} ${e.user.lastName}` : 'N/A',
      Number(e.originalScore).toFixed(1),
      e.adjustedScore != null ? Number(e.adjustedScore).toFixed(1) : '—',
      e.adjustedScore != null ? (Number(e.adjustedScore) - Number(e.originalScore) >= 0 ? '+' : '') + (Number(e.adjustedScore) - Number(e.originalScore)).toFixed(1) : '—',
      e.rationale || '—',
      e.approvalRequired ? (e.approvalStatus === 'approved' ? 'Aprobado' : e.approvalStatus === 'rejected' ? 'Rechazado' : 'Pendiente') : '—',
    ]);

    (autoTable as any)(doc, {
      startY: 94,
      head: [['Evaluado', 'Score Original', 'Score Ajustado', 'Diferencia', 'Justificación', 'Aprobación']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [41, 98, 255], fontSize: 8 },
      bodyStyles: { fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 35 },
        4: { cellWidth: 45 },
      },
      margin: { left: 14, right: 14 },
    });

    // Notes
    const finalY = (doc as any).lastAutoTable?.finalY || 200;
    if (session.notes) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Notas', 14, finalY + 12);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(session.notes, 14, finalY + 18, { maxWidth: pageWidth - 28 });
    }

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      const footerY = doc.internal.pageSize.getHeight() - 8;
      doc.text(`Acta de Calibración — ${session.name} — Generado por EvaPro`, 14, footerY);
      doc.text(`Página ${p} de ${pageCount}`, pageWidth - 14, footerY, { align: 'right' });
    }

    return Buffer.from(doc.output('arraybuffer'));
  }

  // ─── Export ────────────────────────────────────────────────────────────

  private escapeCsv(val: any): string {
    const str = String(val ?? '');
    return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
  }

  private readonly poolLabels: Record<string, string> = {
    star: 'Estrella', high_performer: 'Alto Rendimiento', core_player: 'Pilar',
    high_potential: 'Alto Potencial', enigma: 'Enigma', risk: 'En Riesgo',
    inconsistent: 'Inconsistente', underperformer: 'Bajo Rendimiento', dysfunctional: 'Disfuncional',
  };
  private readonly readinessLabels: Record<string, string> = {
    ready_now: 'Listo ahora', ready_1_year: 'Listo en 1 año', ready_2_years: 'Listo en 2 años', not_ready: 'No listo',
  };
  private readonly riskLabels: Record<string, string> = { high: 'Alto', medium: 'Medio', low: 'Bajo' };

  async exportTalentCsv(tenantId: string, cycleId: string, managerId?: string): Promise<string> {
    const assessments = await this.findByCycle(tenantId, cycleId, managerId);
    const rows: string[] = [];
    rows.push('Nombre,Departamento,Cargo,Desempeño,Potencial,Posición 9-Box,Pool,Disponibilidad,Riesgo Fuga,Notas');
    for (const a of assessments) {
      const name = a.user ? `${a.user.firstName || ''} ${a.user.lastName || ''}`.trim() : '';
      rows.push([
        this.escapeCsv(name), this.escapeCsv((a.user as any)?.department || ''),
        this.escapeCsv((a.user as any)?.position || ''),
        a.performanceScore?.toFixed(1) ?? '', a.potentialScore?.toFixed(1) ?? '',
        a.nineBoxPosition ?? '', (a.talentPool ? this.poolLabels[a.talentPool] : '') || a.talentPool || '',
        (a.readiness ? this.readinessLabels[a.readiness] : '') || a.readiness || '',
        (a.flightRisk ? this.riskLabels[a.flightRisk] : '') || a.flightRisk || '',
        this.escapeCsv(a.notes || ''),
      ].join(','));
    }
    return '\uFEFF' + rows.join('\n');
  }

  async exportTalentXlsx(tenantId: string, cycleId: string, managerId?: string): Promise<Buffer> {
    const assessments = await this.findByCycle(tenantId, cycleId, managerId);
    const segmentation = await this.getSegmentation(tenantId, cycleId, managerId);

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const accent = { argb: 'FFC9933A' };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const headerFill: any = { type: 'pattern', pattern: 'solid', fgColor: accent };

    // Sheet 1: Resumen
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 22 }, { width: 15 }];
    ws1.addRow(['Mapa de Talento']).font = { bold: true, size: 14 };
    ws1.addRow([]);
    ws1.addRow(['Total evaluados', assessments.length]);
    ws1.addRow(['Fecha exportación', new Date().toLocaleDateString('es-CL')]);
    ws1.addRow([]);
    ws1.addRow(['Distribución por Pool']).font = { bold: true };
    for (const [pool, count] of Object.entries(segmentation.byPool || {})) {
      ws1.addRow([this.poolLabels[pool] || pool, count]);
    }
    ws1.addRow([]);
    ws1.addRow(['Distribución por Riesgo de Fuga']).font = { bold: true };
    for (const [risk, count] of Object.entries(segmentation.byRisk || {})) {
      ws1.addRow([this.riskLabels[risk] || risk, count]);
    }

    // Sheet 2: Detalle
    const ws2 = wb.addWorksheet('Evaluaciones');
    ws2.columns = [
      { width: 25 }, { width: 18 }, { width: 18 }, { width: 12 },
      { width: 12 }, { width: 8 }, { width: 18 }, { width: 16 }, { width: 12 },
    ];
    const h2 = ws2.addRow(['Nombre', 'Departamento', 'Cargo', 'Desempeño', 'Potencial', 'Pos.', 'Pool', 'Disponibilidad', 'Riesgo']);
    h2.eachCell((cell) => { cell.font = headerFont; cell.fill = headerFill; });
    for (const a of assessments) {
      const name = a.user ? `${a.user.firstName || ''} ${a.user.lastName || ''}`.trim() : '';
      ws2.addRow([
        name, (a.user as any)?.department || '', (a.user as any)?.position || '',
        a.performanceScore?.toFixed(1) ?? '', a.potentialScore?.toFixed(1) ?? '',
        a.nineBoxPosition ?? '', (a.talentPool ? this.poolLabels[a.talentPool] : '') || a.talentPool || '',
        (a.readiness ? this.readinessLabels[a.readiness] : '') || a.readiness || '',
        (a.flightRisk ? this.riskLabels[a.flightRisk] : '') || a.flightRisk || '',
      ]);
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async exportTalentPdf(tenantId: string, cycleId: string, managerId?: string): Promise<Buffer> {
    const assessments = await this.findByCycle(tenantId, cycleId, managerId);
    const segmentation = await this.getSegmentation(tenantId, cycleId, managerId);

    const doc = new jsPDF('l', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;

    // Header
    doc.setFillColor(26, 18, 6);
    doc.rect(0, 0, pageW, 30, 'F');
    doc.setTextColor(245, 228, 168);
    doc.setFontSize(16);
    doc.text('Mapa de Talento — 9-Box', margin, 16);
    doc.setFontSize(9);
    doc.setTextColor(201, 147, 58);
    doc.text(`${assessments.length} colaboradores evaluados — ${new Date().toLocaleDateString('es-CL')}`, margin, 24);

    let y = 38;

    // Pool distribution KPIs
    const pools = Object.entries(segmentation.byPool || {}).sort((a, b) => (b[1] as number) - (a[1] as number));
    const topPools = pools.slice(0, 5);
    if (topPools.length > 0) {
      const kpiW = (pageW - 2 * margin - (topPools.length - 1) * 4) / topPools.length;
      topPools.forEach(([pool, count], i) => {
        const x = margin + i * (kpiW + 4);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(x, y, kpiW, 18, 2, 2, 'F');
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(this.poolLabels[pool] || pool, x + kpiW / 2, y + 7, { align: 'center' });
        doc.setFontSize(12);
        doc.setTextColor(26, 18, 6);
        doc.text(String(count), x + kpiW / 2, y + 15, { align: 'center' });
      });
      y += 26;
    }

    // Table
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Nombre', 'Depto.', 'Desempeño', 'Potencial', 'Pos.', 'Pool', 'Disponibilidad', 'Riesgo']],
      body: assessments.map((a) => {
        const name = a.user ? `${a.user.firstName || ''} ${a.user.lastName || ''}`.trim() : '';
        return [
          name, (a.user as any)?.department || '',
          a.performanceScore?.toFixed(1) ?? '-', a.potentialScore?.toFixed(1) ?? '-',
          String(a.nineBoxPosition ?? '-'), (a.talentPool ? this.poolLabels[a.talentPool] : '') || a.talentPool || '-',
          (a.readiness ? this.readinessLabels[a.readiness] : '') || a.readiness || '-',
          (a.flightRisk ? this.riskLabels[a.flightRisk] : '') || a.flightRisk || '-',
        ];
      }),
      headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} — Ascenda Performance`, margin, doc.internal.pageSize.getHeight() - 8);
      doc.text(`Página ${i} de ${pageCount}`, pageW - margin, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
    }

    return Buffer.from(doc.output('arraybuffer'));
  }
}
