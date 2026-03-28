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
    // B3.15: Validate parent objective if provided
    if (dto.parentObjectiveId) {
      await this.validateParentObjective(tenantId, dto.parentObjectiveId);
    }

    const obj = this.objectiveRepo.create({
      tenantId,
      userId,
      title: dto.title,
      description: dto.description,
      type: dto.type,
      targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
      cycleId: dto.cycleId,
      weight: dto.weight ?? 0,
      parentObjectiveId: dto.parentObjectiveId || null,
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
    if (dto.parentObjectiveId !== undefined) {
      if (dto.parentObjectiveId) {
        if (dto.parentObjectiveId === id) {
          throw new BadRequestException('Un objetivo no puede ser padre de sí mismo');
        }
        await this.validateParentObjective(tenantId, dto.parentObjectiveId, id);
      }
      obj.parentObjectiveId = dto.parentObjectiveId || null;
    }
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

    // B3.15: Propagate progress to parent objective
    await this.propagateProgressToParent(tenantId, objectiveId);

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

  // B2.11: Objectives at risk — considers both progress AND time elapsed
  // An objective is at-risk if its progress is behind the expected pace
  // Expected pace = (elapsed time / total time) * 100
  // At-risk when: progress < expectedPace * 0.6 (40% behind expected) OR progress < 40% with no target date
  async getAtRiskObjectives(tenantId: string, filterUserId?: string): Promise<Objective[]> {
    // Fetch all active objectives first, then filter intelligently
    const qb = this.objectiveRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'u')
      .where('o.tenantId = :tenantId', { tenantId })
      .andWhere('o.status = :status', { status: ObjectiveStatus.ACTIVE });
    if (filterUserId) {
      qb.andWhere('o.userId = :filterUserId', { filterUserId });
    }
    const activeObjectives = await qb.orderBy('o.progress', 'ASC').getMany();

    const now = new Date();
    return activeObjectives.filter((o) => {
      if (!o.targetDate) {
        // No target date: fallback to simple threshold
        return o.progress < 40;
      }

      const createdAt = new Date(o.createdAt);
      const targetDate = new Date(o.targetDate);
      const totalDuration = targetDate.getTime() - createdAt.getTime();

      if (totalDuration <= 0) {
        // Target date already passed or same day → at risk if not done
        return o.progress < 100;
      }

      const elapsed = now.getTime() - createdAt.getTime();
      const timeRatio = Math.min(elapsed / totalDuration, 1); // 0..1
      const expectedProgress = timeRatio * 100; // Expected % if linear pace

      // At-risk if progress is less than 60% of what's expected at this point in time
      return o.progress < expectedProgress * 0.6;
    });
  }

  async getCompletionStats(tenantId: string, userId: string) {
    const total = await this.objectiveRepo.count({ where: { tenantId, userId } });
    const completed = await this.objectiveRepo.count({
      where: { tenantId, userId, status: ObjectiveStatus.COMPLETED },
    });
    return { total, completed, inProgress: total - completed };
  }

  // ─── Team Summary (B4 Item 12) ─────────────────────────────────────────────

  async getTeamObjectivesSummary(tenantId: string, managerId?: string) {
    // managerId undefined = admin view (all active users in tenant)
    const subordinates = await this.userRepo.find({
      where: managerId
        ? { tenantId, managerId, isActive: true }
        : { tenantId, isActive: true },
      select: ['id', 'firstName', 'lastName', 'position', 'department'],
    });

    if (subordinates.length === 0) {
      return { members: [], totals: { totalMembers: 0, totalObjectives: 0, totalAtRisk: 0, avgProgress: 0 } };
    }

    const userIds = subordinates.map((u) => u.id);

    // Single query: all objectives for all subordinates
    const allObjectives = await this.objectiveRepo.find({
      where: { tenantId, userId: In(userIds) },
    });

    // Group by userId
    const byUser = new Map<string, typeof allObjectives>();
    for (const obj of allObjectives) {
      const list = byUser.get(obj.userId) || [];
      list.push(obj);
      byUser.set(obj.userId, list);
    }

    const summary = subordinates.map((user) => {
      const objectives = byUser.get(user.id) || [];
      const active = objectives.filter((o) => o.status === ObjectiveStatus.ACTIVE);
      const completed = objectives.filter((o) => o.status === ObjectiveStatus.COMPLETED);
      const atRisk = active.filter((o) => o.progress < 40);
      const totalWeight = active.reduce((sum, o) => sum + Number(o.weight || 0), 0);
      const avgProgress = active.length > 0
        ? Math.round(active.reduce((sum, o) => sum + o.progress, 0) / active.length)
        : 0;

      return {
        userId: user.id,
        userName: `${user.firstName} ${user.lastName}`,
        position: user.position,
        department: user.department,
        totalObjectives: objectives.length,
        activeCount: active.length,
        completedCount: completed.length,
        atRiskCount: atRisk.length,
        avgProgress,
        totalWeight,
      };
    });

    const teamTotals = {
      totalMembers: subordinates.length,
      totalObjectives: summary.reduce((s, m) => s + m.totalObjectives, 0),
      totalAtRisk: summary.reduce((s, m) => s + m.atRiskCount, 0),
      avgProgress: summary.length > 0
        ? Math.round(summary.reduce((s, m) => s + m.avgProgress, 0) / summary.length)
        : 0,
    };

    return { members: summary, totals: teamTotals };
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

  // ─── Objective Tree / Cascading OKR (B3.15) ────────────────────────────────

  /**
   * Returns all objectives for a tenant organized as a tree.
   * Root objectives (parentObjectiveId = null) are at the top,
   * with children nested recursively.
   */
  async getObjectiveTree(tenantId: string): Promise<any[]> {
    const all = await this.objectiveRepo.find({
      where: { tenantId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });

    const map = new Map<string, any>();
    for (const obj of all) {
      map.set(obj.id, {
        id: obj.id,
        title: obj.title,
        description: obj.description,
        type: obj.type,
        status: obj.status,
        progress: obj.progress,
        weight: Number(obj.weight),
        targetDate: obj.targetDate,
        parentObjectiveId: obj.parentObjectiveId,
        userId: obj.userId,
        userName: obj.user ? `${obj.user.firstName} ${obj.user.lastName}` : null,
        userPosition: obj.user?.position || null,
        children: [],
      });
    }

    const roots: any[] = [];
    for (const node of map.values()) {
      if (node.parentObjectiveId && map.has(node.parentObjectiveId)) {
        map.get(node.parentObjectiveId).children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  /**
   * Validates that a parent objective exists, belongs to same tenant,
   * and doesn't create a circular reference.
   */
  private async validateParentObjective(tenantId: string, parentId: string, currentId?: string): Promise<void> {
    const parent = await this.objectiveRepo.findOne({ where: { id: parentId, tenantId } });
    if (!parent) {
      throw new BadRequestException('El objetivo padre no existe en esta organización');
    }

    // Check for circular reference: walk up the chain
    if (currentId) {
      let checkId: string | null = parent.parentObjectiveId;
      const visited = new Set<string>([currentId]);
      while (checkId) {
        if (visited.has(checkId)) {
          throw new BadRequestException('No se puede crear una referencia circular entre objetivos');
        }
        visited.add(checkId);
        const ancestor = await this.objectiveRepo.findOne({ where: { id: checkId, tenantId } });
        checkId = ancestor?.parentObjectiveId || null;
      }
    }
  }

  /**
   * When a child objective updates its progress, recalculate the parent's
   * progress as the weighted average of all its children.
   */
  async propagateProgressToParent(tenantId: string, objectiveId: string): Promise<void> {
    const obj = await this.objectiveRepo.findOne({ where: { id: objectiveId, tenantId } });
    if (!obj?.parentObjectiveId) return;

    const siblings = await this.objectiveRepo.find({
      where: { tenantId, parentObjectiveId: obj.parentObjectiveId },
    });

    if (siblings.length === 0) return;

    const totalWeight = siblings.reduce((sum, s) => sum + Number(s.weight || 0), 0);

    let parentProgress: number;
    if (totalWeight > 0) {
      // Weighted average
      parentProgress = Math.round(
        siblings.reduce((sum, s) => sum + (s.progress * Number(s.weight || 0)), 0) / totalWeight,
      );
    } else {
      // Simple average if no weights
      parentProgress = Math.round(
        siblings.reduce((sum, s) => sum + s.progress, 0) / siblings.length,
      );
    }

    await this.objectiveRepo.update(
      { id: obj.parentObjectiveId, tenantId },
      { progress: Math.min(100, parentProgress) },
    );

    // Recurse up the chain
    await this.propagateProgressToParent(tenantId, obj.parentObjectiveId);
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
