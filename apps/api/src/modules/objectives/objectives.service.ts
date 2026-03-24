import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Objective, ObjectiveStatus } from './entities/objective.entity';
import { ObjectiveUpdate } from './entities/objective-update.entity';
import { ObjectiveComment } from './entities/objective-comment.entity';
import { KeyResult, KRStatus } from './entities/key-result.entity';
import { User } from '../users/entities/user.entity';
import { CreateObjectiveDto } from './dto/create-objective.dto';
import { UpdateObjectiveDto, CreateObjectiveUpdateDto } from './dto/update-objective.dto';

@Injectable()
export class ObjectivesService {
  constructor(
    @InjectRepository(Objective)
    private readonly objectiveRepo: Repository<Objective>,
    @InjectRepository(ObjectiveUpdate)
    private readonly updateRepo: Repository<ObjectiveUpdate>,
    @InjectRepository(ObjectiveComment)
    private readonly commentRepo: Repository<ObjectiveComment>,
    @InjectRepository(KeyResult)
    private readonly keyResultRepo: Repository<KeyResult>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateObjectiveDto): Promise<Objective> {
    const obj = this.objectiveRepo.create({
      tenantId,
      userId,
      title: dto.title,
      description: dto.description,
      type: dto.type,
      targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
      cycleId: dto.cycleId,
      weight: dto.weight ?? 0,
      status: ObjectiveStatus.DRAFT,
      progress: 0,
    });
    return this.objectiveRepo.save(obj);
  }

  // ─── Queries by role ────────────────────────────────────────────────────────

  /** All objectives in the tenant (for tenant_admin) */
  async findAll(tenantId: string, filterUserId?: string): Promise<Objective[]> {
    const where: any = { tenantId };
    if (filterUserId) where.userId = filterUserId;
    return this.objectiveRepo.find({
      where,
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  /** Objectives of manager's direct reports + own (for manager) */
  async findByManager(tenantId: string, managerId: string): Promise<Objective[]> {
    // Get direct reports
    const subordinates = await this.userRepo.find({
      where: { tenantId, managerId, isActive: true },
      select: ['id'],
    });
    const userIds = [managerId, ...subordinates.map((u) => u.id)];

    return this.objectiveRepo.find({
      where: { tenantId, userId: In(userIds) },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  /** Only the user's own objectives (for employee) */
  async findByUser(tenantId: string, userId: string): Promise<Objective[]> {
    return this.objectiveRepo.find({
      where: { tenantId, userId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<Objective> {
    const obj = await this.objectiveRepo.findOne({
      where: { id, tenantId },
      relations: ['user'],
    });
    if (!obj) throw new NotFoundException('Objetivo no encontrado');
    return obj;
  }

  async update(tenantId: string, id: string, dto: UpdateObjectiveDto): Promise<Objective> {
    const obj = await this.findById(tenantId, id);
    if (dto.title !== undefined) obj.title = dto.title;
    if (dto.description !== undefined) obj.description = dto.description;
    if (dto.type !== undefined) obj.type = dto.type;
    if (dto.status !== undefined) obj.status = dto.status;
    if (dto.targetDate !== undefined) obj.targetDate = new Date(dto.targetDate);
    if (dto.progress !== undefined) obj.progress = dto.progress;
    if (dto.weight !== undefined) obj.weight = dto.weight;
    return this.objectiveRepo.save(obj);
  }

  async submitForApproval(tenantId: string, id: string): Promise<Objective> {
    const obj = await this.findById(tenantId, id);
    if (obj.status !== ObjectiveStatus.DRAFT) {
      throw new BadRequestException('Solo objetivos en estado borrador pueden enviarse a aprobación');
    }

    // B2.9: Validate weight sum = 100% for all active/pending objectives of same user
    if (obj.weight > 0) {
      const userObjectives = await this.objectiveRepo.find({
        where: { tenantId, userId: obj.userId },
      });
      const totalWeight = userObjectives
        .filter((o) => o.id !== id && o.status !== ObjectiveStatus.ABANDONED)
        .reduce((sum, o) => sum + Number(o.weight || 0), Number(obj.weight));
      if (totalWeight > 100) {
        throw new BadRequestException(
          `La suma de pesos de los objetivos del colaborador sería ${totalWeight}%. El total no puede superar 100%.`,
        );
      }
    }

    obj.status = ObjectiveStatus.PENDING_APPROVAL;
    return this.objectiveRepo.save(obj);
  }

  async approve(tenantId: string, id: string): Promise<Objective> {
    const obj = await this.findById(tenantId, id);
    if (obj.status !== ObjectiveStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Solo objetivos pendientes de aprobaci\u00f3n pueden ser aprobados');
    }
    obj.status = ObjectiveStatus.ACTIVE;
    return this.objectiveRepo.save(obj);
  }

  async reject(tenantId: string, id: string): Promise<Objective> {
    const obj = await this.findById(tenantId, id);
    if (obj.status !== ObjectiveStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Solo objetivos pendientes de aprobaci\u00f3n pueden ser rechazados');
    }
    obj.status = ObjectiveStatus.DRAFT;
    return this.objectiveRepo.save(obj);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const obj = await this.findById(tenantId, id);
    obj.status = ObjectiveStatus.ABANDONED;
    await this.objectiveRepo.save(obj);
  }

  // ─── Progress ───────────────────────────────────────────────────────────────

  async addProgressUpdate(
    tenantId: string,
    userId: string,
    objectiveId: string,
    dto: CreateObjectiveUpdateDto,
  ): Promise<ObjectiveUpdate> {
    const obj = await this.findById(tenantId, objectiveId);
    obj.progress = dto.progressValue;
    if (dto.progressValue >= 100) {
      obj.status = ObjectiveStatus.COMPLETED;
    } else if (obj.status === ObjectiveStatus.DRAFT) {
      obj.status = ObjectiveStatus.ACTIVE;
    }
    await this.objectiveRepo.save(obj);

    const update = this.updateRepo.create({
      tenantId,
      objectiveId,
      progressValue: dto.progressValue,
      notes: dto.notes,
      createdBy: userId,
    });
    return this.updateRepo.save(update);
  }

  async getProgressHistory(tenantId: string, objectiveId: string): Promise<ObjectiveUpdate[]> {
    return this.updateRepo.find({
      where: { tenantId, objectiveId },
      relations: ['creator'],
      order: { createdAt: 'ASC' },
    });
  }

  // B2.11: Objectives at risk (<40% progress and active)
  async getAtRiskObjectives(tenantId: string, filterUserId?: string): Promise<Objective[]> {
    const qb = this.objectiveRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'u')
      .where('o.tenantId = :tenantId', { tenantId })
      .andWhere('o.status = :status', { status: ObjectiveStatus.ACTIVE })
      .andWhere('o.progress < :threshold', { threshold: 40 });
    if (filterUserId) {
      qb.andWhere('o.userId = :filterUserId', { filterUserId });
    }
    return qb.orderBy('o.progress', 'ASC').getMany();
  }

  async getCompletionStats(tenantId: string, userId: string) {
    const total = await this.objectiveRepo.count({ where: { tenantId, userId } });
    const completed = await this.objectiveRepo.count({
      where: { tenantId, userId, status: ObjectiveStatus.COMPLETED },
    });
    return { total, completed, inProgress: total - completed };
  }

  // ─── Comments ───────────────────────────────────────────────────────────────

  async listComments(tenantId: string, objectiveId: string): Promise<ObjectiveComment[]> {
    return this.commentRepo.find({
      where: { tenantId, objectiveId },
      relations: ['author'],
      order: { createdAt: 'ASC' },
    });
  }

  async createComment(
    tenantId: string,
    objectiveId: string,
    authorId: string,
    data: { content: string; type?: string; attachmentUrl?: string; attachmentName?: string },
  ): Promise<ObjectiveComment> {
    // Verify objective exists
    await this.findById(tenantId, objectiveId);

    const comment = this.commentRepo.create({
      tenantId,
      objectiveId,
      authorId,
      content: data.content,
      type: data.type || 'comentario',
      attachmentUrl: data.attachmentUrl || null,
      attachmentName: data.attachmentName || null,
    });
    const saved = await this.commentRepo.save(comment);
    return this.commentRepo.findOne({
      where: { id: saved.id },
      relations: ['author'],
    }) as Promise<ObjectiveComment>;
  }

  async deleteComment(tenantId: string, commentId: string, requesterId: string, requesterRole: string): Promise<void> {
    const comment = await this.commentRepo.findOne({ where: { id: commentId, tenantId } });
    if (!comment) throw new NotFoundException('Comentario no encontrado');

    // Only the author or tenant_admin can delete
    if (comment.authorId !== requesterId && requesterRole !== 'tenant_admin') {
      throw new ForbiddenException('Solo el autor o el administrador puede eliminar este comentario');
    }

    await this.commentRepo.remove(comment);
  }

  // ─── Key Results (B2.10) ──────────────────────────────────────────────────

  async listKeyResults(tenantId: string, objectiveId: string): Promise<KeyResult[]> {
    return this.keyResultRepo.find({
      where: { tenantId, objectiveId },
      order: { createdAt: 'ASC' },
    });
  }

  async createKeyResult(
    tenantId: string,
    objectiveId: string,
    data: { description: string; unit?: string; baseValue?: number; targetValue?: number },
  ): Promise<KeyResult> {
    await this.findById(tenantId, objectiveId);
    const kr = this.keyResultRepo.create({
      tenantId,
      objectiveId,
      description: data.description,
      unit: data.unit || '%',
      baseValue: data.baseValue ?? 0,
      targetValue: data.targetValue ?? 100,
      currentValue: data.baseValue ?? 0,
      status: KRStatus.ACTIVE,
    });
    return this.keyResultRepo.save(kr);
  }

  async updateKeyResult(
    tenantId: string,
    krId: string,
    data: { currentValue?: number; description?: string; targetValue?: number; status?: KRStatus },
  ): Promise<KeyResult> {
    const kr = await this.keyResultRepo.findOne({ where: { id: krId, tenantId } });
    if (!kr) throw new NotFoundException('Key Result no encontrado');
    if (data.currentValue !== undefined) kr.currentValue = data.currentValue;
    if (data.description !== undefined) kr.description = data.description;
    if (data.targetValue !== undefined) kr.targetValue = data.targetValue;
    if (data.status !== undefined) kr.status = data.status;

    // Auto-complete KR if currentValue >= targetValue
    if (Number(kr.currentValue) >= Number(kr.targetValue) && kr.status === KRStatus.ACTIVE) {
      kr.status = KRStatus.COMPLETED;
    }

    const saved = await this.keyResultRepo.save(kr);

    // Recalculate objective progress from KR completion
    await this.recalculateProgressFromKRs(tenantId, kr.objectiveId);

    return saved;
  }

  async deleteKeyResult(tenantId: string, krId: string): Promise<void> {
    const kr = await this.keyResultRepo.findOne({ where: { id: krId, tenantId } });
    if (!kr) throw new NotFoundException('Key Result no encontrado');
    const objectiveId = kr.objectiveId;
    await this.keyResultRepo.remove(kr);
    await this.recalculateProgressFromKRs(tenantId, objectiveId);
  }

  private async recalculateProgressFromKRs(tenantId: string, objectiveId: string): Promise<void> {
    const krs = await this.keyResultRepo.find({ where: { tenantId, objectiveId } });
    if (krs.length === 0) return;

    const totalProgress = krs.reduce((sum, kr) => {
      const range = Number(kr.targetValue) - Number(kr.baseValue);
      if (range <= 0) return sum + (kr.status === KRStatus.COMPLETED ? 100 : 0);
      const krProgress = Math.min(100, Math.max(0, ((Number(kr.currentValue) - Number(kr.baseValue)) / range) * 100));
      return sum + krProgress;
    }, 0);

    const avgProgress = Math.round(totalProgress / krs.length);
    await this.objectiveRepo.update({ id: objectiveId, tenantId }, { progress: avgProgress });
  }
}
