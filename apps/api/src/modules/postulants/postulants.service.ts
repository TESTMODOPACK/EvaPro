import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Postulant } from './entities/postulant.entity';
import { PostulantProcess, ProcessStatus } from './entities/postulant-process.entity';
import { PostulantProcessEntry, PostulantEntryStatus } from './entities/postulant-process-entry.entity';
import { PostulantProcessEvaluator } from './entities/postulant-process-evaluator.entity';
import { PostulantAssessment } from './entities/postulant-assessment.entity';
import { User } from '../users/entities/user.entity';
import { RoleCompetency } from '../development/entities/role-competency.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';

@Injectable()
export class PostulantsService {
  constructor(
    @InjectRepository(Postulant) private readonly postulantRepo: Repository<Postulant>,
    @InjectRepository(PostulantProcess) private readonly processRepo: Repository<PostulantProcess>,
    @InjectRepository(PostulantProcessEntry) private readonly entryRepo: Repository<PostulantProcessEntry>,
    @InjectRepository(PostulantProcessEvaluator) private readonly evaluatorRepo: Repository<PostulantProcessEvaluator>,
    @InjectRepository(PostulantAssessment) private readonly assessmentRepo: Repository<PostulantAssessment>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(RoleCompetency) private readonly roleCompRepo: Repository<RoleCompetency>,
    @InjectRepository(TalentAssessment) private readonly talentRepo: Repository<TalentAssessment>,
  ) {}

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
    const process = this.processRepo.create({
      tenantId,
      title: dto.title,
      position: dto.position,
      department: dto.department || null,
      description: dto.description || null,
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
}
