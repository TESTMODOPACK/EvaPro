import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Objective, ObjectiveStatus } from './entities/objective.entity';
import { ObjectiveUpdate } from './entities/objective-update.entity';
import { ObjectiveComment } from './entities/objective-comment.entity';
import { KeyResult, KRStatus } from './entities/key-result.entity';
import { User } from '../users/entities/user.entity';
import { EvaluationCycle, CycleStatus } from '../evaluations/entities/evaluation-cycle.entity';
import { CreateObjectiveDto } from './dto/create-objective.dto';
import { UpdateObjectiveDto, CreateObjectiveUpdateDto } from './dto/update-objective.dto';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';

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
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
  ) {}

  // ─── Validation Helpers ──────────────────────────────────────────────────────

  /** B7.1: targetDate cannot be in the past */
  private validateTargetDate(dateStr?: string): void {
    if (!dateStr) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(dateStr) < today) {
      throw new BadRequestException('La fecha objetivo no puede ser una fecha pasada');
    }
  }

  /** B7.2: Cycle must exist and not be closed */
  private async validateCycleOpen(cycleId: string, tenantId: string): Promise<void> {
    const cycle = await this.cycleRepo.findOne({ where: { id: cycleId, tenantId } });
    if (!cycle) throw new BadRequestException('El ciclo de evaluación no existe');
    if (cycle.status === CycleStatus.CLOSED) {
      throw new BadRequestException('No se puede asignar un objetivo a un ciclo de evaluación cerrado');
    }
  }

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateObjectiveDto): Promise<Objective> {
    // B7.1: targetDate must not be in the past
    this.validateTargetDate(dto.targetDate);
    // B7.2: cycleId must be an open cycle
    if (dto.cycleId) await this.validateCycleOpen(dto.cycleId, tenantId);
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
    const saved = await this.objectiveRepo.save(obj);
    this.auditService.log(tenantId, userId, 'objective.created', 'objective', saved.id, { title: dto.title, type: dto.type, assignedTo: userId }).catch(() => {});

    // Send email to the objective owner
    const owner = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'email', 'firstName'] });
    if (owner?.email) {
      this.emailService.sendObjectiveAssigned(owner.email, {
        firstName: owner.firstName,
        objectiveTitle: dto.title,
        objectiveType: dto.type || 'OKR',
        targetDate: dto.targetDate ? new Date(dto.targetDate).toLocaleDateString('es-CL') : undefined,
        tenantId,
      }).catch(() => {});
    }

    return saved;
  }

  // ─── Queries by role ────────────────────────────────────────────────────────

  /**
   * Shared queryBuilder: loads objectives with their user/updates/keyResults
   * and enforces tenant-match on every joined relation. Prevents cross-tenant
   * leaks caused by orphan FKs (e.g. objective.user_id pointing at a user in
   * a different tenant after a data migration).
   */
  private objectivesWithRelationsQb(tenantId: string) {
    return this.objectiveRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'user', 'user.tenant_id = o.tenant_id')
      .leftJoinAndSelect('o.updates', 'updates', 'updates.tenant_id = o.tenant_id')
      .leftJoinAndSelect('updates.creator', 'creator', 'creator.tenant_id = o.tenant_id')
      .leftJoinAndSelect('o.keyResults', 'kr', 'kr.tenant_id = o.tenant_id')
      .where('o.tenantId = :tenantId', { tenantId })
      .orderBy('o.createdAt', 'DESC');
  }

  /** All objectives in the tenant (for tenant_admin). Capped at 200
   *  to prevent OOM with tenants that accumulate 1000+ OKRs over time.
   *  The frontend applies its own client-side filtering on the capped set. */
  async findAll(tenantId: string, filterUserId?: string): Promise<Objective[]> {
    const qb = this.objectivesWithRelationsQb(tenantId);
    if (filterUserId) qb.andWhere('o.userId = :filterUserId', { filterUserId });
    return qb.take(200).getMany();
  }

  /** Objectives of manager's direct reports + own (for manager) */
  async findByManager(tenantId: string, managerId: string): Promise<Objective[]> {
    const subordinates = await this.userRepo.find({
      where: { tenantId, managerId, isActive: true },
      select: ['id'],
    });
    const userIds = [managerId, ...subordinates.map((u) => u.id)];

    return this.objectivesWithRelationsQb(tenantId)
      .andWhere('o.userId IN (:...userIds)', { userIds })
      .take(200)
      .getMany();
  }

  /** Only the user's own objectives (for employee) */
  async findByUser(tenantId: string, userId: string): Promise<Objective[]> {
    return this.objectivesWithRelationsQb(tenantId)
      .andWhere('o.userId = :userId', { userId })
      .take(200)
      .getMany();
  }

  /**
   * B1.3: OKR history grouped by evaluation cycle / period.
   * Returns closed/completed objectives with their Key Results, grouped by cycle.
   */
  async getObjectiveHistory(
    tenantId: string,
    userId?: string,
    cycleId?: string,
  ) {
    const qb = this.objectiveRepo.createQueryBuilder('o')
      .where('o.tenantId = :tenantId', { tenantId })
      .andWhere('o.status IN (:...statuses)', {
        statuses: [ObjectiveStatus.COMPLETED, ObjectiveStatus.ABANDONED],
      });

    if (userId) {
      qb.andWhere('o.userId = :userId', { userId });
    }
    if (cycleId) {
      qb.andWhere('o.cycleId = :cycleId', { cycleId });
    }

    qb.leftJoinAndSelect('o.user', 'user', 'user.tenant_id = o.tenant_id')
      .orderBy('o.updatedAt', 'DESC');

    const objectives = await qb.getMany();

    if (objectives.length === 0) {
      return { periods: [], totalObjectives: 0 };
    }

    // Load Key Results for all objectives
    const objectiveIds = objectives.map((o) => o.id);
    const keyResults = await this.keyResultRepo
      .createQueryBuilder('kr')
      .where('kr.objectiveId IN (:...ids)', { ids: objectiveIds })
      .getMany();

    const krByObjective = new Map<string, typeof keyResults>();
    for (const kr of keyResults) {
      const list = krByObjective.get(kr.objectiveId) || [];
      list.push(kr);
      krByObjective.set(kr.objectiveId, list);
    }

    // Group by cycleId (null cycleId grouped as 'sin_ciclo')
    const groups = new Map<string, Objective[]>();
    for (const obj of objectives) {
      const key = obj.cycleId || 'sin_ciclo';
      const list = groups.get(key) || [];
      list.push(obj);
      groups.set(key, list);
    }

    // Load cycle names
    const cycleIds = [...groups.keys()].filter((k) => k !== 'sin_ciclo');
    const cycles = cycleIds.length > 0
      ? await this.cycleRepo.find({ where: { id: In(cycleIds) }, select: ['id', 'name', 'startDate', 'endDate', 'type', 'period'] })
      : [];
    const cycleMap = new Map(cycles.map((c) => [c.id, c]));

    const periods = [...groups.entries()].map(([key, objs]) => {
      const cycle = cycleMap.get(key);
      const totalProgress = objs.reduce((sum, o) => sum + (o.progress || 0), 0);
      return {
        cycleId: key === 'sin_ciclo' ? null : key,
        cycleName: cycle?.name || 'Sin ciclo asignado',
        startDate: cycle?.startDate || null,
        endDate: cycle?.endDate || null,
        cycleType: cycle?.type || null,
        totalObjectives: objs.length,
        completedCount: objs.filter((o) => o.status === ObjectiveStatus.COMPLETED).length,
        abandonedCount: objs.filter((o) => o.status === ObjectiveStatus.ABANDONED).length,
        avgProgress: objs.length > 0 ? Math.round(totalProgress / objs.length) : 0,
        objectives: objs.map((o) => ({
          ...o,
          keyResults: krByObjective.get(o.id) || [],
        })),
      };
    });

    return {
      periods,
      totalObjectives: objectives.length,
    };
  }

  async findById(tenantId: string, id: string): Promise<Objective> {
    const obj = await this.objectiveRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'user', 'user.tenant_id = o.tenant_id')
      .where('o.id = :id', { id })
      .andWhere('o.tenantId = :tenantId', { tenantId })
      .getOne();
    if (!obj) throw new NotFoundException('Objetivo no encontrado');
    return obj;
  }

  async update(tenantId: string, id: string, dto: UpdateObjectiveDto): Promise<Objective> {
    const obj = await this.findById(tenantId, id);
    // B7.3: Cannot modify completed or abandoned objectives
    if (obj.status === ObjectiveStatus.COMPLETED || obj.status === ObjectiveStatus.ABANDONED) {
      throw new BadRequestException('No se pueden modificar objetivos completados o abandonados');
    }
    // B7.1: targetDate must not be in the past (only when field is being changed)
    if (dto.targetDate !== undefined) this.validateTargetDate(dto.targetDate);
    // B7.2: cycleId must be an open cycle (only when field is being changed)
    if (dto.cycleId !== undefined && dto.cycleId) await this.validateCycleOpen(dto.cycleId, tenantId);
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
    obj.rejectionReason = null; // Clear previous rejection reason
    const saved = await this.objectiveRepo.save(obj);
    this.auditService.log(tenantId, obj.userId, 'objective.submitted_for_approval', 'objective', id, { title: obj.title }).catch(() => {});

    // Notify manager that an objective needs approval
    const employee = await this.userRepo.findOne({ where: { id: obj.userId }, select: ['id', 'firstName', 'lastName', 'managerId'] });
    if (employee?.managerId) {
      const manager = await this.userRepo.findOne({ where: { id: employee.managerId }, select: ['id', 'email', 'firstName'] });
      if (manager?.email) {
        this.emailService.sendObjectiveAssigned(manager.email, {
          firstName: manager.firstName,
          objectiveTitle: `[Pendiente de aprobación] ${obj.title}`,
          objectiveType: obj.type || 'OKR',
          assignedBy: `${employee.firstName} ${employee.lastName}`,
          tenantId,
        }).catch(() => {});
      }
    }

    return saved;
  }

  async approve(tenantId: string, id: string, approvedBy?: string): Promise<Objective> {
    const obj = await this.findById(tenantId, id);
    if (obj.status !== ObjectiveStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Solo objetivos pendientes de aprobación pueden ser aprobados');
    }
    obj.status = ObjectiveStatus.ACTIVE;
    obj.approvedBy = approvedBy || null;
    obj.approvedAt = new Date();
    obj.rejectionReason = null;
    const saved = await this.objectiveRepo.save(obj);
    this.auditService.log(tenantId, approvedBy || obj.userId, 'objective.approved', 'objective', id, { title: obj.title, approvedBy }).catch(() => {});

    // Notify objective owner that it was approved
    const owner = await this.userRepo.findOne({ where: { id: obj.userId }, select: ['id', 'email', 'firstName'] });
    if (owner?.email) {
      this.emailService.sendObjectiveAssigned(owner.email, {
        firstName: owner.firstName,
        objectiveTitle: `[Aprobado] ${obj.title}`,
        objectiveType: obj.type || 'OKR',
        targetDate: obj.targetDate ? new Date(obj.targetDate).toLocaleDateString('es-CL') : undefined,
        tenantId,
      }).catch(() => {});
    }

    return saved;
  }

  async reject(tenantId: string, id: string, rejectedBy?: string, reason?: string): Promise<Objective> {
    const obj = await this.findById(tenantId, id);
    if (obj.status !== ObjectiveStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Solo objetivos pendientes de aprobación pueden ser rechazados');
    }
    obj.status = ObjectiveStatus.DRAFT;
    obj.rejectionReason = reason || null;
    obj.approvedBy = null;
    obj.approvedAt = null;
    const saved = await this.objectiveRepo.save(obj);
    this.auditService.log(tenantId, rejectedBy || obj.userId, 'objective.rejected', 'objective', id, { title: obj.title, rejectedBy, reason }).catch(() => {});

    // Notify objective owner that it was rejected
    const owner = await this.userRepo.findOne({ where: { id: obj.userId }, select: ['id', 'email', 'firstName'] });
    if (owner?.email) {
      this.emailService.sendObjectiveAssigned(owner.email, {
        firstName: owner.firstName,
        objectiveTitle: `[Rechazado] ${obj.title}`,
        objectiveType: reason ? `Motivo: ${reason}` : 'Sin motivo especificado',
        tenantId,
      }).catch(() => {});
    }

    return saved;
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const obj = await this.findById(tenantId, id);
    obj.status = ObjectiveStatus.ABANDONED;
    await this.objectiveRepo.save(obj);
    this.auditService.log(tenantId, obj.userId, 'objective.cancelled', 'objective', id, { title: obj.title }).catch(() => {});
  }

  // ─── Progress ───────────────────────────────────────────────────────────────

  async addProgressUpdate(
    tenantId: string,
    userId: string,
    objectiveId: string,
    dto: CreateObjectiveUpdateDto,
  ): Promise<ObjectiveUpdate> {
    // Validate notes FIRST (no DB operation needed)
    if (!dto.notes || dto.notes.trim().length === 0) {
      throw new BadRequestException('Debe indicar qué avance realizó para actualizar el progreso.');
    }

    const obj = await this.findById(tenantId, objectiveId);
    if (obj.status === ObjectiveStatus.COMPLETED) {
      throw new BadRequestException('Este objetivo ya está completado. No se puede actualizar el progreso');
    }
    if (obj.status === ObjectiveStatus.ABANDONED) {
      throw new BadRequestException('No se puede actualizar el progreso de un objetivo abandonado');
    }

    // OKR with Key Results: progress is calculated automatically from KRs
    const krs = await this.keyResultRepo.find({ where: { objectiveId } });
    if (obj.type === 'OKR' && krs.length > 0) {
      throw new BadRequestException(
        'Este objetivo OKR tiene Resultados Clave. El progreso se calcula automáticamente al actualizar los KRs. Use la sección "Resultados Clave" para registrar avances.',
      );
    }

    obj.progress = dto.progressValue;
    if (dto.progressValue >= 100) {
      // OKR: must have KRs defined and all completed
      if (obj.type === 'OKR') {
        if (krs.length === 0) {
          throw new BadRequestException('No se puede completar un OKR sin Resultados Clave definidos. Agregue al menos un KR.');
        }
        const incompleteKrs = krs.filter((kr: any) => kr.status !== 'completed');
        if (incompleteKrs.length > 0) {
          throw new BadRequestException(
            `No se puede completar: tiene ${incompleteKrs.length} Resultado(s) Clave pendiente(s). Complete los KRs primero.`,
          );
        }
      }
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
    const saved = await this.updateRepo.save(update);
    this.auditService.log(tenantId, userId, 'objective.progress_updated', 'objective', objectiveId, { title: obj.title, previousProgress: obj.progress, newProgress: dto.progressValue, notes: dto.notes }).catch(() => {});

    // Notify manager when objective is completed
    if (dto.progressValue >= 100) {
      const employee = await this.userRepo.findOne({ where: { id: obj.userId }, select: ['id', 'firstName', 'lastName', 'managerId'] });
      if (employee?.managerId) {
        const manager = await this.userRepo.findOne({ where: { id: employee.managerId }, select: ['id', 'email', 'firstName'] });
        if (manager?.email) {
          this.emailService.sendObjectiveCompleted(manager.email, {
            managerName: manager.firstName,
            employeeName: `${employee.firstName} ${employee.lastName}`,
            objectiveTitle: obj.title,
            objectiveType: obj.type || 'OKR',
            tenantId,
          }).catch(() => {});
        }
      }
    }

    return saved;
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
  async getAtRiskObjectives(tenantId: string, filterUserId?: string, role?: string, currentUserId?: string): Promise<Objective[]> {
    // Fetch all active objectives first, then filter intelligently
    const qb = this.objectiveRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'u', 'u.tenant_id = o.tenant_id')
      .where('o.tenantId = :tenantId', { tenantId })
      .andWhere('o.status = :status', { status: ObjectiveStatus.ACTIVE });

    if (role === 'manager' && currentUserId) {
      // Manager: only see at-risk objectives for their direct reports + own
      qb.andWhere('(o.userId = :mgr OR u.manager_id = :mgr)', { mgr: currentUserId });
    } else if (filterUserId) {
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
  async getObjectiveTree(tenantId: string, role?: string, currentUserId?: string): Promise<any[]> {
    const qb = this.objectiveRepo.createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'u')
      .where('o.tenantId = :tenantId', { tenantId })
      .orderBy('o.createdAt', 'ASC');

    // Manager: only see objectives from their team + own
    if (role === 'manager' && currentUserId) {
      qb.andWhere('(o.userId = :mgr OR u.manager_id = :mgr)', { mgr: currentUserId });
    }

    const all = await qb.getMany();

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
    // B7.6: targetValue must be > 0
    const base = data.baseValue ?? 0;
    const target = data.targetValue ?? 100;
    if (target <= 0) {
      throw new BadRequestException('El valor objetivo del KR debe ser mayor a 0');
    }
    // B7.7: targetValue must not equal baseValue (division by zero in progress calc)
    if (target === base) {
      throw new BadRequestException('El valor objetivo no puede ser igual al valor base (causaría división por cero)');
    }
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

  // ─── Export ────────────────────────────────────────────────────────────

  private escapeCsv(val: any): string {
    const str = String(val ?? '');
    return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
  }

  private async getExportData(tenantId: string, userId?: string, role?: string): Promise<any[]> {
    if (role === 'employee' || role === 'external') {
      return this.findByUser(tenantId, userId!);
    }
    if (role === 'manager' && userId) {
      return this.findByManager(tenantId, userId);
    }
    return this.findAll(tenantId);
  }

  async exportObjectivesCsv(tenantId: string, userId?: string, role?: string): Promise<string> {
    const objectives = await this.getExportData(tenantId, userId, role);
    const rows: string[] = [];
    rows.push('Título,Tipo,Estado,Progreso %,Peso,Fecha Meta,Responsable,Departamento');
    const statusLabels: Record<string, string> = { draft: 'Borrador', pending_approval: 'Pendiente', active: 'Activo', completed: 'Completado', abandoned: 'Abandonado' };
    for (const obj of objectives) {
      const userName = obj.user ? `${obj.user.firstName || ''} ${obj.user.lastName || ''}`.trim() : '';
      const dept = obj.user?.department || '';
      rows.push([
        this.escapeCsv(obj.title), obj.type || 'OKR', statusLabels[obj.status] || obj.status,
        obj.progress, obj.weight || 0,
        obj.targetDate ? new Date(obj.targetDate).toLocaleDateString('es-CL') : '',
        this.escapeCsv(userName), this.escapeCsv(dept),
      ].join(','));
    }
    return '\uFEFF' + rows.join('\n');
  }

  async exportObjectivesXlsx(tenantId: string, userId?: string, role?: string): Promise<Buffer> {
    const objectives = await this.getExportData(tenantId, userId, role);
    const statusLabels: Record<string, string> = { draft: 'Borrador', pending_approval: 'Pendiente', active: 'Activo', completed: 'Completado', abandoned: 'Abandonado' };

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const accent = { argb: 'FFC9933A' };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const headerFill: any = { type: 'pattern', pattern: 'solid', fgColor: accent };

    // Sheet 1: Resumen
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 25 }, { width: 15 }];
    ws1.addRow(['Objetivos / OKRs']).font = { bold: true, size: 14 };
    ws1.addRow([]);
    const total = objectives.length;
    const active = objectives.filter((o: any) => o.status === 'active').length;
    const completed = objectives.filter((o: any) => o.status === 'completed').length;
    const atRisk = objectives.filter((o: any) => o.status === 'active' && o.progress < 40).length;
    const avgProgress = total > 0 ? Math.round(objectives.reduce((s: number, o: any) => s + (o.progress || 0), 0) / total) : 0;
    ws1.addRow(['Total objetivos', total]);
    ws1.addRow(['Activos', active]);
    ws1.addRow(['Completados', completed]);
    ws1.addRow(['En riesgo (<40%)', atRisk]);
    ws1.addRow(['Progreso promedio', `${avgProgress}%`]);
    ws1.addRow(['Fecha exportación', new Date().toLocaleDateString('es-CL')]);

    // Sheet 2: Detalle
    const ws2 = wb.addWorksheet('Objetivos');
    ws2.columns = [
      { width: 35 }, { width: 10 }, { width: 14 }, { width: 12 },
      { width: 10 }, { width: 14 }, { width: 22 }, { width: 18 },
    ];
    const h2 = ws2.addRow(['Título', 'Tipo', 'Estado', 'Progreso %', 'Peso', 'Fecha Meta', 'Responsable', 'Departamento']);
    h2.eachCell((cell) => { cell.font = headerFont; cell.fill = headerFill; });
    for (const obj of objectives) {
      const userName = obj.user ? `${obj.user.firstName || ''} ${obj.user.lastName || ''}`.trim() : '';
      ws2.addRow([
        obj.title, obj.type || 'OKR', statusLabels[obj.status] || obj.status,
        obj.progress, obj.weight || 0,
        obj.targetDate ? new Date(obj.targetDate).toLocaleDateString('es-CL') : '',
        userName, obj.user?.department || '',
      ]);
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async exportObjectivesPdf(tenantId: string, userId?: string, role?: string): Promise<Buffer> {
    const objectives = await this.getExportData(tenantId, userId, role);
    const statusLabels: Record<string, string> = { draft: 'Borrador', pending_approval: 'Pendiente', active: 'Activo', completed: 'Completado', abandoned: 'Abandonado' };

    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF('l', 'mm', 'a4'); // landscape for more columns
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;

    // Header
    doc.setFillColor(26, 18, 6);
    doc.rect(0, 0, pageW, 30, 'F');
    doc.setTextColor(245, 228, 168);
    doc.setFontSize(16);
    doc.text('Objetivos / OKRs', margin, 16);
    doc.setFontSize(9);
    doc.setTextColor(201, 147, 58);
    doc.text(`Exportado el ${new Date().toLocaleDateString('es-CL')}`, margin, 24);

    let y = 38;

    // KPIs
    const total = objectives.length;
    const active = objectives.filter((o: any) => o.status === 'active').length;
    const completedCount = objectives.filter((o: any) => o.status === 'completed').length;
    const atRisk = objectives.filter((o: any) => o.status === 'active' && o.progress < 40).length;
    const avgProgress = total > 0 ? Math.round(objectives.reduce((s: number, o: any) => s + (o.progress || 0), 0) / total) : 0;

    const kpis = [
      { label: 'Total', value: `${total}` },
      { label: 'Activos', value: `${active}` },
      { label: 'Completados', value: `${completedCount}` },
      { label: 'En Riesgo', value: `${atRisk}` },
      { label: 'Progreso Prom.', value: `${avgProgress}%` },
    ];
    const kpiW = (pageW - 2 * margin - 4 * 4) / 5;
    kpis.forEach((kpi, i) => {
      const x = margin + i * (kpiW + 4);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, kpiW, 18, 2, 2, 'F');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.label, x + kpiW / 2, y + 7, { align: 'center' });
      doc.setFontSize(12);
      doc.setTextColor(26, 18, 6);
      doc.text(kpi.value, x + kpiW / 2, y + 15, { align: 'center' });
    });
    y += 26;

    // Table
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Título', 'Tipo', 'Estado', 'Progreso', 'Peso', 'Fecha Meta', 'Responsable']],
      body: objectives.map((o: any) => [
        o.title, o.type || 'OKR', statusLabels[o.status] || o.status,
        `${o.progress}%`, o.weight || 0,
        o.targetDate ? new Date(o.targetDate).toLocaleDateString('es-CL') : '-',
        o.user ? `${o.user.firstName || ''} ${o.user.lastName || ''}`.trim() : '',
      ]),
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
      doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} — Eva360`, margin, doc.internal.pageSize.getHeight() - 8);
      doc.text(`Página ${i} de ${pageCount}`, pageW - margin, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
    }

    return Buffer.from(doc.output('arraybuffer'));
  }

  // ─── Tree Export (hierarchical view) ─────────────────────────────────

  private flattenTree(nodes: any[], depth = 0): any[] {
    const result: any[] = [];
    for (const node of nodes) {
      result.push({ ...node, depth });
      if (node.children?.length) {
        result.push(...this.flattenTree(node.children, depth + 1));
      }
    }
    return result;
  }

  async exportObjectivesTreeXlsx(tenantId: string, role?: string, userId?: string): Promise<Buffer> {
    const tree = await this.getObjectiveTree(tenantId, role, userId);
    const flat = this.flattenTree(tree);
    const statusLabels: Record<string, string> = { draft: 'Borrador', pending_approval: 'Pendiente', active: 'Activo', completed: 'Completado', abandoned: 'Abandonado' };

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const accent = { argb: 'FFC9933A' };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const headerFill: any = { type: 'pattern', pattern: 'solid', fgColor: accent };

    // Sheet 1: Resumen
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 25 }, { width: 15 }];
    ws1.addRow(['Objetivos / OKRs — Vista Árbol']).font = { bold: true, size: 14 };
    ws1.addRow([]);
    const total = flat.length;
    const active = flat.filter(o => o.status === 'active').length;
    const completed = flat.filter(o => o.status === 'completed').length;
    const roots = tree.length;
    ws1.addRow(['Total objetivos', total]);
    ws1.addRow(['Objetivos raíz', roots]);
    ws1.addRow(['Activos', active]);
    ws1.addRow(['Completados', completed]);
    ws1.addRow(['Fecha exportación', new Date().toLocaleDateString('es-CL')]);

    // Sheet 2: Árbol
    const ws2 = wb.addWorksheet('Árbol de Objetivos');
    ws2.columns = [
      { width: 6 }, { width: 40 }, { width: 10 }, { width: 14 }, { width: 12 },
      { width: 10 }, { width: 14 }, { width: 22 },
    ];
    const h2 = ws2.addRow(['Nivel', 'Título', 'Tipo', 'Estado', 'Progreso %', 'Peso', 'Fecha Meta', 'Responsable']);
    h2.eachCell((cell) => { cell.font = headerFont; cell.fill = headerFill; });
    for (const obj of flat) {
      const indent = '  '.repeat(obj.depth);
      const prefix = obj.depth > 0 ? '└ ' : '';
      const row = ws2.addRow([
        obj.depth, `${indent}${prefix}${obj.title}`,
        obj.type || 'OKR', statusLabels[obj.status] || obj.status,
        obj.progress, obj.weight || 0,
        obj.targetDate ? new Date(obj.targetDate).toLocaleDateString('es-CL') : '',
        obj.userName || '',
      ]);
      if (obj.depth > 0) {
        row.getCell(2).font = { italic: true, color: { argb: 'FF6B7280' } };
      }
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async exportObjectivesTreePdf(tenantId: string, role?: string, userId?: string): Promise<Buffer> {
    const tree = await this.getObjectiveTree(tenantId, role, userId);
    const flat = this.flattenTree(tree);
    const statusLabels: Record<string, string> = { draft: 'Borrador', pending_approval: 'Pendiente', active: 'Activo', completed: 'Completado', abandoned: 'Abandonado' };

    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF('l', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;

    // Header
    doc.setFillColor(26, 18, 6);
    doc.rect(0, 0, pageW, 30, 'F');
    doc.setTextColor(245, 228, 168);
    doc.setFontSize(16);
    doc.text('Objetivos / OKRs — Vista Árbol', margin, 16);
    doc.setFontSize(9);
    doc.setTextColor(201, 147, 58);
    doc.text(`Exportado el ${new Date().toLocaleDateString('es-CL')}`, margin, 24);

    let y = 38;

    // KPIs
    const total = flat.length;
    const active = flat.filter(o => o.status === 'active').length;
    const completedCount = flat.filter(o => o.status === 'completed').length;
    const roots = tree.length;

    const kpis = [
      { label: 'Total', value: `${total}` },
      { label: 'Raíz', value: `${roots}` },
      { label: 'Activos', value: `${active}` },
      { label: 'Completados', value: `${completedCount}` },
    ];
    const kpiW = (pageW - 2 * margin - 3 * 4) / 4;
    kpis.forEach((kpi, i) => {
      const x = margin + i * (kpiW + 4);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, kpiW, 18, 2, 2, 'F');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.label, x + kpiW / 2, y + 7, { align: 'center' });
      doc.setFontSize(12);
      doc.setTextColor(26, 18, 6);
      doc.text(kpi.value, x + kpiW / 2, y + 15, { align: 'center' });
    });
    y += 26;

    // Table with indentation
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Título', 'Tipo', 'Estado', 'Progreso', 'Peso', 'Fecha Meta', 'Responsable']],
      body: flat.map((o: any) => {
        const indent = '  '.repeat(o.depth);
        const prefix = o.depth > 0 ? '└ ' : '';
        return [
          `${indent}${prefix}${o.title}`, o.type || 'OKR', statusLabels[o.status] || o.status,
          `${o.progress}%`, o.weight || 0,
          o.targetDate ? new Date(o.targetDate).toLocaleDateString('es-CL') : '-',
          o.userName || '',
        ];
      }),
      headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (data: any) => {
        // Bold root objectives
        if (data.section === 'body' && data.column.index === 0) {
          const rowFlat = flat[data.row.index];
          if (rowFlat && rowFlat.depth === 0) {
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
    });

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} — Eva360`, margin, doc.internal.pageSize.getHeight() - 8);
      doc.text(`Página ${i} de ${pageCount}`, pageW - margin, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
    }

    return Buffer.from(doc.output('arraybuffer'));
  }
}
