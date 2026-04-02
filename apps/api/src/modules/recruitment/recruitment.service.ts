import {
  Injectable, NotFoundException, BadRequestException,
  ForbiddenException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { RecruitmentProcess, ProcessStatus } from './entities/recruitment-process.entity';
import { RecruitmentCandidate, CandidateStage } from './entities/recruitment-candidate.entity';
import { RecruitmentEvaluator } from './entities/recruitment-evaluator.entity';
import { RecruitmentInterview } from './entities/recruitment-interview.entity';
import { User } from '../users/entities/user.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { AiInsightsService } from '../ai-insights/ai-insights.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class RecruitmentService {
  private readonly logger = new Logger(RecruitmentService.name);

  constructor(
    @InjectRepository(RecruitmentProcess) private readonly processRepo: Repository<RecruitmentProcess>,
    @InjectRepository(RecruitmentCandidate) private readonly candidateRepo: Repository<RecruitmentCandidate>,
    @InjectRepository(RecruitmentEvaluator) private readonly evaluatorRepo: Repository<RecruitmentEvaluator>,
    @InjectRepository(RecruitmentInterview) private readonly interviewRepo: Repository<RecruitmentInterview>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(EvaluationAssignment) private readonly evalAssignmentRepo: Repository<EvaluationAssignment>,
    @InjectRepository(EvaluationResponse) private readonly evalResponseRepo: Repository<EvaluationResponse>,
    @InjectRepository(TalentAssessment) private readonly talentRepo: Repository<TalentAssessment>,
    private readonly aiInsightsService: AiInsightsService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Processes CRUD ───────────────────────────────────────────────────

  async createProcess(tenantId: string, creatorId: string, dto: any): Promise<RecruitmentProcess> {
    if (!dto.processType || !['external', 'internal'].includes(dto.processType)) {
      throw new BadRequestException('Tipo de proceso requerido: external o internal');
    }
    if (!dto.title?.trim() || !dto.position?.trim()) {
      throw new BadRequestException('Titulo y cargo son requeridos');
    }

    const process = this.processRepo.create({
      tenantId,
      processType: dto.processType,
      title: dto.title.trim(),
      position: dto.position.trim(),
      department: dto.department || null,
      description: dto.description || null,
      requirements: Array.isArray(dto.requirements) ? dto.requirements : [],
      requireCvForInternal: dto.requireCvForInternal ?? false,
      scoringWeights: dto.scoringWeights ?? { history: 40, interview: 60 },
      startDate: dto.startDate || null,
      endDate: dto.endDate || null,
      createdBy: creatorId,
    });
    const saved = await this.processRepo.save(process);

    // Add evaluators
    if (dto.evaluatorIds?.length) {
      const evaluators = dto.evaluatorIds.map((evaluatorId: string) =>
        this.evaluatorRepo.create({ processId: saved.id, evaluatorId }),
      );
      await this.evaluatorRepo.save(evaluators);
    }

    await this.auditService.log(tenantId, creatorId, 'recruitment.process_created', 'recruitment_process', saved.id, { title: dto.title });
    return this.getProcess(tenantId, saved.id);
  }

  async listProcesses(tenantId: string, status?: string): Promise<any[]> {
    const where: any = { tenantId };
    if (status) where.status = status;

    const processes = await this.processRepo.find({
      where,
      relations: ['creator'],
      order: { createdAt: 'DESC' },
    });

    const result = [];
    for (const p of processes) {
      const candidateCount = await this.candidateRepo.count({ where: { processId: p.id } });
      result.push({ ...p, candidateCount });
    }
    return result;
  }

  async getProcess(tenantId: string, id: string): Promise<any> {
    const process = await this.processRepo.findOne({
      where: { id, tenantId },
      relations: ['creator'],
    });
    if (!process) throw new NotFoundException('Proceso no encontrado');

    const candidates = await this.candidateRepo.find({
      where: { processId: id },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });

    const evaluators = await this.evaluatorRepo.find({
      where: { processId: id },
      relations: ['evaluator'],
    });

    return { ...process, candidates, evaluators };
  }

  async updateProcess(tenantId: string, id: string, dto: any): Promise<RecruitmentProcess> {
    const process = await this.processRepo.findOne({ where: { id, tenantId } });
    if (!process) throw new NotFoundException('Proceso no encontrado');

    // processType is immutable after active
    if (dto.processType && process.status !== ProcessStatus.DRAFT) {
      throw new BadRequestException('El tipo de proceso no se puede cambiar despues de activado');
    }

    if (dto.title !== undefined) process.title = dto.title;
    if (dto.position !== undefined) process.position = dto.position;
    if (dto.department !== undefined) process.department = dto.department;
    if (dto.description !== undefined) process.description = dto.description;
    if (dto.requirements !== undefined) process.requirements = dto.requirements;
    if (dto.requireCvForInternal !== undefined) process.requireCvForInternal = dto.requireCvForInternal;
    if (dto.scoringWeights !== undefined) process.scoringWeights = dto.scoringWeights;
    if (dto.startDate !== undefined) process.startDate = dto.startDate;
    if (dto.endDate !== undefined) process.endDate = dto.endDate;
    if (dto.status !== undefined) process.status = dto.status;

    const saved = await this.processRepo.save(process);

    // Clean up CV data when process is closed or completed (free DB space)
    if (dto.status === 'closed' || dto.status === 'completed') {
      await this.candidateRepo
        .createQueryBuilder()
        .update()
        .set({ cvUrl: null })
        .where('process_id = :processId AND cv_url IS NOT NULL', { processId: id })
        .execute();
      this.logger.log(`Cleaned CV data for closed process ${id}`);
    }

    return saved;
  }

  // ─── Candidates ───────────────────────────────────────────────────────

  async addExternalCandidate(tenantId: string, processId: string, dto: any): Promise<RecruitmentCandidate> {
    const process = await this.processRepo.findOne({ where: { id: processId, tenantId } });
    if (!process) throw new NotFoundException('Proceso no encontrado');
    if (process.processType !== 'external') throw new BadRequestException('Este proceso es solo para candidatos externos');

    if (!dto.firstName?.trim() || !dto.lastName?.trim()) throw new BadRequestException('Nombres y apellidos son requeridos');
    if (!dto.email?.trim()) throw new BadRequestException('Email es requerido');

    // Check unique email in process
    const existing = await this.candidateRepo.findOne({ where: { processId, email: dto.email } });
    if (existing) throw new BadRequestException('Ya existe un candidato con ese email en este proceso');

    const candidate = this.candidateRepo.create({
      processId, tenantId, candidateType: 'external',
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      email: dto.email.trim(),
      phone: dto.phone || null,
      linkedIn: dto.linkedIn || null,
      availability: dto.availability || null,
      salaryExpectation: dto.salaryExpectation || null,
    });
    return this.candidateRepo.save(candidate);
  }

  async addInternalCandidate(tenantId: string, processId: string, userId: string): Promise<RecruitmentCandidate> {
    const process = await this.processRepo.findOne({ where: { id: processId, tenantId } });
    if (!process) throw new NotFoundException('Proceso no encontrado');
    if (process.processType !== 'internal') throw new BadRequestException('Este proceso es solo para candidatos internos');

    const user = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Colaborador no encontrado');

    // Check unique user in process
    const existing = await this.candidateRepo.findOne({ where: { processId, userId } });
    if (existing) throw new BadRequestException('Este colaborador ya esta en el proceso');

    const candidate = this.candidateRepo.create({
      processId, tenantId, candidateType: 'internal',
      userId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    });
    return this.candidateRepo.save(candidate);
  }

  async updateCandidate(tenantId: string, candidateId: string, dto: any): Promise<RecruitmentCandidate> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    if (dto.email !== undefined) candidate.email = dto.email;
    if (dto.phone !== undefined) candidate.phone = dto.phone;
    if (dto.linkedIn !== undefined) candidate.linkedIn = dto.linkedIn;
    if (dto.availability !== undefined) candidate.availability = dto.availability;
    if (dto.salaryExpectation !== undefined) candidate.salaryExpectation = dto.salaryExpectation;
    if (dto.recruiterNotes !== undefined) candidate.recruiterNotes = dto.recruiterNotes;
    return this.candidateRepo.save(candidate);
  }

  async updateCandidateStage(tenantId: string, candidateId: string, stage: string): Promise<RecruitmentCandidate> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    candidate.stage = stage as CandidateStage;
    return this.candidateRepo.save(candidate);
  }

  async getCandidateProfile(tenantId: string, candidateId: string): Promise<any> {
    const candidate = await this.candidateRepo.findOne({
      where: { id: candidateId, tenantId },
      relations: ['user', 'process'],
    });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');

    const interviews = await this.interviewRepo.find({
      where: { candidateId },
      relations: ['evaluator'],
      order: { createdAt: 'DESC' },
    });

    let internalProfile = null;
    if (candidate.candidateType === 'internal' && candidate.userId) {
      internalProfile = await this.getInternalUserProfile(tenantId, candidate.userId);
    }

    return { ...candidate, interviews, internalProfile };
  }

  // ─── Internal User Profile ────────────────────────────────────────────

  private async getInternalUserProfile(tenantId: string, userId: string): Promise<any> {
    const user = await this.userRepo.findOne({
      where: { id: userId, tenantId },
      select: ['id', 'firstName', 'lastName', 'email', 'department', 'position', 'hireDate', 'createdAt'],
    });
    if (!user) return null;

    // Evaluation history
    const assignments = await this.evalAssignmentRepo.find({
      where: { evaluateeId: userId },
      relations: ['cycle'],
      order: { createdAt: 'DESC' },
    });

    const evaluationHistory: any[] = [];
    for (const a of assignments) {
      const response = await this.evalResponseRepo.findOne({
        where: { assignmentId: a.id },
        select: ['overallScore', 'submittedAt'],
      });
      if (response?.overallScore) {
        evaluationHistory.push({
          cycleName: a.cycle?.name || 'Sin nombre',
          score: Number(response.overallScore),
          date: response.submittedAt,
        });
      }
    }

    // Talent assessment
    const talentData = await this.talentRepo.findOne({
      where: { userId, tenantId },
      order: { createdAt: 'DESC' },
    });

    // Calculate tenure
    const startDate = user.hireDate || user.createdAt;
    const tenureMonths = startDate
      ? Math.floor((Date.now() - new Date(startDate).getTime()) / (30 * 24 * 60 * 60 * 1000))
      : 0;

    const scores = evaluationHistory.map((e) => e.score);
    const avgScore = scores.length > 0 ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null;

    return {
      user: { ...user, tenureMonths },
      evaluationHistory,
      avgScore,
      talentData: talentData ? {
        performanceScore: talentData.performanceScore,
        potentialScore: talentData.potentialScore,
        nineBoxPosition: talentData.nineBoxPosition,
        talentPool: talentData.talentPool,
      } : null,
    };
  }

  // ─── CV & AI ──────────────────────────────────────────────────────────

  async uploadCv(tenantId: string, candidateId: string, cvUrl: string): Promise<RecruitmentCandidate> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    candidate.cvUrl = cvUrl;
    // Auto-advance stage to cv_review when CV is uploaded
    if (candidate.stage === CandidateStage.REGISTERED) {
      candidate.stage = CandidateStage.CV_REVIEW;
    }
    return this.candidateRepo.save(candidate);
  }

  async analyzeCvWithAi(tenantId: string, candidateId: string, generatedBy: string): Promise<any> {
    const candidate = await this.candidateRepo.findOne({
      where: { id: candidateId, tenantId },
      relations: ['process'],
    });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    if (!candidate.cvUrl) throw new BadRequestException('El candidato no tiene CV cargado');

    // This will check AI_INSIGHTS feature + monthly limit + weekly limit
    // and throw if exceeded
    const requirements = candidate.process?.requirements || [];
    const position = candidate.process?.position || '';

    // Build rich context for AI
    const description = candidate.process?.description || '';
    const department = candidate.process?.department || '';

    let context = `CARGO: ${position}\n`;
    if (department) context += `DEPARTAMENTO: ${department}\n`;
    if (description) context += `DESCRIPCION DEL CARGO:\n${description}\n\n`;
    if (requirements.length > 0) {
      // Group requirements by category
      const byCategory: Record<string, string[]> = {};
      for (const r of requirements) {
        const cat = (r as any).category || 'General';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push((r as any).text);
      }
      context += 'REQUISITOS DEL CARGO:\n';
      for (const [cat, items] of Object.entries(byCategory)) {
        context += `  ${cat}:\n${items.map((t) => `    - ${t}`).join('\n')}\n`;
      }
    }

    // For internal candidates, add historical context
    if (candidate.candidateType === 'internal' && candidate.userId) {
      const profile = await this.getInternalUserProfile(tenantId, candidate.userId);
      if (profile?.avgScore) context += `Promedio historico de evaluaciones: ${profile.avgScore}/5\n`;
      if (profile?.talentData?.nineBoxPosition) context += `Posicion 9-Box: ${profile.talentData.nineBoxPosition}\n`;
      if (profile?.user?.tenureMonths) context += `Antiguedad: ${profile.user.tenureMonths} meses\n`;
    }

    // Use AI insights service to analyze (checks rate limits + creates AiInsight record)
    const analysis = await this.aiInsightsService.analyzeCvForRecruitment(
      tenantId, candidateId, generatedBy, candidate.cvUrl, context,
    );

    // Save analysis to candidate
    candidate.cvAnalysis = analysis.content;
    await this.candidateRepo.save(candidate);

    return analysis;
  }

  async getCvAnalysis(tenantId: string, candidateId: string): Promise<any> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    return { cvUrl: candidate.cvUrl, cvAnalysis: candidate.cvAnalysis, recruiterNotes: candidate.recruiterNotes };
  }

  async addRecruiterNotes(tenantId: string, candidateId: string, notes: string): Promise<void> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    candidate.recruiterNotes = notes;
    await this.candidateRepo.save(candidate);
  }

  // ─── Interviews ───────────────────────────────────────────────────────

  async submitInterview(tenantId: string, evaluatorId: string, candidateId: string, dto: any): Promise<RecruitmentInterview> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');

    let interview = await this.interviewRepo.findOne({ where: { candidateId, evaluatorId } });
    if (interview) {
      interview.requirementChecks = dto.requirementChecks || [];
      interview.comments = dto.comments || null;
      interview.globalScore = dto.globalScore ?? null;
    } else {
      interview = this.interviewRepo.create({
        candidateId, evaluatorId,
        requirementChecks: dto.requirementChecks || [],
        comments: dto.comments || null,
        globalScore: dto.globalScore ?? null,
      });
    }
    const saved = await this.interviewRepo.save(interview);

    // Auto-advance stage
    if (candidate.stage === CandidateStage.REGISTERED || candidate.stage === CandidateStage.CV_REVIEW) {
      candidate.stage = CandidateStage.INTERVIEWING;
      await this.candidateRepo.save(candidate);
    }

    // Recalculate candidate final score + auto-advance to scored
    await this.recalculateScore(tenantId, candidateId);
    return saved;
  }

  async getInterviews(tenantId: string, candidateId: string): Promise<RecruitmentInterview[]> {
    // Verify candidate belongs to tenant
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');

    return this.interviewRepo.find({
      where: { candidateId },
      relations: ['evaluator'],
      order: { createdAt: 'ASC' },
    });
  }

  // ─── Scorecard ────────────────────────────────────────────────────────

  async getScorecard(tenantId: string, candidateId: string): Promise<any> {
    const candidate = await this.candidateRepo.findOne({
      where: { id: candidateId, tenantId },
      relations: ['process', 'user'],
    });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');

    const interviews = await this.interviewRepo.find({
      where: { candidateId },
      relations: ['evaluator'],
    });

    // Calculate interview average
    const interviewScores = interviews.filter((i) => i.globalScore != null).map((i) => Number(i.globalScore));
    const interviewAvg = interviewScores.length > 0
      ? Number((interviewScores.reduce((a, b) => a + b, 0) / interviewScores.length).toFixed(2))
      : null;

    // Calculate requirement fulfillment %
    const allChecks = interviews.flatMap((i) => i.requirementChecks || []);
    const totalChecks = allChecks.length;
    const fulfilledChecks = allChecks.filter((c) => c.status === 'cumple').length;
    const partialChecks = allChecks.filter((c) => c.status === 'parcial').length;
    const requirementPct = totalChecks > 0
      ? Number((((fulfilledChecks + partialChecks * 0.5) / totalChecks) * 100).toFixed(1))
      : null;

    // CV AI match %
    const cvMatchPct = candidate.cvAnalysis?.matchPercentage ?? null;

    // For internal: historical average
    let historyAvg = null;
    if (candidate.candidateType === 'internal' && candidate.userId) {
      const profile = await this.getInternalUserProfile(tenantId, candidate.userId);
      historyAvg = profile?.avgScore ?? null;
    }

    return {
      candidate,
      interviews,
      scores: {
        cvMatchPct,
        interviewAvg,
        requirementPct,
        historyAvg,
        finalScore: candidate.finalScore,
        scoreAdjustment: candidate.scoreAdjustment,
        scoreJustification: candidate.scoreJustification,
      },
      process: candidate.process,
    };
  }

  async adjustScore(tenantId: string, candidateId: string, adjustment: number, justification: string): Promise<void> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    candidate.scoreAdjustment = adjustment;
    candidate.scoreJustification = justification;
    // Recalculate with adjustment
    await this.recalculateScore(tenantId, candidateId);
  }

  private async recalculateScore(tenantId: string, candidateId: string): Promise<void> {
    const candidate = await this.candidateRepo.findOne({
      where: { id: candidateId, tenantId },
      relations: ['process'],
    });
    if (!candidate) return;

    const interviews = await this.interviewRepo.find({ where: { candidateId } });
    const interviewScores = interviews.filter((i) => i.globalScore != null).map((i) => Number(i.globalScore));
    const interviewAvg = interviewScores.length > 0
      ? interviewScores.reduce((a, b) => a + b, 0) / interviewScores.length
      : 0;

    let finalScore: number;

    if (candidate.candidateType === 'internal' && candidate.userId) {
      // Weighted: history + interview
      const weights = candidate.process?.scoringWeights || { history: 40, interview: 60 };
      const profile = await this.getInternalUserProfile(tenantId, candidate.userId);
      const historyScore = profile?.avgScore ? (profile.avgScore / 5) * 10 : 0; // Normalize to 0-10
      finalScore = (historyScore * weights.history + interviewAvg * weights.interview) / 100;
    } else {
      // External: just interview average
      finalScore = interviewAvg;
    }

    // Apply manual adjustment if exists
    if (candidate.scoreAdjustment != null) {
      finalScore += Number(candidate.scoreAdjustment);
    }

    candidate.finalScore = Number(Math.max(0, Math.min(10, finalScore)).toFixed(2));

    // Auto-advance to 'scored' if there's a score and still in interviewing
    if (candidate.finalScore > 0 && candidate.stage === CandidateStage.INTERVIEWING) {
      candidate.stage = CandidateStage.SCORED;
    }

    await this.candidateRepo.save(candidate);
  }

  // ─── Comparative (internal only) ─────────────────────────────────────

  async getComparative(tenantId: string, processId: string): Promise<any> {
    const process = await this.processRepo.findOne({ where: { id: processId, tenantId } });
    if (!process) throw new NotFoundException('Proceso no encontrado');

    const candidates = await this.candidateRepo.find({
      where: { processId },
      relations: ['user'],
      order: { finalScore: 'DESC' },
    });

    const rows = [];
    for (const c of candidates) {
      const interviews = await this.interviewRepo.find({ where: { candidateId: c.id } });
      const interviewScores = interviews.filter((i) => i.globalScore != null).map((i) => Number(i.globalScore));
      const interviewAvg = interviewScores.length > 0
        ? Number((interviewScores.reduce((a, b) => a + b, 0) / interviewScores.length).toFixed(2))
        : null;

      let internalProfile = null;
      if (c.candidateType === 'internal' && c.userId) {
        internalProfile = await this.getInternalUserProfile(tenantId, c.userId);
      }

      // Requirement fulfillment
      const allChecks = interviews.flatMap((i) => i.requirementChecks || []);
      const requirementSummary: Record<string, { cumple: number; parcial: number; no_cumple: number; total: number }> = {};
      for (const check of allChecks) {
        const key = `${check.category}:${check.text}`;
        if (!requirementSummary[key]) requirementSummary[key] = { cumple: 0, parcial: 0, no_cumple: 0, total: 0 };
        requirementSummary[key][check.status as 'cumple' | 'parcial' | 'no_cumple']++;
        requirementSummary[key].total++;
      }

      rows.push({
        candidate: c,
        interviewAvg,
        internalProfile,
        requirementSummary,
        cvMatchPct: c.cvAnalysis?.matchPercentage ?? null,
      });
    }

    return { process, requirements: process.requirements, rows };
  }

  async generateAiRecommendation(tenantId: string, processId: string, generatedBy: string): Promise<any> {
    const comparative = await this.getComparative(tenantId, processId);

    // Use AI insights service (checks rate limits)
    return this.aiInsightsService.generateRecruitmentRecommendation(
      tenantId, processId, generatedBy, comparative,
    );
  }
}
