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
    await this.auditService.log(tenantId, userId, 'cycle.created', 'cycle', saved.id);
    return saved;
  }

  async updateCycle(id: string, tenantId: string, dto: UpdateCycleDto): Promise<EvaluationCycle> {
    const cycle = await this.findCycleById(id, tenantId);
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

  // ─── Peer Assignments (pre-launch) ──────────────────────────────────────

  async addPeerAssignment(tenantId: string, cycleId: string, dto: AddPeerAssignmentDto): Promise<PeerAssignment> {
    const cycle = await this.findCycleById(cycleId, tenantId);
    if (cycle.status !== CycleStatus.DRAFT) {
      throw new BadRequestException('Solo se pueden asignar evaluadores en ciclos en borrador');
    }
    const relationType = dto.relationType ?? RelationType.PEER;
    // Self-evaluation allows same person
    if (relationType !== RelationType.SELF && dto.evaluateeId === dto.evaluatorId) {
      throw new BadRequestException('El evaluado y el evaluador no pueden ser la misma persona');
    }
    const pa = this.peerAssignmentRepo.create({
      tenantId,
      cycleId,
      evaluateeId: dto.evaluateeId,
      evaluatorId: dto.evaluatorId,
      relationType,
    });
    return this.peerAssignmentRepo.save(pa);
  }

  async bulkAddPeerAssignments(tenantId: string, cycleId: string, dto: BulkPeerAssignmentDto): Promise<PeerAssignment[]> {
    const cycle = await this.findCycleById(cycleId, tenantId);
    if (cycle.status !== CycleStatus.DRAFT) {
      throw new BadRequestException('Solo se pueden asignar evaluadores en ciclos en borrador');
    }
    const entities = dto.assignments.map((a) =>
      this.peerAssignmentRepo.create({
        tenantId,
        cycleId,
        evaluateeId: a.evaluateeId,
        evaluatorId: a.evaluatorId,
        relationType: a.relationType ?? RelationType.PEER,
      }),
    );
    return this.peerAssignmentRepo.save(entities);
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

    // Extract numeric answers (scale questions) and average them
    const numericValues = Object.values(answers).filter(
      (v): v is number => typeof v === 'number',
    );

    if (numericValues.length === 0) return null;

    const avg = numericValues.reduce((sum, v) => sum + v, 0) / numericValues.length;
    // Normalize to 0-100 scale (assuming 1-5 scale questions)
    const normalized = ((avg - 1) / 4) * 100;
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
