import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Objective, ObjectiveStatus } from './entities/objective.entity';
import { ObjectiveUpdate } from './entities/objective-update.entity';
import { ObjectiveComment } from './entities/objective-comment.entity';
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
}
