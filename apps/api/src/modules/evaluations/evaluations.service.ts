import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { EvaluationCycle, CycleType, CycleStatus, CyclePeriod } from './entities/evaluation-cycle.entity';
import { EvaluationAssignment, AssignmentStatus, RelationType } from './entities/evaluation-assignment.entity';
import { EvaluationResponse } from './entities/evaluation-response.entity';
import { CycleStage, StageType, StageStatus } from './entities/cycle-stage.entity';
import { FormTemplate } from '../templates/entities/form-template.entity';
import { User } from '../users/entities/user.entity';
import { PeerAssignment } from './entities/peer-assignment.entity';
import { CreateCycleDto, UpdateCycleDto } from './dto/cycle.dto';
import { SaveResponseDto, SubmitResponseDto } from './dto/response.dto';
import { AddPeerAssignmentDto, BulkPeerAssignmentDto } from './dto/peer-assignment.dto';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { EmailService } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { PlanFeature } from '../../common/constants/plan-features';
import { Objective, ObjectiveStatus } from '../objectives/entities/objective.entity';
import { KeyResult } from '../objectives/entities/key-result.entity';

@Injectable()
export class EvaluationsService {
  private readonly logger = new Logger(EvaluationsService.name);

  constructor(
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
    @InjectRepository(EvaluationAssignment)
    private readonly assignmentRepo: Repository<EvaluationAssignment>,
    @InjectRepository(EvaluationResponse)
    private readonly responseRepo: Repository<EvaluationResponse>,
    @InjectRepository(FormTemplate)
    private readonly templateRepo: Repository<FormTemplate>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(PeerAssignment)
    private readonly peerAssignmentRepo: Repository<PeerAssignment>,
    @InjectRepository(CycleStage)
    private readonly stageRepo: Repository<CycleStage>,
    @InjectRepository(Objective)
    private readonly objectiveRepo: Repository<Objective>,
    @InjectRepository(KeyResult)
    private readonly keyResultRepo: Repository<KeyResult>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── Cycles ───────────────────────────────────────────────────────────────

  async findAllCycles(tenantId: string): Promise<EvaluationCycle[]> {
    return this.cycleRepo
      .createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('c.status != :cancelled', { cancelled: CycleStatus.CANCELLED })
      .orderBy('c.created_at', 'DESC')
      .take(200) // Safety cap — cycles are low-volume (~50 for 3 years of operation)
      .getMany();
  }

  async findCycleById(id: string, tenantId: string): Promise<EvaluationCycle> {
    const cycle = await this.cycleRepo.findOne({ where: { id, tenantId } });
    if (!cycle) throw new NotFoundException('Ciclo de evaluación no encontrado');
    return cycle;
  }

  async createCycle(tenantId: string, userId: string, dto: CreateCycleDto): Promise<EvaluationCycle> {
    if (new Date(dto.startDate) >= new Date(dto.endDate)) {
      throw new BadRequestException('La fecha de inicio debe ser anterior a la fecha de fin');
    }

    // Validate evaluation type against subscription plan
    const cycleType = dto.type ?? CycleType.DEGREE_90;
    const sub = await this.subscriptionsService.findByTenantId(tenantId);
    if (sub?.plan) {
      const features: string[] = sub.plan.features || [];
      if ((cycleType === CycleType.DEGREE_270) && !features.includes(PlanFeature.EVAL_270)) {
        throw new ForbiddenException(
          `Su plan "${sub.plan.name}" no incluye evaluaciones 270°. Actualice a un plan superior.`,
        );
      }
      if ((cycleType === CycleType.DEGREE_360) && !features.includes(PlanFeature.EVAL_360)) {
        throw new ForbiddenException(
          `Su plan "${sub.plan.name}" no incluye evaluaciones 360°. Actualice a un plan superior.`,
        );
      }
    }

    const cycle = this.cycleRepo.create({
      tenantId,
      name: dto.name,
      type: dto.type ?? CycleType.DEGREE_90,
      period: dto.period ?? CyclePeriod.ANNUAL,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      description: dto.description,
      templateId: dto.templateId,
      settings: dto.settings ?? {},
      createdBy: userId,
      status: CycleStatus.DRAFT,
    });
    const saved = await this.cycleRepo.save(cycle);

    // B3.14b: Auto-generate stages based on cycle type
    await this.generateStagesForCycle(saved);

    await this.auditService.log(tenantId, userId, 'cycle.created', 'cycle', saved.id);
    return saved;
  }

  // ─── Cycle Stages (B3.14) ──────────────────────────────────────────────

  /**
   * Generates the sequential stages for a cycle based on its type.
   *
   * Mapping:
   *   90°  → [Autoevaluación, Evaluación Encargado, Cierre]
   *   180° → [Autoevaluación, Evaluación Encargado, Cierre]
   *   270° → [Autoevaluación, Evaluación Encargado, Evaluación de Pares, Cierre]
   *   360° → [Autoevaluación, Evaluación Encargado, Evaluación de Pares, Calibración, Entrega de Feedback, Cierre]
   */
  private async generateStagesForCycle(cycle: EvaluationCycle): Promise<void> {
    const stageMap: Record<string, Array<{ name: string; type: StageType }>> = {
      [CycleType.DEGREE_90]: [
        { name: 'Autoevaluación', type: StageType.SELF_EVALUATION },
        { name: 'Evaluación del Encargado', type: StageType.MANAGER_EVALUATION },
        { name: 'Cierre', type: StageType.CLOSED },
      ],
      [CycleType.DEGREE_180]: [
        { name: 'Autoevaluación', type: StageType.SELF_EVALUATION },
        { name: 'Evaluación del Encargado', type: StageType.MANAGER_EVALUATION },
        { name: 'Cierre', type: StageType.CLOSED },
      ],
      [CycleType.DEGREE_270]: [
        { name: 'Autoevaluación', type: StageType.SELF_EVALUATION },
        { name: 'Evaluación del Encargado', type: StageType.MANAGER_EVALUATION },
        { name: 'Evaluación de Pares', type: StageType.PEER_EVALUATION },
        { name: 'Cierre', type: StageType.CLOSED },
      ],
      [CycleType.DEGREE_360]: [
        { name: 'Autoevaluación', type: StageType.SELF_EVALUATION },
        { name: 'Evaluación del Encargado', type: StageType.MANAGER_EVALUATION },
        { name: 'Evaluación de Pares', type: StageType.PEER_EVALUATION },
        { name: 'Calibración', type: StageType.CALIBRATION },
        { name: 'Entrega de Feedback', type: StageType.FEEDBACK_DELIVERY },
        { name: 'Cierre', type: StageType.CLOSED },
      ],
    };

    const stages = stageMap[cycle.type] || stageMap[CycleType.DEGREE_90];
    const totalStages = stages.length;
    const cycleDuration = cycle.endDate.getTime() - cycle.startDate.getTime();

    const entities = stages.map((s, i) => {
      const stageStart = new Date(cycle.startDate.getTime() + (cycleDuration * i) / totalStages);
      const stageEnd = new Date(cycle.startDate.getTime() + (cycleDuration * (i + 1)) / totalStages);
      return this.stageRepo.create({
        tenantId: cycle.tenantId,
        cycleId: cycle.id,
        name: s.name,
        type: s.type,
        stageOrder: i + 1,
        startDate: stageStart,
        endDate: stageEnd,
        status: i === 0 ? StageStatus.ACTIVE : StageStatus.PENDING,
      });
    });

    await this.stageRepo.save(entities);
  }

  async findStagesByCycle(cycleId: string, tenantId: string): Promise<CycleStage[]> {
    return this.stageRepo.find({
      where: { cycleId, tenantId },
      order: { stageOrder: 'ASC' },
    });
  }

  /**
   * Avanza el ciclo a la siguiente etapa.
   *
   * Validaciones:
   * - La etapa actual debe estar activa
   * - Para SELF_EVALUATION: todas las autoevaluaciones del ciclo deben estar completadas
   * - Para MANAGER_EVALUATION: todas las evaluaciones de manager deben estar completadas
   * - Para PEER_EVALUATION: todas las evaluaciones de pares deben estar completadas
   * - CALIBRATION y FEEDBACK_DELIVERY: avance manual por admin
   */
  async advanceStage(cycleId: string, tenantId: string, userId: string): Promise<CycleStage> {
    const stages = await this.findStagesByCycle(cycleId, tenantId);
    if (stages.length === 0) {
      throw new BadRequestException('Este ciclo no tiene etapas configuradas');
    }

    const activeStage = stages.find((s) => s.status === StageStatus.ACTIVE);
    if (!activeStage) {
      throw new BadRequestException('No hay una etapa activa en este ciclo');
    }

    // Validate completion requirements for auto-validated stages
    await this.validateStageCompletion(cycleId, tenantId, activeStage);

    // Complete current stage
    activeStage.status = StageStatus.COMPLETED;
    await this.stageRepo.save(activeStage);

    // Activate next stage
    const nextStage = stages.find((s) => s.stageOrder === activeStage.stageOrder + 1);
    if (nextStage) {
      nextStage.status = StageStatus.ACTIVE;
      await this.stageRepo.save(nextStage);

      // If the next stage is CLOSED, also close the cycle
      if (nextStage.type === StageType.CLOSED) {
        await this.cycleRepo.update({ id: cycleId, tenantId }, { status: CycleStatus.CLOSED });
        nextStage.status = StageStatus.COMPLETED;
        await this.stageRepo.save(nextStage);
      }

      await this.auditService.log(tenantId, userId, 'cycle.stage_advanced', 'cycle_stage', nextStage.id, {
        from: activeStage.name,
        to: nextStage.name,
      });
      return nextStage;
    }

    return activeStage;
  }

  private async validateStageCompletion(cycleId: string, tenantId: string, stage: CycleStage): Promise<void> {
    if (stage.type === StageType.SELF_EVALUATION) {
      const pendingSelf = await this.assignmentRepo.count({
        where: { cycleId, tenantId, relationType: RelationType.SELF, status: AssignmentStatus.IN_PROGRESS },
      });
      if (pendingSelf > 0) {
        throw new BadRequestException(
          `No se puede avanzar: quedan ${pendingSelf} autoevaluación(es) pendiente(s)`,
        );
      }
    }

    if (stage.type === StageType.MANAGER_EVALUATION) {
      const pendingManager = await this.assignmentRepo.count({
        where: { cycleId, tenantId, relationType: RelationType.MANAGER, status: AssignmentStatus.IN_PROGRESS },
      });
      if (pendingManager > 0) {
        throw new BadRequestException(
          `No se puede avanzar: quedan ${pendingManager} evaluación(es) del encargado pendiente(s)`,
        );
      }
    }

    if (stage.type === StageType.PEER_EVALUATION) {
      const pendingPeer = await this.assignmentRepo.count({
        where: { cycleId, tenantId, relationType: RelationType.PEER, status: AssignmentStatus.IN_PROGRESS },
      });
      if (pendingPeer > 0) {
        throw new BadRequestException(
          `No se puede avanzar: quedan ${pendingPeer} evaluación(es) de pares pendiente(s)`,
        );
      }
    }
    // CALIBRATION and FEEDBACK_DELIVERY: manual advance by admin (no auto-validation)
  }

  async updateStage(stageId: string, tenantId: string, data: { startDate?: string; endDate?: string; name?: string }): Promise<CycleStage> {
    const stage = await this.stageRepo.findOne({ where: { id: stageId, tenantId } });
    if (!stage) throw new NotFoundException('Etapa no encontrada');

    const newStart = data.startDate ? new Date(data.startDate) : stage.startDate;
    const newEnd = data.endDate ? new Date(data.endDate) : stage.endDate;

    if (newStart >= newEnd) {
      throw new BadRequestException('La fecha de inicio de la etapa debe ser anterior a la fecha de fin');
    }

    // B6.1: Validate no date overlap with other stages of the same cycle
    if (data.startDate || data.endDate) {
      await this.validateStageOverlap(stage.cycleId, tenantId, stageId, newStart, newEnd);
    }

    if (data.startDate) stage.startDate = newStart;
    if (data.endDate) stage.endDate = newEnd;
    if (data.name) stage.name = data.name;
    return this.stageRepo.save(stage);
  }

  private async validateStageOverlap(
    cycleId: string,
    tenantId: string,
    excludeStageId: string,
    newStart: Date,
    newEnd: Date,
  ): Promise<void> {
    const otherStages = await this.stageRepo.find({
      where: { cycleId, tenantId },
    });

    for (const other of otherStages) {
      if (other.id === excludeStageId) continue;
      if (!other.startDate || !other.endDate) continue;

      const otherStart = new Date(other.startDate);
      const otherEnd = new Date(other.endDate);

      // Check overlap: two ranges overlap if one starts before the other ends and vice versa
      if (newStart < otherEnd && newEnd > otherStart) {
        throw new BadRequestException(
          `Las fechas se superponen con la etapa "${other.name}" (${otherStart.toISOString().slice(0, 10)} - ${otherEnd.toISOString().slice(0, 10)}). Las etapas no pueden tener fechas solapadas.`,
        );
      }
    }
  }

  async updateCycle(id: string, tenantId: string, dto: UpdateCycleDto, userId?: string): Promise<EvaluationCycle> {
    const cycle = await this.findCycleById(id, tenantId);
    const effectiveStart = dto.startDate ? new Date(dto.startDate) : cycle.startDate;
    const effectiveEnd = dto.endDate ? new Date(dto.endDate) : cycle.endDate;
    if (effectiveStart >= effectiveEnd) {
      throw new BadRequestException('La fecha de inicio debe ser anterior a la fecha de fin');
    }

    // Capture before values for audit trail
    const changes: Record<string, { before: any; after: any }> = {};
    const trackFields = ['name', 'type', 'period', 'startDate', 'endDate', 'description', 'status', 'templateId'] as const;
    for (const field of trackFields) {
      if (dto[field] !== undefined) {
        const before = field === 'startDate' || field === 'endDate' ? cycle[field]?.toISOString?.()?.split('T')[0] || cycle[field] : cycle[field];
        const after = dto[field];
        if (String(before) !== String(after)) {
          changes[field] = { before, after };
        }
      }
    }

    Object.assign(cycle, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.period !== undefined && { period: dto.period }),
      ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
      ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.templateId !== undefined && { templateId: dto.templateId }),
      ...(dto.settings !== undefined && { settings: dto.settings }),
    });
    const saved = await this.cycleRepo.save(cycle);

    // Audit log with change details
    if (Object.keys(changes).length > 0 && userId) {
      this.auditService.log(tenantId, userId, 'cycle.updated', 'cycle', id, { changes, cycleName: saved.name }).catch(() => {});
    }

    return saved;
  }

  async getCycleHistory(id: string, tenantId: string): Promise<any[]> {
    const logs = await this.auditLogRepo.find({
      where: { tenantId, entityType: 'cycle', entityId: id },
      order: { createdAt: 'DESC' },
    });
    // Enrich with user names
    const userIds = [...new Set(logs.map(l => l.userId).filter(Boolean))] as string[];
    const users = userIds.length > 0 ? await this.userRepo.find({ where: { id: In(userIds) }, select: ['id', 'firstName', 'lastName'] }) : [];
    const userMap = new Map(users.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

    return logs.map(l => ({
      id: l.id,
      action: l.action,
      userName: l.userId ? userMap.get(l.userId) || 'Sistema' : 'Sistema',
      metadata: l.metadata,
      createdAt: l.createdAt,
    }));
  }

  async deleteCycle(id: string, tenantId: string): Promise<void> {
    const cycle = await this.findCycleById(id, tenantId);
    if (cycle.status === CycleStatus.ACTIVE || cycle.status === CycleStatus.PAUSED) {
      throw new BadRequestException('No se puede eliminar un ciclo activo o pausado. Ciérralo primero.');
    }
    if (cycle.status === CycleStatus.CLOSED) {
      throw new BadRequestException('No se puede eliminar un ciclo cerrado. Los datos de evaluación deben preservarse.');
    }
    // Soft delete: mark as cancelled instead of removing
    cycle.status = CycleStatus.CANCELLED;
    await this.cycleRepo.save(cycle);
  }

  // ─── Allowed relation types per cycle type ──────────────────────────────

  private readonly ALLOWED_RELATIONS: Record<string, RelationType[]> = {
    [CycleType.DEGREE_90]: [RelationType.MANAGER],
    [CycleType.DEGREE_180]: [RelationType.MANAGER, RelationType.SELF],
    [CycleType.DEGREE_270]: [RelationType.MANAGER, RelationType.SELF, RelationType.PEER],
    [CycleType.DEGREE_360]: [RelationType.MANAGER, RelationType.SELF, RelationType.PEER, RelationType.DIRECT_REPORT],
  };

  private getAllowedRelations(cycleType: CycleType): RelationType[] {
    return this.ALLOWED_RELATIONS[cycleType] || [];
  }

  private async validatePeerAssignment(
    tenantId: string,
    cycle: EvaluationCycle,
    evaluateeId: string,
    evaluatorId: string,
    relationType: RelationType,
  ): Promise<void> {
    // 1. Validate relationType is allowed for this cycle type
    const allowed = this.getAllowedRelations(cycle.type as CycleType);
    if (!allowed.includes(relationType)) {
      const typeLabel = { '90': '90°', '180': '180°', '270': '270°', '360': '360°' }[cycle.type] || cycle.type;
      throw new BadRequestException(
        `La relaci\u00f3n "${relationType}" no est\u00e1 permitida en evaluaciones ${typeLabel}. Permitidas: ${allowed.join(', ')}`,
      );
    }

    // 2. Self-evaluation: evaluatee === evaluator
    if (relationType === RelationType.SELF) {
      if (evaluateeId !== evaluatorId) {
        throw new BadRequestException('En autoevaluaci\u00f3n, el evaluado y evaluador deben ser la misma persona');
      }
      return;
    }

    // 3. Cannot be same person (non-self)
    if (evaluateeId === evaluatorId) {
      throw new BadRequestException('El evaluado y el evaluador no pueden ser la misma persona');
    }

    // 4. Manager relation: validate evaluator is the actual manager of evaluatee
    if (relationType === RelationType.MANAGER) {
      const evaluatee = await this.userRepo.findOne({
        where: { id: evaluateeId, tenantId },
        select: ['id', 'managerId'],
      });
      if (!evaluatee) {
        throw new NotFoundException('Evaluado no encontrado');
      }
      if (evaluatee.managerId !== evaluatorId) {
        throw new BadRequestException(
          'El evaluador asignado como "jefe" no es el jefe directo del evaluado',
        );
      }
    }

    // 5. Direct report: validate evaluator reports to evaluatee
    if (relationType === RelationType.DIRECT_REPORT) {
      const evaluator = await this.userRepo.findOne({
        where: { id: evaluatorId, tenantId },
        select: ['id', 'managerId'],
      });
      if (!evaluator) {
        throw new NotFoundException('Evaluador no encontrado');
      }
      if (evaluator.managerId !== evaluateeId) {
        throw new BadRequestException(
          'El evaluador asignado como "reporte directo" no reporta al evaluado',
        );
      }
    }
  }

  // ─── Peer Assignments (pre-launch) ──────────────────────────────────────

  async addPeerAssignment(tenantId: string, cycleId: string, dto: AddPeerAssignmentDto): Promise<PeerAssignment> {
    const cycle = await this.findCycleById(cycleId, tenantId);
    if (cycle.status !== CycleStatus.DRAFT) {
      throw new BadRequestException('Solo se pueden asignar evaluadores en ciclos en borrador');
    }
    const relationType = dto.relationType ?? RelationType.PEER;
    await this.validatePeerAssignment(tenantId, cycle, dto.evaluateeId, dto.evaluatorId, relationType);

    const pa = this.peerAssignmentRepo.create({
      tenantId,
      cycleId,
      evaluateeId: dto.evaluateeId,
      evaluatorId: relationType === RelationType.SELF ? dto.evaluateeId : dto.evaluatorId,
      relationType,
    });
    return this.peerAssignmentRepo.save(pa);
  }

  async bulkAddPeerAssignments(tenantId: string, cycleId: string, dto: BulkPeerAssignmentDto): Promise<PeerAssignment[]> {
    const cycle = await this.findCycleById(cycleId, tenantId);
    if (cycle.status !== CycleStatus.DRAFT) {
      throw new BadRequestException('Solo se pueden asignar evaluadores en ciclos en borrador');
    }

    // Validate all assignments before saving
    for (const a of dto.assignments) {
      const relationType = a.relationType ?? RelationType.PEER;
      await this.validatePeerAssignment(tenantId, cycle, a.evaluateeId, a.evaluatorId, relationType);
    }

    const entities = dto.assignments.map((a) =>
      this.peerAssignmentRepo.create({
        tenantId,
        cycleId,
        evaluateeId: a.evaluateeId,
        evaluatorId: a.relationType === RelationType.SELF ? a.evaluateeId : a.evaluatorId,
        relationType: a.relationType ?? RelationType.PEER,
      }),
    );
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const saved = await queryRunner.manager.save(PeerAssignment, entities);
      await queryRunner.commitTransaction();
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ─── Auto-generate assignments based on cycle type + org structure ─────

  async autoGenerateAssignments(
    tenantId: string,
    cycleId: string,
  ): Promise<{
    created: number;
    skipped: number;
    exceptions: Array<{
      evaluateeId: string;
      evaluateeName: string;
      department: string | null;
      type: string;
      message: string;
      relationType: string;
      available?: number;
      required?: number;
    }>;
  }> {
    const cycle = await this.findCycleById(cycleId, tenantId);
    if (cycle.status !== CycleStatus.DRAFT) {
      throw new BadRequestException('Solo se pueden generar asignaciones en ciclos en borrador');
    }

    const cycleType = cycle.type as CycleType;
    const allowedRelations = this.getAllowedRelations(cycleType);
    const users = await this.userRepo.find({
      where: { tenantId, isActive: true },
      select: ['id', 'managerId', 'role', 'department', 'departmentId', 'firstName', 'lastName', 'hierarchyLevel'],
    });

    // Exclude super_admin and external from evaluatees
    const evaluatees = users.filter((u) => u.role !== 'super_admin' && u.role !== 'external');

    // Get existing peer assignments to avoid duplicates
    const existing = await this.peerAssignmentRepo.find({
      where: { tenantId, cycleId },
      select: ['evaluateeId', 'evaluatorId', 'relationType'],
    });
    const existingSet = new Set(
      existing.map((e) => `${e.evaluateeId}|${e.evaluatorId}|${e.relationType}`),
    );

    const toCreate: Partial<PeerAssignment>[] = [];
    const exceptions: Array<{
      evaluateeId: string;
      evaluateeName: string;
      department: string | null;
      type: string;
      message: string;
      relationType: string;
      available?: number;
      required?: number;
    }> = [];

    const evalName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;

    for (const evaluatee of evaluatees) {
      // ── Self-evaluation ──
      if (allowedRelations.includes(RelationType.SELF)) {
        const key = `${evaluatee.id}|${evaluatee.id}|${RelationType.SELF}`;
        if (!existingSet.has(key)) {
          toCreate.push({
            tenantId,
            cycleId,
            evaluateeId: evaluatee.id,
            evaluatorId: evaluatee.id,
            relationType: RelationType.SELF,
          });
        }
      }

      // ── Manager evaluation ──
      if (allowedRelations.includes(RelationType.MANAGER)) {
        if (!evaluatee.managerId) {
          exceptions.push({
            evaluateeId: evaluatee.id,
            evaluateeName: evalName(evaluatee),
            department: evaluatee.department,
            type: 'NO_MANAGER',
            message: 'No tiene jefe directo asignado',
            relationType: 'manager',
          });
        } else {
          const manager = users.find((u) => u.id === evaluatee.managerId);
          if (!evaluatee.department) {
            exceptions.push({
              evaluateeId: evaluatee.id,
              evaluateeName: evalName(evaluatee),
              department: null,
              type: 'NO_DEPARTMENT',
              message: 'No tiene departamento asignado',
              relationType: 'manager',
            });
          } else if (!manager?.department || evaluatee.department !== manager.department) {
            exceptions.push({
              evaluateeId: evaluatee.id,
              evaluateeName: evalName(evaluatee),
              department: evaluatee.department,
              type: 'MANAGER_DIFF_DEPT',
              message: `Jefe ${manager ? evalName(manager) : '(no encontrado)'} está en departamento distinto (${manager?.department || 'sin depto'})`,
              relationType: 'manager',
            });
          } else {
            const key = `${evaluatee.id}|${evaluatee.managerId}|${RelationType.MANAGER}`;
            if (!existingSet.has(key)) {
              toCreate.push({
                tenantId,
                cycleId,
                evaluateeId: evaluatee.id,
                evaluatorId: evaluatee.managerId,
                relationType: RelationType.MANAGER,
              });
            }
          }
        }
      }

      // ── Direct reports (360° only) — same department ──
      if (allowedRelations.includes(RelationType.DIRECT_REPORT)) {
        const directReports = users.filter((u) =>
          u.managerId === evaluatee.id &&
          u.role !== 'super_admin' && u.role !== 'external' &&
          !!((evaluatee as any).departmentId && (u as any).departmentId ? (evaluatee as any).departmentId === (u as any).departmentId : evaluatee.department && u.department && evaluatee.department === u.department),
        );
        if (directReports.length === 0) {
          exceptions.push({
            evaluateeId: evaluatee.id,
            evaluateeName: evalName(evaluatee),
            department: evaluatee.department,
            type: 'NO_DIRECT_REPORTS',
            message: 'No tiene reportes directos en su departamento',
            relationType: 'direct_report',
          });
        } else {
          for (const dr of directReports) {
            const key = `${evaluatee.id}|${dr.id}|${RelationType.DIRECT_REPORT}`;
            if (!existingSet.has(key)) {
              toCreate.push({
                tenantId,
                cycleId,
                evaluateeId: evaluatee.id,
                evaluatorId: dr.id,
                relationType: RelationType.DIRECT_REPORT,
              });
            }
          }
        }
      }

      // ── Peer auto-assignment (270° only — same department, min 3) ──
      if (cycleType === CycleType.DEGREE_270 && allowedRelations.includes(RelationType.PEER)) {
        if (!evaluatee.department && !(evaluatee as any).departmentId) {
          exceptions.push({
            evaluateeId: evaluatee.id,
            evaluateeName: evalName(evaluatee),
            department: null,
            type: 'NO_DEPARTMENT',
            message: 'No tiene departamento asignado — no se pueden asignar pares',
            relationType: 'peer',
          });
        } else {
          // Candidates: same department (prefer ID, fallback text), not self, not their manager
          const sameDeptCheck = (a: any, b: any) =>
            a.departmentId && b.departmentId ? a.departmentId === b.departmentId
            : !!(a.department && b.department && a.department === b.department);
          const peerCandidates = evaluatees.filter((u) =>
            u.id !== evaluatee.id &&
            u.id !== evaluatee.managerId &&
            sameDeptCheck(evaluatee, u) &&
            !existingSet.has(`${evaluatee.id}|${u.id}|${RelationType.PEER}`),
          );

          if (peerCandidates.length < 3) {
            exceptions.push({
              evaluateeId: evaluatee.id,
              evaluateeName: evalName(evaluatee),
              department: evaluatee.department,
              type: 'INSUFFICIENT_PEERS',
              message: `Solo ${peerCandidates.length} par(es) disponible(s) en el departamento (mínimo 3)`,
              relationType: 'peer',
              available: peerCandidates.length,
              required: 3,
            });
          } else {
            // Sort by hierarchy level proximity, then by name
            const sorted = [...peerCandidates].sort((a, b) => {
              if (evaluatee.hierarchyLevel != null) {
                const distA = a.hierarchyLevel != null ? Math.abs(a.hierarchyLevel - evaluatee.hierarchyLevel) : 100;
                const distB = b.hierarchyLevel != null ? Math.abs(b.hierarchyLevel - evaluatee.hierarchyLevel) : 100;
                if (distA !== distB) return distA - distB;
              }
              return evalName(a).localeCompare(evalName(b));
            });

            // Assign top 3 closest peers
            for (const peer of sorted.slice(0, 3)) {
              toCreate.push({
                tenantId,
                cycleId,
                evaluateeId: evaluatee.id,
                evaluatorId: peer.id,
                relationType: RelationType.PEER,
              });
            }
          }
        }
      }
      // Note: For 360°, PEER assignments are NOT auto-generated (admin must select peers manually)
    }

    if (toCreate.length > 0) {
      const entities = toCreate.map((pa) => this.peerAssignmentRepo.create(pa));
      await this.peerAssignmentRepo.save(entities);
    }

    return { created: toCreate.length, skipped: exceptions.length, exceptions };
  }

  async getAllowedRelationsForCycle(tenantId: string, cycleId: string) {
    const cycle = await this.findCycleById(cycleId, tenantId);
    const allowed = this.getAllowedRelations(cycle.type as CycleType);
    const labels: Record<string, string> = {
      [RelationType.SELF]: 'Autoevaluaci\u00f3n',
      [RelationType.MANAGER]: 'Jefe directo',
      [RelationType.PEER]: 'Par / Colega',
      [RelationType.DIRECT_REPORT]: 'Reporte directo',
    };
    return allowed.map((r) => ({ value: r, label: labels[r] || r }));
  }

  async suggestPeers(tenantId: string, cycleId: string, evaluateeId: string): Promise<any[]> {
    const evaluatee = await this.userRepo.findOne({ where: { id: evaluateeId, tenantId } });
    if (!evaluatee) return [];

    // Determine cycle type to decide department filtering
    const cycle = await this.findCycleById(cycleId, tenantId);
    const is270 = cycle.type === CycleType.DEGREE_270;

    // Get already assigned peers for this evaluatee in this cycle
    const existing = await this.peerAssignmentRepo.find({
      where: { tenantId, cycleId, evaluateeId },
      select: ['evaluatorId'],
    });
    const assignedIds = new Set(existing.map(e => e.evaluatorId));
    assignedIds.add(evaluateeId); // exclude self

    // Find peer candidates: same hierarchy level, active, not super_admin/external
    const qb = this.userRepo.createQueryBuilder('u')
      .where('u.tenantId = :tenantId', { tenantId })
      .andWhere('u.isActive = true')
      .andWhere('u.id != :evaluateeId', { evaluateeId })
      .andWhere("u.role NOT IN ('super_admin', 'external')")
      .select(['u.id', 'u.firstName', 'u.lastName', 'u.position', 'u.hierarchyLevel', 'u.department', 'u.departmentId', 'u.managerId']);

    // 270°: filter by same department only (prefer ID, fallback to text)
    if (is270) {
      if ((evaluatee as any).departmentId) {
        qb.andWhere('u.department_id = :deptId', { deptId: (evaluatee as any).departmentId });
      } else if (evaluatee.department) {
        qb.andWhere('u.department = :dept', { dept: evaluatee.department });
      }
    }

    // If evaluatee has a hierarchy level, prioritize same level
    if (evaluatee.hierarchyLevel) {
      qb.addSelect(
        `CASE WHEN u.hierarchy_level = :level THEN 0 WHEN u.hierarchy_level IS NOT NULL THEN ABS(u.hierarchy_level - :level) ELSE 100 END`,
        'levelDistance',
      ).setParameter('level', evaluatee.hierarchyLevel)
        .orderBy('levelDistance', 'ASC');
    }
    qb.addOrderBy('u.department', 'ASC').addOrderBy('u.firstName', 'ASC');

    const candidates = await qb.getMany();

    return candidates
      .filter(c => !assignedIds.has(c.id))
      .slice(0, 30)
      .map(c => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        position: c.position,
        level: c.hierarchyLevel,
        department: c.department,
        sameLevel: evaluatee.hierarchyLevel != null && c.hierarchyLevel === evaluatee.hierarchyLevel,
        sameDepartment: (evaluatee as any).departmentId && (c as any).departmentId ? (evaluatee as any).departmentId === (c as any).departmentId : evaluatee.department && c.department === evaluatee.department,
      }));
  }

  async getPeerAssignments(tenantId: string, cycleId: string): Promise<PeerAssignment[]> {
    return this.peerAssignmentRepo.find({
      where: { tenantId, cycleId },
      relations: ['evaluatee', 'evaluator'],
      order: { createdAt: 'ASC' },
    });
  }

  async removePeerAssignment(tenantId: string, cycleId: string, id: string): Promise<void> {
    const pa = await this.peerAssignmentRepo.findOne({ where: { id, tenantId, cycleId } });
    if (!pa) throw new NotFoundException('Asignación de par no encontrada');
    const cycle = await this.findCycleById(cycleId, tenantId);
    if (cycle.status !== CycleStatus.DRAFT) {
      throw new BadRequestException('Solo se pueden modificar pares en ciclos en borrador');
    }
    await this.peerAssignmentRepo.remove(pa);
  }

  // ─── Cycle Launch ─────────────────────────────────────────────────────────

  async launchCycle(id: string, tenantId: string, userId: string) {
    const cycle = await this.findCycleById(id, tenantId);

    if (cycle.status !== CycleStatus.DRAFT) {
      throw new BadRequestException('Solo se puede lanzar un ciclo en estado borrador');
    }

    // B1.2: No duplicate active cycles of same type per tenant
    const existingActive = await this.cycleRepo.findOne({
      where: { tenantId, type: cycle.type, status: CycleStatus.ACTIVE },
    });
    if (existingActive) {
      throw new BadRequestException(
        `Ya existe un ciclo activo del tipo ${cycle.type} ("${existingActive.name}"). Cierre el ciclo activo antes de lanzar uno nuevo.`,
      );
    }

    if (!cycle.templateId) {
      throw new BadRequestException('El ciclo debe tener una plantilla asignada');
    }

    // Verify template exists
    const template = await this.templateRepo.findOne({ where: { id: cycle.templateId } });
    if (!template) {
      throw new BadRequestException('La plantilla asignada no existe');
    }

    // Read all manual pre-assignments configured by the admin
    const preAssignments = await this.peerAssignmentRepo.find({
      where: { cycleId: id, tenantId },
    });

    if (preAssignments.length === 0) {
      throw new BadRequestException('Debe configurar al menos una asignación antes de lanzar el ciclo');
    }

    // B1.3: For 270°/360° cycles, ensure at least 3 peer evaluators per evaluatee (anonymity)
    if (cycle.type === CycleType.DEGREE_270 || cycle.type === CycleType.DEGREE_360) {
      const evaluateeIds = [...new Set(preAssignments.map((pa) => pa.evaluateeId))];
      for (const evaluateeId of evaluateeIds) {
        const peerCount = preAssignments.filter(
          (pa) => pa.evaluateeId === evaluateeId && pa.relationType === RelationType.PEER,
        ).length;
        if (peerCount < 3) {
          const user = await this.userRepo.findOne({ where: { id: evaluateeId }, select: ['id', 'firstName', 'lastName'] });
          const name = user ? `${user.firstName} ${user.lastName}` : evaluateeId;
          throw new BadRequestException(
            `El evaluado "${name}" tiene solo ${peerCount} evaluador(es) par(es). Se requieren mínimo 3 para garantizar el anonimato en evaluaciones ${cycle.type}.`,
          );
        }
      }
    }

    // Use a transaction for atomicity
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const dueDate = cycle.endDate;

      // Convert all pre-assignments to evaluation assignments
      const assignments: Partial<EvaluationAssignment>[] = preAssignments.map((pa) => ({
        tenantId,
        cycleId: id,
        evaluateeId: pa.evaluateeId,
        evaluatorId: pa.evaluatorId,
        relationType: pa.relationType,
        status: AssignmentStatus.PENDING,
        dueDate,
      }));

      // Bulk insert assignments
      await queryRunner.manager.save(EvaluationAssignment, assignments);

      // Update cycle status
      cycle.status = CycleStatus.ACTIVE;
      // Count unique evaluatees
      const uniqueEvaluatees = new Set(preAssignments.map((pa) => pa.evaluateeId));
      cycle.totalEvaluated = uniqueEvaluatees.size;
      await queryRunner.manager.save(EvaluationCycle, cycle);

      await queryRunner.commitTransaction();

      await this.auditService.log(tenantId, userId, 'cycle.launched', 'cycle', id, {
        assignmentsCreated: assignments.length,
        totalEvaluated: cycle.totalEvaluated,
      });

      // Notify all unique evaluators — both via email AND in-app notification.
      // Previously this only sent email (fire-and-forget, sin logger), so si
      // el user ignoraba/perdía el mail no veía nada hasta que el cron
      // `remindPendingEvaluations` (cada 6 h) lo recordara — y ese cron solo
      // se dispara cuando el assignment pasa a IN_PROGRESS. Resultado: un
      // user podía lanzarse un ciclo y el evaluador no se enteraba por la
      // campanita hasta que él mismo lo abriera.
      const uniqueEvaluatorIds = [...new Set(assignments.map(a => a.evaluatorId))];
      const evaluators = await this.userRepo.find({
        where: uniqueEvaluatorIds.map(eid => ({ id: eid })),
        select: ['id', 'email', 'firstName'],
      });
      const dueDateStr = new Date(cycle.endDate).toLocaleDateString('es-CL');

      // Count pending assignments per evaluator so the in-app message is
      // specific ("2 evaluaciones asignadas" en lugar de solo "Nuevo ciclo").
      const pendingCountByEvaluator = new Map<string, number>();
      for (const a of assignments) {
        if (!a.evaluatorId) continue;
        pendingCountByEvaluator.set(a.evaluatorId, (pendingCountByEvaluator.get(a.evaluatorId) || 0) + 1);
      }

      for (const ev of evaluators) {
        const pendingCount = pendingCountByEvaluator.get(ev.id) || 0;
        if (pendingCount === 0) continue;

        // 1) Email — ahora con logger si falla (antes era silent).
        if (ev.email) {
          this.emailService.sendCycleLaunched(ev.email, {
            firstName: ev.firstName, cycleName: cycle.name,
            cycleType: cycle.type, dueDate: dueDateStr, cycleId: cycle.id, tenantId,
          }).catch((err) => {
            this.logger.error(
              `Failed to send cycle-launched email to ${ev.email} for cycle ${cycle.id}: ${err?.message || err}`,
            );
          });
        }

        // 2) Notificación in-app (campanita). Usa el mismo NotificationType
        //    que el cron de recordatorios, pero con metadata.action
        //    'cycle_launched' para diferenciar en futuros reportes.
        this.notificationsService.create({
          tenantId,
          userId: ev.id,
          type: NotificationType.EVALUATION_PENDING,
          title: `Nuevo ciclo de evaluación: ${cycle.name}`,
          message: `Tienes ${pendingCount} evaluación${pendingCount > 1 ? 'es' : ''} asignada${pendingCount > 1 ? 's' : ''} en el ciclo "${cycle.name}". Complétala${pendingCount > 1 ? 's' : ''} antes del ${dueDateStr}.`,
          metadata: { cycleId: cycle.id, action: 'cycle_launched', pendingCount },
        }).catch((err) => {
          this.logger.error(
            `Failed to create in-app notification for evaluator ${ev.id} on cycle ${cycle.id}: ${err?.message || err}`,
          );
        });
      }

      return {
        cycle,
        assignmentsCreated: assignments.length,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async closeCycle(id: string, tenantId: string, userId: string): Promise<EvaluationCycle> {
    const cycle = await this.findCycleById(id, tenantId);
    if (cycle.status !== CycleStatus.ACTIVE && cycle.status !== CycleStatus.PAUSED) {
      throw new BadRequestException('Solo se puede cerrar un ciclo activo o pausado');
    }
    cycle.status = CycleStatus.CLOSED;
    const saved = await this.cycleRepo.save(cycle);

    // Mark all non-completed stages as completed to keep consistency
    await this.stageRepo
      .createQueryBuilder()
      .update(CycleStage)
      .set({ status: StageStatus.COMPLETED })
      .where('cycleId = :cycleId', { cycleId: id })
      .andWhere('tenantId = :tenantId', { tenantId })
      .andWhere('status != :completed', { completed: StageStatus.COMPLETED })
      .execute();

    await this.auditService.log(tenantId, userId, 'cycle.closed', 'cycle', id);

    // Send email to all evaluatees notifying them that results are available
    const completedAssignments = await this.assignmentRepo.find({
      where: { cycleId: id, tenantId },
      select: ['evaluateeId'],
    });
    const uniqueEvaluateeIds = [...new Set(completedAssignments.map(a => a.evaluateeId))];
    if (uniqueEvaluateeIds.length > 0) {
      const evaluatees = await this.userRepo.find({
        where: uniqueEvaluateeIds.map(eid => ({ id: eid })),
        select: ['id', 'email', 'firstName'],
      });
      for (const ev of evaluatees) {
        if (!ev.email) continue;
        this.emailService.sendCycleClosed(ev.email, {
          firstName: ev.firstName, cycleName: cycle.name, cycleId: id, tenantId,
        }).catch(() => {});
        // In-app notification: signature pending for results
        this.notificationsService.create({
          tenantId,
          userId: ev.id,
          type: NotificationType.GENERAL,
          title: 'Firma pendiente — Resultados de evaluación',
          message: `Los resultados del ciclo "${cycle.name}" están disponibles. Por favor revisa y firma tus resultados en Mi Desempeño.`,
          metadata: { cycleId: id, action: 'signature_pending', documentType: 'evaluation_response' },
        }).catch(() => {});
      }
    }

    return saved;
  }

  async pauseCycle(id: string, tenantId: string, userId: string): Promise<EvaluationCycle> {
    const cycle = await this.findCycleById(id, tenantId);
    if (cycle.status !== CycleStatus.ACTIVE) {
      throw new BadRequestException('Solo se puede pausar un ciclo activo');
    }
    cycle.status = CycleStatus.PAUSED;
    cycle.settings = {
      ...cycle.settings,
      pausedAt: new Date().toISOString(),
      pausedBy: userId,
    };
    const saved = await this.cycleRepo.save(cycle);
    await this.auditService.log(tenantId, userId, 'cycle.paused', 'cycle', id);
    return saved;
  }

  async resumeCycle(id: string, tenantId: string, userId: string): Promise<EvaluationCycle> {
    const cycle = await this.findCycleById(id, tenantId);
    if (cycle.status !== CycleStatus.PAUSED) {
      throw new BadRequestException('Solo se puede reanudar un ciclo pausado');
    }
    cycle.status = CycleStatus.ACTIVE;
    const { pausedAt, pausedBy, ...restSettings } = cycle.settings || {};
    cycle.settings = {
      ...restSettings,
      resumedAt: new Date().toISOString(),
      resumedBy: userId,
    };
    const saved = await this.cycleRepo.save(cycle);
    await this.auditService.log(tenantId, userId, 'cycle.resumed', 'cycle', id);
    return saved;
  }

  // ─── Assignments ──────────────────────────────────────────────────────────

  async findAssignmentsByCycle(cycleId: string, tenantId: string): Promise<EvaluationAssignment[]> {
    await this.findCycleById(cycleId, tenantId);
    return this.assignmentRepo.find({
      where: { cycleId, tenantId },
      relations: ['evaluatee', 'evaluator'],
      order: { createdAt: 'ASC' },
    });
  }

  async findPendingForUser(userId: string, tenantId: string): Promise<EvaluationAssignment[]> {
    return this.assignmentRepo.find({
      where: [
        { evaluatorId: userId, tenantId, status: AssignmentStatus.PENDING },
        { evaluatorId: userId, tenantId, status: AssignmentStatus.IN_PROGRESS },
      ],
      relations: ['evaluatee', 'cycle'],
      order: { createdAt: 'ASC' },
    });
  }

  async findCompletedForUser(userId: string, tenantId: string): Promise<any[]> {
    const assignments = await this.assignmentRepo.find({
      where: { evaluatorId: userId, tenantId, status: AssignmentStatus.COMPLETED },
      relations: ['evaluatee', 'evaluator', 'cycle'],
      order: { completedAt: 'DESC' },
    });

    // Load responses for each assignment to get overallScore
    const results = [];
    for (const a of assignments) {
      const response = await this.responseRepo.findOne({
        where: { assignmentId: a.id },
        select: ['id', 'overallScore', 'submittedAt'],
      });
      results.push({ ...a, response: response || null });
    }
    return results;
  }

  /** Get evaluations where the user is the EVALUATEE (someone evaluated me) */
  async findEvaluationsOfUser(userId: string, tenantId: string): Promise<any[]> {
    const assignments = await this.assignmentRepo.find({
      where: { evaluateeId: userId, tenantId, status: AssignmentStatus.COMPLETED },
      relations: ['evaluatee', 'evaluator', 'cycle'],
      order: { completedAt: 'DESC' },
    });
    const results = [];
    for (const a of assignments) {
      const response = await this.responseRepo.findOne({
        where: { assignmentId: a.id },
        select: ['id', 'overallScore', 'submittedAt'],
      });
      results.push({ ...a, response: response || null });
    }
    return results;
  }

  async getAssignmentDetail(assignmentId: string, tenantId: string) {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId, tenantId },
      relations: ['evaluatee', 'evaluator', 'cycle'],
    });
    if (!assignment) throw new NotFoundException('Asignación no encontrada');

    // Fetch template for the cycle
    let template = null;
    if (assignment.cycle.templateId) {
      template = await this.templateRepo.findOne({
        where: { id: assignment.cycle.templateId },
      });
    }

    // Fetch existing response if any
    const response = await this.responseRepo.findOne({
      where: { assignmentId },
    });

    // Pre-load evaluatee's objectives for the cycle period (OKR context)
    let evaluateeObjectives: Objective[] = [];
    let evaluateeObjectivesSummary: any = null;
    try {
      // First try objectives linked to this specific cycle
      evaluateeObjectives = await this.objectiveRepo.find({
        where: { userId: assignment.evaluateeId, tenantId, cycleId: assignment.cycleId },
        order: { createdAt: 'DESC' },
        take: 20,
      });

      // If none linked to cycle, fallback to objectives created during the cycle period
      if (evaluateeObjectives.length === 0 && assignment.cycle) {
        const qb = this.objectiveRepo.createQueryBuilder('o')
          .where('o.userId = :userId', { userId: assignment.evaluateeId })
          .andWhere('o.tenantId = :tenantId', { tenantId })
          .andWhere('o.created_at >= :start', { start: assignment.cycle.startDate })
          .andWhere('o.created_at <= :end', { end: assignment.cycle.endDate })
          .orderBy('o.created_at', 'DESC')
          .limit(20);
        evaluateeObjectives = await qb.getMany();
      }

      // B3.1: For self-evaluations, enrich objectives with Key Results and summary
      if (evaluateeObjectives.length > 0) {
        const objectiveIds = evaluateeObjectives.map((o) => o.id);
        const keyResults = await this.keyResultRepo
          .createQueryBuilder('kr')
          .where('kr.objectiveId IN (:...ids)', { ids: objectiveIds })
          .andWhere('kr.tenantId = :tenantId', { tenantId })
          .getMany();

        // Group KRs by objective
        const krByObjective = new Map<string, KeyResult[]>();
        for (const kr of keyResults) {
          const list = krByObjective.get(kr.objectiveId) || [];
          list.push(kr);
          krByObjective.set(kr.objectiveId, list);
        }

        // Attach KRs to each objective as a virtual property
        for (const obj of evaluateeObjectives) {
          (obj as any).keyResults = krByObjective.get(obj.id) || [];
        }

        // Calculate summary for the self-evaluation form context
        const activeOrCompleted = evaluateeObjectives.filter(
          (o) => o.status === ObjectiveStatus.ACTIVE || o.status === ObjectiveStatus.COMPLETED,
        );
        const totalProgress = activeOrCompleted.reduce((sum, o) => sum + (o.progress || 0), 0);
        const avgProgress = activeOrCompleted.length > 0
          ? Math.round(totalProgress / activeOrCompleted.length)
          : 0;
        const completedCount = evaluateeObjectives.filter((o) => o.status === ObjectiveStatus.COMPLETED).length;
        const atRiskCount = activeOrCompleted.filter((o) => (o.progress || 0) < 40).length;

        evaluateeObjectivesSummary = {
          totalObjectives: evaluateeObjectives.length,
          activeOrCompleted: activeOrCompleted.length,
          completedCount,
          atRiskCount,
          avgProgress,
          totalKeyResults: keyResults.length,
        };
      }
    } catch {
      // Objectives module may not exist — graceful fallback
    }

    return { assignment, template, response, evaluateeObjectives, evaluateeObjectivesSummary };
  }

  // ─── Responses ────────────────────────────────────────────────────────────

  async saveResponse(
    assignmentId: string,
    tenantId: string,
    userId: string,
    dto: SaveResponseDto,
  ): Promise<EvaluationResponse> {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId, tenantId },
    });
    if (!assignment) throw new NotFoundException('Asignación no encontrada');
    if (assignment.evaluatorId !== userId) {
      throw new ForbiddenException('No tienes permiso para responder esta evaluación');
    }
    if (assignment.status === AssignmentStatus.COMPLETED) {
      throw new BadRequestException('Esta evaluación ya fue enviada');
    }

    // Update assignment status to in_progress
    if (assignment.status === AssignmentStatus.PENDING) {
      assignment.status = AssignmentStatus.IN_PROGRESS;
      await this.assignmentRepo.save(assignment);
    }

    // Upsert response
    let response = await this.responseRepo.findOne({ where: { assignmentId } });
    if (response) {
      response.answers = dto.answers;
      return this.responseRepo.save(response);
    }

    response = this.responseRepo.create({
      tenantId,
      assignmentId,
      answers: dto.answers,
    });
    return this.responseRepo.save(response);
  }

  async submitResponse(
    assignmentId: string,
    tenantId: string,
    userId: string,
    dto: SubmitResponseDto,
  ) {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId, tenantId },
      relations: ['cycle'],
    });
    if (!assignment) throw new NotFoundException('Asignación no encontrada');
    if (assignment.evaluatorId !== userId) {
      throw new ForbiddenException('No tienes permiso para responder esta evaluación');
    }
    if (assignment.status === AssignmentStatus.COMPLETED) {
      throw new BadRequestException('Esta evaluación ya fue enviada');
    }

    // B1.4: Manager/peer/direct_report evaluations require self-evaluation to be completed first
    if (assignment.relationType !== RelationType.SELF) {
      const selfAssignment = await this.assignmentRepo.findOne({
        where: {
          cycleId: assignment.cycleId,
          tenantId,
          evaluateeId: assignment.evaluateeId,
          relationType: RelationType.SELF,
        },
      });
      if (selfAssignment && selfAssignment.status !== AssignmentStatus.COMPLETED) {
        throw new BadRequestException(
          'La autoevaluación del colaborador debe completarse antes de que otros evaluadores puedan enviar su evaluación.',
        );
      }
    }

    // B2.1: Validate all required template items are answered before submitting
    if (assignment.cycle.templateId) {
      await this.validateRequiredAnswers(assignment.cycle.templateId, dto.answers);
    }

    // Calculate overall score from scale answers
    const overallScore = this.calculateScore(dto.answers, assignment.cycle.templateId);

    // Save response
    let response = await this.responseRepo.findOne({ where: { assignmentId } });
    if (response) {
      response.answers = dto.answers;
      response.overallScore = overallScore;
      response.submittedAt = new Date();
    } else {
      response = this.responseRepo.create({
        tenantId,
        assignmentId,
        answers: dto.answers,
        overallScore,
        submittedAt: new Date(),
      });
    }
    await this.responseRepo.save(response);

    // Mark assignment as completed
    assignment.status = AssignmentStatus.COMPLETED;
    assignment.completedAt = new Date();
    await this.assignmentRepo.save(assignment);

    await this.auditService.log(
      tenantId, userId, 'evaluation.submitted', 'assignment', assignmentId,
    );

    return { assignment, response };
  }

  private async validateRequiredAnswers(templateId: string, answers: any): Promise<void> {
    const template = await this.templateRepo.findOne({ where: { id: templateId } });
    if (!template || !template.sections) return;

    const missingQuestions: string[] = [];
    for (const section of template.sections) {
      if (!section.questions) continue;
      for (const question of section.questions) {
        if (!question.required) continue;
        const answer = answers?.[question.id];
        const isEmpty =
          answer === undefined ||
          answer === null ||
          answer === '' ||
          (Array.isArray(answer) && answer.length === 0);
        if (isEmpty) {
          missingQuestions.push(question.text || question.id);
        }
      }
    }

    if (missingQuestions.length > 0) {
      throw new BadRequestException(
        `Faltan respuestas obligatorias (${missingQuestions.length}): ${missingQuestions.slice(0, 5).join(', ')}${missingQuestions.length > 5 ? '...' : ''}`,
      );
    }
  }

  private calculateScore(answers: any, templateId: string | null): number | null {
    if (!answers || typeof answers !== 'object') return null;

    // Extract numeric answers (handle both number and string-number types)
    const numericValues: number[] = [];
    for (const v of Object.values(answers)) {
      if (typeof v === 'number' && !isNaN(v)) {
        numericValues.push(v);
      } else if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) {
        const n = Number(v);
        if (n >= 1 && n <= 10) numericValues.push(n);
      }
    }

    if (numericValues.length === 0) return null;

    const avg = numericValues.reduce((sum, v) => sum + v, 0) / numericValues.length;
    // Normalize to 0-10 scale (scale questions may be 1-5)
    const normalized = (avg / 5) * 10;
    return Math.round(normalized * 100) / 100;
  }

  // ─── Dashboard Stats ──────────────────────────────────────────────────────

  async getStats(tenantId: string, userId?: string, role?: string) {
    const isManager = role === 'manager';
    const isEmployee = role === 'employee';

    // Manager: only see stats for their direct reports
    // Employee: only see their own stats
    let teamUserIds: string[] | null = null;
    if (isEmployee && userId) {
      teamUserIds = [userId]; // Only own data
    } else if (isManager && userId) {
      const directReports = await this.userRepo.find({
        where: { tenantId, managerId: userId, isActive: true },
        select: ['id'],
      });
      teamUserIds = [userId, ...directReports.map(u => u.id)];
    }

    const [totalCycles, activeCycles] = await Promise.all([
      this.cycleRepo.count({ where: { tenantId } }),
      this.cycleRepo.count({ where: { tenantId, status: CycleStatus.ACTIVE } }),
    ]);

    // Total assignments — scoped to team for managers
    const totalQb = this.assignmentRepo
      .createQueryBuilder('a')
      .where('a.tenantId = :tenantId', { tenantId });
    if (teamUserIds) totalQb.andWhere('a.evaluatee_id IN (:...ids)', { ids: teamUserIds });
    const totalAssignments = await totalQb.getCount();

    // Completed assignments — scoped
    const completedQb = this.assignmentRepo
      .createQueryBuilder('a')
      .where('a.tenantId = :tenantId', { tenantId })
      .andWhere('a.status = :status', { status: AssignmentStatus.COMPLETED });
    if (teamUserIds) completedQb.andWhere('a.evaluatee_id IN (:...ids)', { ids: teamUserIds });
    const completedAssignments = await completedQb.getCount();

    // Average score — scoped (tenant guard also on the JOIN)
    const avgQb = this.responseRepo
      .createQueryBuilder('r')
      .innerJoin('r.assignment', 'a', 'a.tenant_id = r.tenant_id')
      .where('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL');
    if (teamUserIds) avgQb.andWhere('a.evaluatee_id IN (:...ids)', { ids: teamUserIds });
    const avgScoreResult = await avgQb.select('AVG(r.overall_score)', 'avg').getRawOne();

    return {
      totalCycles,
      activeCycles,
      totalAssignments,
      completedAssignments,
      pendingAssignments: totalAssignments - completedAssignments,
      completionRate: totalAssignments > 0
        ? Math.round((completedAssignments / totalAssignments) * 100)
        : 0,
      averageScore: avgScoreResult?.avg
        ? parseFloat(avgScoreResult.avg).toFixed(1)
        : null,
      scope: isEmployee ? 'personal' : isManager ? 'team' : 'organization',
      teamSize: isManager && teamUserIds ? teamUserIds.length - 1 : null,
    };
  }

  // ─── Next Actions ─────────────────────────────────────────────────────────
  /**
   * Returns a prioritized list of actions the current user should take today.
   * Used by the dashboard "Próximas acciones" widget.
   */
  async getNextActions(tenantId: string, userId: string, role: string) {
    const now = new Date();
    const in7Days = new Date(now);
    in7Days.setDate(in7Days.getDate() + 7);

    // 1 — Pending evaluation assignments for this user (as evaluator)
    const pendingAssignments = await this.assignmentRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.evaluatee', 'ee')
      .leftJoinAndSelect('a.cycle', 'c')
      .where('a.tenantId = :tenantId', { tenantId })
      .andWhere('a.evaluatorId = :userId', { userId })
      .andWhere('a.status IN (:...statuses)', { statuses: [AssignmentStatus.PENDING, AssignmentStatus.IN_PROGRESS] })
      .andWhere('c.status = :active', { active: CycleStatus.ACTIVE })
      .orderBy('a.dueDate', 'ASC')
      .take(5)
      .getMany();

    const evalActions = pendingAssignments.map((a) => {
      const dueDate = a.dueDate ? new Date(a.dueDate) : null;
      const daysLeft = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / 86_400_000) : null;
      return {
        type: 'evaluation' as const,
        id: a.id,
        title: `Evaluar a ${a.evaluatee?.firstName ?? ''} ${a.evaluatee?.lastName ?? ''}`.trim() || 'Evaluación pendiente',
        subtitle: a.cycle?.name ?? '',
        dueDate: dueDate?.toISOString().slice(0, 10) ?? null,
        daysLeft,
        urgency: daysLeft !== null && daysLeft <= 1 ? 'high' : daysLeft !== null && daysLeft <= 3 ? 'medium' : 'low',
        href: `/dashboard/evaluaciones/${a.cycleId}/responder/${a.id}`,
      };
    });

    // 2 — At-risk OKRs for this user
    const atRiskObjs = await this.objectiveRepo
      .createQueryBuilder('o')
      .where('o.tenantId = :tenantId', { tenantId })
      .andWhere('o.userId = :userId', { userId })
      .andWhere('o.status IN (:...statuses)', { statuses: ['active'] })
      .orderBy('o.targetDate', 'ASC')
      .take(3)
      .getMany();

    const okrActions = atRiskObjs
      .filter((o) => {
        const progress = Number(o.progress ?? 0);
        const targetDate = o.targetDate ? new Date(o.targetDate) : null;
        const elapsed = targetDate
          ? (now.getTime() - new Date(o.createdAt).getTime()) /
            (targetDate.getTime() - new Date(o.createdAt).getTime())
          : 0;
        const expected = Math.min(elapsed * 100, 100);
        return progress < expected - 15;
      })
      .map((o) => {
        const targetDate = o.targetDate ? new Date(o.targetDate) : null;
        const daysLeft = targetDate ? Math.ceil((targetDate.getTime() - now.getTime()) / 86_400_000) : null;
        return {
          type: 'okr' as const,
          id: o.id,
          title: o.title,
          subtitle: `${o.progress ?? 0}% completado`,
          dueDate: targetDate?.toISOString().slice(0, 10) ?? null,
          daysLeft,
          urgency: daysLeft !== null && daysLeft <= 7 ? 'high' : 'medium',
          href: '/dashboard/objetivos',
        };
      });

    // 3 — Admin-only: pending template / competency reviews
    const reviewActions: any[] = [];
    if (role === 'super_admin' || role === 'tenant_admin') {
      const [pendingTemplates, pendingCompetencies] = await Promise.all([
        this.templateRepo.count({ where: { tenantId, status: 'proposed' } }),
        this.assignmentRepo
          .createQueryBuilder()
          .select('1')
          .where('false') // placeholder — will extend with competency repo
          .getCount(),
      ]);

      if (pendingTemplates > 0) {
        reviewActions.push({
          type: 'review' as const,
          id: 'templates-review',
          title: `${pendingTemplates} plantilla${pendingTemplates > 1 ? 's' : ''} pendiente${pendingTemplates > 1 ? 's' : ''} de revisión`,
          subtitle: 'Requieren aprobación de administrador',
          dueDate: null,
          daysLeft: null,
          urgency: 'medium',
          href: '/dashboard/plantillas',
        });
      }
    }

    // 4 — Upcoming check-ins in next 7 days (manager/employee)
    const checkinActions: any[] = [];
    // We use raw query on the check_ins table since CheckIn entity is in another module
    const upcomingCheckins = await this.dataSource.query(
      `SELECT ci.id, ci.scheduled_at, ci.topic,
              u.first_name as mgr_first, u.last_name as mgr_last
       FROM check_ins ci
       LEFT JOIN users u ON u.id = ci.manager_id
       WHERE ci.tenant_id = $1
         AND (ci.employee_id = $2 OR ci.manager_id = $2)
         AND ci.status = 'scheduled'
         AND ci.scheduled_at BETWEEN $3 AND $4
       ORDER BY ci.scheduled_at ASC
       LIMIT 3`,
      [tenantId, userId, now.toISOString(), in7Days.toISOString()],
    ).catch(() => []);

    for (const ci of upcomingCheckins) {
      const schedDate = new Date(ci.scheduled_at);
      const daysLeft = Math.ceil((schedDate.getTime() - now.getTime()) / 86_400_000);
      checkinActions.push({
        type: 'checkin' as const,
        id: ci.id,
        title: `Check-in 1:1${ci.topic ? `: ${ci.topic}` : ''}`,
        subtitle: `Con ${ci.mgr_first ?? ''} ${ci.mgr_last ?? ''}`.trim() || 'Reunión agendada',
        dueDate: schedDate.toISOString().slice(0, 10),
        daysLeft,
        urgency: daysLeft === 0 ? 'high' : 'low',
        href: '/dashboard/feedback',
      });
    }

    // Merge + sort by urgency then daysLeft
    const urgencyOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const all = [...evalActions, ...okrActions, ...reviewActions, ...checkinActions];
    all.sort((a, b) => {
      const uDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      if (uDiff !== 0) return uDiff;
      if (a.daysLeft === null) return 1;
      if (b.daysLeft === null) return -1;
      return a.daysLeft - b.daysLeft;
    });

    return {
      total: all.length,
      highPriority: all.filter((a) => a.urgency === 'high').length,
      actions: all.slice(0, 8),
    };
  }
}
