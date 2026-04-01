import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { Postulant } from './entities/postulant.entity';
import { PostulantProcess, ProcessStatus } from './entities/postulant-process.entity';
import { PostulantProcessEntry, PostulantEntryStatus } from './entities/postulant-process-entry.entity';
import { PostulantProcessEvaluator } from './entities/postulant-process-evaluator.entity';
import { PostulantAssessment } from './entities/postulant-assessment.entity';
import { PostulantRequirementCheck } from './entities/postulant-requirement-check.entity';
import { User } from '../users/entities/user.entity';
import { RoleCompetency } from '../development/entities/role-competency.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { Objective } from '../objectives/entities/objective.entity';

const CV_ANALYSIS_MODEL = 'claude-haiku-4-5';

@Injectable()
export class PostulantsService {
  private readonly logger = new Logger(PostulantsService.name);
  private aiClient: Anthropic | null = null;

  constructor(
    @InjectRepository(Postulant) private readonly postulantRepo: Repository<Postulant>,
    @InjectRepository(PostulantProcess) private readonly processRepo: Repository<PostulantProcess>,
    @InjectRepository(PostulantProcessEntry) private readonly entryRepo: Repository<PostulantProcessEntry>,
    @InjectRepository(PostulantProcessEvaluator) private readonly evaluatorRepo: Repository<PostulantProcessEvaluator>,
    @InjectRepository(PostulantAssessment) private readonly assessmentRepo: Repository<PostulantAssessment>,
    @InjectRepository(PostulantRequirementCheck) private readonly reqCheckRepo: Repository<PostulantRequirementCheck>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(RoleCompetency) private readonly roleCompRepo: Repository<RoleCompetency>,
    @InjectRepository(TalentAssessment) private readonly talentRepo: Repository<TalentAssessment>,
    @InjectRepository(EvaluationAssignment) private readonly evalAssignmentRepo: Repository<EvaluationAssignment>,
    @InjectRepository(EvaluationResponse) private readonly evalResponseRepo: Repository<EvaluationResponse>,
    @InjectRepository(Objective) private readonly objectiveRepo: Repository<Objective>,
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.aiClient = new Anthropic({ apiKey });
    }
  }

  // ─── Postulants CRUD ────────────────────────────────────────────────

  async createPostulant(tenantId: string, dto: any): Promise<Postulant> {
    if (dto.type === 'internal' && dto.userId) {
      const user = await this.userRepo.findOne({ where: { id: dto.userId, tenantId } });
      if (!user) throw new NotFoundException('Usuario no encontrado');
      dto.firstName = dto.firstName || user.firstName;
      dto.lastName = dto.lastName || user.lastName;
      dto.email = dto.email || user.email;
      dto.source = 'internal';
    }

    const existing = await this.postulantRepo.findOne({
      where: { tenantId, email: dto.email },
    });
    if (existing) throw new ConflictException('Ya existe un postulante con ese email');

    const postulant = this.postulantRepo.create({
      tenantId,
      type: dto.type || 'external',
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      phone: dto.phone || null,
      userId: dto.userId || null,
      source: dto.source || null,
      notes: dto.notes || null,
    });
    return this.postulantRepo.save(postulant);
  }

  async listPostulants(tenantId: string, search?: string): Promise<Postulant[]> {
    const qb = this.postulantRepo.createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.is_active = true')
      .orderBy('p.created_at', 'DESC');
    if (search) {
      qb.andWhere('(p.first_name ILIKE :s OR p.last_name ILIKE :s OR p.email ILIKE :s)', { s: `%${search}%` });
    }
    return qb.getMany();
  }

  async getPostulant(tenantId: string, id: string): Promise<Postulant> {
    const p = await this.postulantRepo.findOne({ where: { id, tenantId }, relations: ['user'] });
    if (!p) throw new NotFoundException('Postulante no encontrado');
    return p;
  }

  // ─── Processes CRUD ─────────────────────────────────────────────────

  async createProcess(tenantId: string, creatorId: string, dto: any): Promise<PostulantProcess> {
    const processType = dto.processType || 'external';
    const process = this.processRepo.create({
      tenantId,
      title: dto.title,
      position: dto.position,
      department: dto.department || null,
      description: dto.description || null,
      processType,
      requirements: Array.isArray(dto.requirements) ? dto.requirements : [],
      startDate: dto.startDate || null,
      endDate: dto.endDate || null,
      createdBy: creatorId,
    });
    const saved = await this.processRepo.save(process);

    // Add evaluators (verify they belong to this tenant)
    if (dto.evaluatorIds?.length) {
      for (const evaluatorId of dto.evaluatorIds) {
        const user = await this.userRepo.findOne({ where: { id: evaluatorId, tenantId } });
        if (!user) throw new BadRequestException(`Evaluador ${evaluatorId} no encontrado en esta organización`);
      }
      const evaluators = dto.evaluatorIds.map((evaluatorId: string) =>
        this.evaluatorRepo.create({ processId: saved.id, evaluatorId }),
      );
      await this.evaluatorRepo.save(evaluators);
    }

    // Add postulants (verify they belong to this tenant)
    if (dto.postulantIds?.length) {
      for (const postulantId of dto.postulantIds) {
        const p = await this.postulantRepo.findOne({ where: { id: postulantId, tenantId } });
        if (!p) throw new BadRequestException(`Postulante ${postulantId} no encontrado en esta organización`);
      }
      const entries = dto.postulantIds.map((postulantId: string) =>
        this.entryRepo.create({ processId: saved.id, postulantId }),
      );
      await this.entryRepo.save(entries);
    }

    return this.getProcess(tenantId, saved.id);
  }

  async listProcesses(tenantId: string, status?: string): Promise<any[]> {
    const qb = this.processRepo.createQueryBuilder('p')
      .leftJoin('postulant_process_entries', 'e', 'e.process_id = p.id')
      .select([
        'p.id as id', 'p.title as title', 'p.position as position',
        'p.department as department', 'p.status as status',
        'p.start_date as "startDate"', 'p.end_date as "endDate"',
        'p.created_at as "createdAt"',
        'COUNT(e.id) as "candidateCount"',
      ])
      .where('p.tenant_id = :tenantId', { tenantId })
      .groupBy('p.id')
      .orderBy('p.created_at', 'DESC');
    if (status && status !== 'all') {
      qb.andWhere('p.status = :status', { status });
    }
    return qb.getRawMany();
  }

  async getProcess(tenantId: string, id: string): Promise<any> {
    const process = await this.processRepo.findOne({ where: { id, tenantId } });
    if (!process) throw new NotFoundException('Proceso no encontrado');

    const entries = await this.entryRepo.find({
      where: { processId: id },
      relations: ['postulant'],
      order: { createdAt: 'ASC' },
    });

    const evaluators = await this.evaluatorRepo.find({
      where: { processId: id },
      relations: ['evaluator'],
    });

    // Get competencies for this position
    const competencies = await this.roleCompRepo.find({
      where: { tenantId, position: process.position },
      relations: ['competency'],
    });

    return { ...process, entries, evaluators, competencies };
  }

  async updateProcess(tenantId: string, id: string, dto: any): Promise<PostulantProcess> {
    const process = await this.processRepo.findOne({ where: { id, tenantId } });
    if (!process) throw new NotFoundException('Proceso no encontrado');
    if (dto.title !== undefined) process.title = dto.title;
    if (dto.position !== undefined) process.position = dto.position;
    if (dto.department !== undefined) process.department = dto.department;
    if (dto.description !== undefined) process.description = dto.description;
    if (dto.status !== undefined) process.status = dto.status;
    if (dto.startDate !== undefined) process.startDate = dto.startDate;
    if (dto.endDate !== undefined) process.endDate = dto.endDate;
    return this.processRepo.save(process);
  }

  async addPostulantToProcess(tenantId: string, processId: string, postulantId: string): Promise<PostulantProcessEntry> {
    const process = await this.processRepo.findOne({ where: { id: processId, tenantId } });
    if (!process) throw new NotFoundException('Proceso no encontrado');
    const postulant = await this.postulantRepo.findOne({ where: { id: postulantId, tenantId } });
    if (!postulant) throw new NotFoundException('Postulante no encontrado');

    const existing = await this.entryRepo.findOne({ where: { processId, postulantId } });
    if (existing) throw new ConflictException('El postulante ya está en este proceso');

    const entry = this.entryRepo.create({ processId, postulantId });
    return this.entryRepo.save(entry);
  }

  async updateEntryStatus(tenantId: string, entryId: string, status: string, statusNotes?: string): Promise<PostulantProcessEntry> {
    const entry = await this.entryRepo.findOne({
      where: { id: entryId },
      relations: ['process'],
    });
    if (!entry || entry.process.tenantId !== tenantId) throw new NotFoundException('Entrada no encontrada');
    entry.status = status as PostulantEntryStatus;
    if (statusNotes !== undefined) entry.statusNotes = statusNotes;
    return this.entryRepo.save(entry);
  }

  // ─── Assessments ────────────────────────────────────────────────────

  async submitAssessment(tenantId: string, evaluatorId: string, dto: any): Promise<void> {
    const entry = await this.entryRepo.findOne({
      where: { id: dto.entryId },
      relations: ['process'],
    });
    if (!entry || entry.process.tenantId !== tenantId) throw new NotFoundException('Entrada no encontrada');

    // Verify evaluator is assigned
    const isEvaluator = await this.evaluatorRepo.findOne({
      where: { processId: entry.processId, evaluatorId },
    });
    if (!isEvaluator) throw new BadRequestException('No estás asignado como evaluador en este proceso');

    // Upsert scores
    for (const s of dto.scores) {
      const existing = await this.assessmentRepo.findOne({
        where: { entryId: dto.entryId, evaluatorId, competencyId: s.competencyId },
      });
      if (existing) {
        existing.score = s.score;
        existing.comment = s.comment || null;
        await this.assessmentRepo.save(existing);
      } else {
        await this.assessmentRepo.save(this.assessmentRepo.create({
          entryId: dto.entryId,
          evaluatorId,
          competencyId: s.competencyId,
          score: s.score,
          comment: s.comment || null,
        }));
      }
    }

    // Recalculate final score
    await this.recalculateFinalScore(dto.entryId);
  }

  async getScorecard(tenantId: string, entryId: string): Promise<any> {
    const entry = await this.entryRepo.findOne({
      where: { id: entryId },
      relations: ['process', 'postulant'],
    });
    if (!entry || entry.process.tenantId !== tenantId) throw new NotFoundException('Entrada no encontrada');

    const assessments = await this.assessmentRepo.find({
      where: { entryId },
      relations: ['evaluator', 'competency'],
      order: { competencyId: 'ASC' },
    });

    const competencies = await this.roleCompRepo.find({
      where: { tenantId, position: entry.process.position },
      relations: ['competency'],
    });

    // For internal candidates, get talent data
    let talentData = null;
    if (entry.postulant.type === 'internal' && entry.postulant.userId) {
      talentData = await this.talentRepo.findOne({
        where: { tenantId, userId: entry.postulant.userId },
        order: { createdAt: 'DESC' },
      });
    }

    return {
      entry,
      assessments,
      competencies,
      talentData,
    };
  }

  async getComparative(tenantId: string, processId: string): Promise<any> {
    const process = await this.processRepo.findOne({ where: { id: processId, tenantId } });
    if (!process) throw new NotFoundException('Proceso no encontrado');

    const entries = await this.entryRepo.find({
      where: { processId },
      relations: ['postulant'],
      order: { finalScore: 'DESC' },
    });

    const competencies = await this.roleCompRepo.find({
      where: { tenantId, position: process.position },
      relations: ['competency'],
    });

    const candidates = [];
    for (const entry of entries) {
      const assessments = await this.assessmentRepo
        .createQueryBuilder('a')
        .select('a.competency_id', 'competencyId')
        .addSelect('AVG(a.score)', 'avgScore')
        .where('a.entry_id = :entryId', { entryId: entry.id })
        .groupBy('a.competency_id')
        .getRawMany();

      let talentData = null;
      if (entry.postulant.type === 'internal' && entry.postulant.userId) {
        talentData = await this.talentRepo.findOne({
          where: { tenantId, userId: entry.postulant.userId },
          order: { createdAt: 'DESC' },
        });
      }

      candidates.push({
        entry,
        scores: assessments,
        talentData,
      });
    }

    return { process, competencies, candidates };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async recalculateFinalScore(entryId: string): Promise<void> {
    const result = await this.assessmentRepo
      .createQueryBuilder('a')
      .select('AVG(a.score)', 'avg')
      .where('a.entry_id = :entryId', { entryId })
      .getRawOne();
    const avg = result?.avg ? parseFloat(result.avg) : null;
    await this.entryRepo.update(entryId, { finalScore: avg });
  }

  // ─── CV Upload & AI Analysis ──────────────────────────────────────

  async uploadCv(tenantId: string, postulantId: string, cvUrl: string) {
    const postulant = await this.postulantRepo.findOne({ where: { id: postulantId, tenantId } });
    if (!postulant) throw new NotFoundException('Postulante no encontrado');
    postulant.cvUrl = cvUrl;
    return this.postulantRepo.save(postulant);
  }

  async saveCvAnalysis(tenantId: string, postulantId: string, analysis: any) {
    const postulant = await this.postulantRepo.findOne({ where: { id: postulantId, tenantId } });
    if (!postulant) throw new NotFoundException('Postulante no encontrado');
    postulant.cvAnalysis = analysis;
    return this.postulantRepo.save(postulant);
  }

  async getCvAnalysis(tenantId: string, postulantId: string) {
    const postulant = await this.postulantRepo.findOne({ where: { id: postulantId, tenantId } });
    if (!postulant) throw new NotFoundException('Postulante no encontrado');
    return { cvUrl: postulant.cvUrl, cvAnalysis: postulant.cvAnalysis };
  }

  async analyzeCvWithAi(tenantId: string, postulantId: string) {
    if (!this.aiClient) {
      throw new ServiceUnavailableException('La funcionalidad de IA no está disponible. Configure ANTHROPIC_API_KEY.');
    }

    const postulant = await this.postulantRepo.findOne({ where: { id: postulantId, tenantId } });
    if (!postulant) throw new NotFoundException('Postulante no encontrado');
    if (!postulant.cvUrl) {
      throw new BadRequestException('El postulante no tiene un CV subido. Sube un CV primero.');
    }

    // Always re-analyze when explicitly requested (POST endpoint is intentional)

    // Fetch the CV file and convert to base64 for Anthropic document API
    let cvBase64 = '';
    let cvMediaType = 'application/pdf';
    let usePlainText = false;
    try {
      const response = await fetch(postulant.cvUrl);
      if (!response.ok) throw new Error('Failed to fetch CV');
      const contentType = response.headers.get('content-type') || '';
      const buffer = Buffer.from(await response.arrayBuffer());
      cvBase64 = buffer.toString('base64');
      cvMediaType = contentType.includes('pdf') ? 'application/pdf'
        : contentType.includes('word') || contentType.includes('docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf';
      // If file is too large (>5MB), fallback to text
      if (buffer.length > 5 * 1024 * 1024) {
        usePlainText = true;
      }
    } catch {
      usePlainText = true;
    }

    const postulantContext = `Nombre: ${postulant.firstName} ${postulant.lastName}\nEmail: ${postulant.email}\nTeléfono: ${postulant.phone || 'No disponible'}\nFuente: ${postulant.source || 'No especificada'}\nNotas: ${postulant.notes || 'Sin notas'}`;

    // Get process context if the postulant is in any active process
    const entries = await this.entryRepo.find({
      where: { postulantId },
      relations: ['process'],
    });
    const processContext = entries.length > 0
      ? `Cargo al que postula: ${entries[0].process?.position || 'No especificado'}. Departamento: ${entries[0].process?.department || 'No especificado'}.`
      : '';

    const prompt = `Eres un experto en recursos humanos y selección de personal. Analiza el CV/documento adjunto y la información del postulante para generar un perfil profesional estructurado.

${processContext}

Información del postulante:
${postulantContext}

${usePlainText ? 'Nota: No se pudo leer el archivo del CV. Genera el perfil basándote solo en la información disponible.' : 'El documento adjunto es el CV del postulante. Analízalo en detalle.'}

Responde SOLO con un JSON válido (sin markdown, sin backticks) con esta estructura exacta:
{
  "resumenProfesional": "Resumen de 2-3 oraciones del perfil del candidato",
  "fortalezas": ["fortaleza 1", "fortaleza 2", "fortaleza 3"],
  "areasDesarrollo": ["área 1", "área 2"],
  "experienciaRelevante": "Descripción de la experiencia más relevante para el cargo",
  "nivelEducativo": "Nivel educativo identificado",
  "anosExperiencia": "Estimación de años de experiencia",
  "competenciasClave": ["competencia 1", "competencia 2", "competencia 3", "competencia 4"],
  "idiomasDetectados": ["idioma 1"],
  "recomendacion": "Recomendación general sobre el candidato para el cargo",
  "nivelAjuste": "alto|medio|bajo",
  "observaciones": "Observaciones adicionales"
}`;

    try {
      // Build message content: use document block if we have base64, otherwise plain text
      const messageContent: any[] = [];
      if (!usePlainText && cvBase64) {
        messageContent.push({
          type: 'document',
          source: { type: 'base64', media_type: cvMediaType, data: cvBase64 },
        });
      }
      messageContent.push({ type: 'text', text: prompt });

      const response = await this.aiClient.messages.create({
        model: CV_ANALYSIS_MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: messageContent }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      const rawText = textBlock?.text || '{}';

      // Parse JSON response
      let analysis: any;
      try {
        analysis = JSON.parse(rawText);
      } catch {
        // Try to extract JSON from response
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { resumenProfesional: rawText, error: 'No se pudo parsear la respuesta' };
      }

      // Save analysis
      postulant.cvAnalysis = analysis;
      await this.postulantRepo.save(postulant);

      return analysis;
    } catch (error: any) {
      this.logger.error(`CV Analysis AI error: ${error.message}`);
      throw new BadRequestException(`Error al analizar el CV: ${error.message || 'Error desconocido'}`);
    }
  }

  // ─── Requirement Checks ──────────────────────────────────────────────

  async saveRequirementChecks(
    tenantId: string,
    evaluatorId: string,
    entryId: string,
    checks: Array<{ requirement: string; status: string; comment?: string }>,
  ): Promise<PostulantRequirementCheck[]> {
    // Verify entry exists and evaluator is assigned
    const entry = await this.entryRepo.findOne({ where: { id: entryId }, relations: ['process'] });
    if (!entry) throw new NotFoundException('Candidato no encontrado en este proceso');

    const results: PostulantRequirementCheck[] = [];
    for (const check of checks) {
      let existing = await this.reqCheckRepo.findOne({
        where: { entryId, evaluatorId, requirement: check.requirement },
      });
      if (existing) {
        existing.status = check.status;
        existing.comment = check.comment || null;
        results.push(await this.reqCheckRepo.save(existing));
      } else {
        const newCheck = this.reqCheckRepo.create({
          entryId,
          evaluatorId,
          requirement: check.requirement,
          status: check.status,
          comment: check.comment || null,
        });
        results.push(await this.reqCheckRepo.save(newCheck));
      }
    }
    return results;
  }

  async getRequirementChecks(tenantId: string, entryId: string): Promise<PostulantRequirementCheck[]> {
    return this.reqCheckRepo.find({
      where: { entryId },
      relations: ['evaluator'],
      order: { requirement: 'ASC', createdAt: 'ASC' },
    });
  }

  // ─── Internal Candidate Profile ──────────────────────────────────────

  async getInternalCandidateProfile(tenantId: string, userId: string): Promise<any> {
    const user = await this.userRepo.findOne({
      where: { id: userId, tenantId },
      select: ['id', 'firstName', 'lastName', 'email', 'department', 'position', 'role', 'createdAt'],
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // Get evaluation history
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
          cycleType: (a.cycle as any)?.type || '--',
          score: Number(response.overallScore),
          date: response.submittedAt,
          relationType: a.relationType,
        });
      }
    }

    // Get talent assessment
    const talentData = await this.talentRepo.findOne({
      where: { userId, tenantId },
      order: { createdAt: 'DESC' },
    });

    // Get objectives summary
    const objectives = await this.objectiveRepo.find({
      where: { userId, tenantId },
      select: ['id', 'title', 'status', 'progress'],
    });
    const objCompleted = objectives.filter((o) => o.status === 'completed').length;
    const objActive = objectives.filter((o) => o.status === 'active').length;

    // Calculate tenure
    const tenureMonths = user.createdAt
      ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (30 * 24 * 60 * 60 * 1000))
      : 0;

    // Calculate avg evaluation score
    const scores = evaluationHistory.map((e) => e.score).filter((s) => s > 0);
    const avgScore = scores.length > 0 ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null;

    return {
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        department: user.department,
        position: user.position,
        role: user.role,
        tenureMonths,
      },
      evaluationHistory,
      avgScore,
      talentData: talentData ? {
        performanceScore: talentData.performanceScore,
        potentialScore: talentData.potentialScore,
        nineBoxPosition: talentData.nineBoxPosition,
        talentPool: talentData.talentPool,
      } : null,
      objectives: {
        total: objectives.length,
        completed: objCompleted,
        active: objActive,
      },
    };
  }
}
