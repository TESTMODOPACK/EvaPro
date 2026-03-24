import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EvaluationCycle, CycleType, CycleStatus } from './entities/evaluation-cycle.entity';
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

@Injectable()
export class EvaluationsService {
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
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  // ─── Cycles ───────────────────────────────────────────────────────────────

  async findAllCycles(tenantId: string): Promise<EvaluationCycle[]> {
    return this.cycleRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
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
    const cycle = this.cycleRepo.create({
      tenantId,
      name: dto.name,
      type: dto.type ?? CycleType.DEGREE_90,
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
    if (data.startDate) stage.startDate = new Date(data.startDate);
    if (data.endDate) stage.endDate = new Date(data.endDate);
    if (data.name) stage.name = data.name;
    return this.stageRepo.save(stage);
  }

  async updateCycle(id: string, tenantId: string, dto: UpdateCycleDto): Promise<EvaluationCycle> {
    const cycle = await this.findCycleById(id, tenantId);
    const effectiveStart = dto.startDate ? new Date(dto.startDate) : cycle.startDate;
    const effectiveEnd = dto.endDate ? new Date(dto.endDate) : cycle.endDate;
    if (effectiveStart >= effectiveEnd) {
      throw new BadRequestException('La fecha de inicio debe ser anterior a la fecha de fin');
    }
    Object.assign(cycle, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
      ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.templateId !== undefined && { templateId: dto.templateId }),
      ...(dto.settings !== undefined && { settings: dto.settings }),
    });
    return this.cycleRepo.save(cycle);
  }

  async deleteCycle(id: string, tenantId: string): Promise<void> {
    const cycle = await this.findCycleById(id, tenantId);
    if (cycle.status === CycleStatus.ACTIVE) {
      throw new BadRequestException('No se puede eliminar un ciclo activo');
    }
    await this.cycleRepo.remove(cycle);
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

  async autoGenerateAssignments(tenantId: string, cycleId: string): Promise<{ created: number; skipped: number }> {
    const cycle = await this.findCycleById(cycleId, tenantId);
    if (cycle.status !== CycleStatus.DRAFT) {
      throw new BadRequestException('Solo se pueden generar asignaciones en ciclos en borrador');
    }

    const allowedRelations = this.getAllowedRelations(cycle.type as CycleType);
    const users = await this.userRepo.find({
      where: { tenantId, isActive: true },
      select: ['id', 'managerId', 'role'],
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

    for (const evaluatee of evaluatees) {
      // Self-evaluation
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

      // Manager evaluation
      if (allowedRelations.includes(RelationType.MANAGER) && evaluatee.managerId) {
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

      // Direct reports evaluate upward (360° only)
      if (allowedRelations.includes(RelationType.DIRECT_REPORT)) {
        const directReports = users.filter((u) => u.managerId === evaluatee.id && u.role !== 'super_admin' && u.role !== 'external');
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

    // Note: PEER assignments are NOT auto-generated (admin must select peers manually)

    if (toCreate.length === 0) {
      return { created: 0, skipped: evaluatees.length };
    }

    const entities = toCreate.map((pa) => this.peerAssignmentRepo.create(pa));
    await this.peerAssignmentRepo.save(entities);

    return { created: toCreate.length, skipped: 0 };
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
    if (cycle.status !== CycleStatus.ACTIVE) {
      throw new BadRequestException('Solo se puede cerrar un ciclo activo');
    }
    cycle.status = CycleStatus.CLOSED;
    const saved = await this.cycleRepo.save(cycle);
    await this.auditService.log(tenantId, userId, 'cycle.closed', 'cycle', id);
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
      relations: ['evaluatee', 'cycle'],
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

    return { assignment, template, response };
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
    // Normalize to 0-10 scale (scale questions are 1-5)
    const normalized = (avg / 5) * 10;
    return Math.round(normalized * 100) / 100;
  }

  // ─── Dashboard Stats ──────────────────────────────────────────────────────

  async getStats(tenantId: string) {
    const [totalCycles, activeCycles] = await Promise.all([
      this.cycleRepo.count({ where: { tenantId } }),
      this.cycleRepo.count({ where: { tenantId, status: CycleStatus.ACTIVE } }),
    ]);

    const totalAssignments = await this.assignmentRepo
      .createQueryBuilder('a')
      .where('a.tenantId = :tenantId', { tenantId })
      .getCount();

    const completedAssignments = await this.assignmentRepo
      .createQueryBuilder('a')
      .where('a.tenantId = :tenantId', { tenantId })
      .andWhere('a.status = :status', { status: AssignmentStatus.COMPLETED })
      .getCount();

    const avgScoreResult = await this.responseRepo
      .createQueryBuilder('r')
      .where('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.overall_score IS NOT NULL')
      .select('AVG(r.overall_score)', 'avg')
      .getRawOne();

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
    };
  }
}
