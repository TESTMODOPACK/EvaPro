import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Competency } from './entities/competency.entity';
import { DevelopmentPlan } from './entities/development-plan.entity';
import { DevelopmentAction } from './entities/development-action.entity';
import { DevelopmentComment } from './entities/development-comment.entity';
import { User } from '../users/entities/user.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';

@Injectable()
export class DevelopmentService {
  constructor(
    @InjectRepository(Competency)
    private readonly competencyRepo: Repository<Competency>,
    @InjectRepository(DevelopmentPlan)
    private readonly planRepo: Repository<DevelopmentPlan>,
    @InjectRepository(DevelopmentAction)
    private readonly actionRepo: Repository<DevelopmentAction>,
    @InjectRepository(DevelopmentComment)
    private readonly commentRepo: Repository<DevelopmentComment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(TalentAssessment)
    private readonly assessmentRepo: Repository<TalentAssessment>,
  ) {}

  // ─── Competencies ──────────────────────────────────────────────────────

  async createCompetency(tenantId: string, dto: Partial<Competency>) {
    if (dto.name) {
      const existing = await this.competencyRepo.findOne({
        where: { tenantId, name: dto.name, isActive: true },
      });
      if (existing) {
        throw new ConflictException(`Ya existe una competencia con el nombre "${dto.name}"`);
      }
    }
    const competency = this.competencyRepo.create({
      ...dto,
      tenantId,
    });
    return this.competencyRepo.save(competency);
  }

  async findAllCompetencies(tenantId: string) {
    return this.competencyRepo.find({
      where: { tenantId, isActive: true },
      order: { category: 'ASC', name: 'ASC' },
    });
  }

  async updateCompetency(tenantId: string, id: string, dto: Partial<Competency>) {
    const competency = await this.competencyRepo.findOne({ where: { id, tenantId } });
    if (!competency) throw new NotFoundException('Competencia no encontrada');
    Object.assign(competency, dto);
    return this.competencyRepo.save(competency);
  }

  async deactivateCompetency(tenantId: string, id: string) {
    const competency = await this.competencyRepo.findOne({ where: { id, tenantId } });
    if (!competency) throw new NotFoundException('Competencia no encontrada');
    competency.isActive = false;
    return this.competencyRepo.save(competency);
  }

  // ─── Plans CRUD ────────────────────────────────────────────────────────

  async createPlan(tenantId: string, createdBy: string, dto: Partial<DevelopmentPlan>) {
    const plan = this.planRepo.create({
      ...dto,
      tenantId,
      createdBy,
      status: 'borrador',
      progress: 0,
    });
    return this.planRepo.save(plan);
  }

  async findAllPlans(tenantId: string) {
    return this.planRepo.find({
      where: { tenantId },
      relations: ['user', 'creator', 'actions', 'actions.competency'],
      order: { createdAt: 'DESC' },
    });
  }

  async findPlansByManager(tenantId: string, managerId: string) {
    const directReports = await this.userRepo.find({
      where: { tenantId, managerId },
      select: ['id'],
    });
    const userIds = directReports.map((u) => u.id);
    userIds.push(managerId);

    return this.planRepo.find({
      where: { tenantId, userId: In(userIds) },
      relations: ['user', 'creator', 'actions', 'actions.competency'],
      order: { createdAt: 'DESC' },
    });
  }

  async findPlansByUser(tenantId: string, userId: string) {
    return this.planRepo.find({
      where: { tenantId, userId },
      relations: ['user', 'creator', 'actions', 'actions.competency'],
      order: { createdAt: 'DESC' },
    });
  }

  async findPlanById(tenantId: string, id: string) {
    const plan = await this.planRepo.findOne({
      where: { id, tenantId },
      relations: ['user', 'creator', 'actions', 'actions.competency', 'comments', 'comments.author'],
    });
    if (!plan) throw new NotFoundException('Plan de desarrollo no encontrado');
    return plan;
  }

  async updatePlan(tenantId: string, id: string, dto: Partial<DevelopmentPlan>) {
    const plan = await this.planRepo.findOne({ where: { id, tenantId } });
    if (!plan) throw new NotFoundException('Plan de desarrollo no encontrado');

    const { title, description, status, priority, startDate, targetDate } = dto as any;
    if (title !== undefined) plan.title = title;
    if (description !== undefined) plan.description = description;
    if (status !== undefined) plan.status = status;
    if (priority !== undefined) plan.priority = priority;
    if (startDate !== undefined) plan.startDate = startDate;
    if (targetDate !== undefined) plan.targetDate = targetDate;

    return this.planRepo.save(plan);
  }

  async activatePlan(tenantId: string, id: string) {
    const plan = await this.planRepo.findOne({
      where: { id, tenantId },
      relations: ['actions'],
    });
    if (!plan) throw new NotFoundException('Plan de desarrollo no encontrado');
    if (plan.status !== 'borrador') {
      throw new BadRequestException('Solo se pueden activar planes en estado borrador');
    }
    if (!plan.actions || plan.actions.length === 0) {
      throw new BadRequestException(
        'No se puede activar un plan sin acciones de desarrollo. Agrega al menos una acci\u00f3n antes de activar.',
      );
    }
    plan.status = 'activo';
    return this.planRepo.save(plan);
  }

  async completePlan(tenantId: string, id: string) {
    const plan = await this.planRepo.findOne({
      where: { id, tenantId },
      relations: ['actions'],
    });
    if (!plan) throw new NotFoundException('Plan de desarrollo no encontrado');
    if (plan.status !== 'activo') {
      throw new BadRequestException('Solo se pueden completar planes en estado activo');
    }
    plan.status = 'completado';
    plan.completedAt = new Date();
    return this.planRepo.save(plan);
  }

  // ─── Actions ───────────────────────────────────────────────────────────

  async addAction(tenantId: string, planId: string, dto: Partial<DevelopmentAction>) {
    const plan = await this.planRepo.findOne({ where: { id: planId, tenantId } });
    if (!plan) throw new NotFoundException('Plan de desarrollo no encontrado');

    const action = this.actionRepo.create({
      ...dto,
      tenantId,
      planId,
    });
    const saved = await this.actionRepo.save(action);
    await this.recalculateProgress(planId);
    return saved;
  }

  async updateAction(tenantId: string, actionId: string, dto: Partial<DevelopmentAction>) {
    const action = await this.actionRepo.findOne({ where: { id: actionId, tenantId } });
    if (!action) throw new NotFoundException('Accion no encontrada');
    Object.assign(action, dto);
    const saved = await this.actionRepo.save(action);
    await this.recalculateProgress(action.planId);
    return saved;
  }

  async completeAction(tenantId: string, actionId: string) {
    const action = await this.actionRepo.findOne({ where: { id: actionId, tenantId } });
    if (!action) throw new NotFoundException('Accion no encontrada');
    action.status = 'completada';
    action.completedAt = new Date();
    const saved = await this.actionRepo.save(action);
    await this.recalculateProgress(action.planId);
    return saved;
  }

  async removeAction(tenantId: string, actionId: string) {
    const action = await this.actionRepo.findOne({ where: { id: actionId, tenantId } });
    if (!action) throw new NotFoundException('Accion no encontrada');
    const planId = action.planId;
    await this.actionRepo.remove(action);
    await this.recalculateProgress(planId);
  }

  // ─── Progress Recalculation ────────────────────────────────────────────

  private async recalculateProgress(planId: string) {
    const total = await this.actionRepo.count({ where: { planId } });
    const completed = await this.actionRepo.count({ where: { planId, status: 'completada' } });

    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) return;

    plan.progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    if (total > 0 && completed === total && plan.status === 'activo') {
      plan.status = 'completado';
      plan.completedAt = new Date();
    }

    await this.planRepo.save(plan);
  }

  // ─── Comments ──────────────────────────────────────────────────────────

  async listComments(tenantId: string, planId: string) {
    return this.commentRepo.find({
      where: { tenantId, planId },
      relations: ['author'],
      order: { createdAt: 'DESC' },
    });
  }

  async createComment(
    tenantId: string,
    planId: string,
    authorId: string,
    dto: Partial<DevelopmentComment>,
  ) {
    const plan = await this.planRepo.findOne({ where: { id: planId, tenantId } });
    if (!plan) throw new NotFoundException('Plan de desarrollo no encontrado');

    const comment = this.commentRepo.create({
      ...dto,
      tenantId,
      planId,
      authorId,
    });
    return this.commentRepo.save(comment);
  }

  async deleteComment(
    tenantId: string,
    commentId: string,
    requesterId: string,
    requesterRole: string,
  ) {
    const comment = await this.commentRepo.findOne({ where: { id: commentId, tenantId } });
    if (!comment) throw new NotFoundException('Comentario no encontrado');

    if (comment.authorId !== requesterId && requesterRole !== 'tenant_admin') {
      throw new ForbiddenException('Solo el autor o un administrador puede eliminar este comentario');
    }

    await this.commentRepo.remove(comment);
  }

  // ─── Suggestions ───────────────────────────────────────────────────────

  async suggestPlanFromAssessment(tenantId: string, userId: string, cycleId: string) {
    const assessment = await this.assessmentRepo.findOne({
      where: { tenantId, userId, cycleId },
    });
    if (!assessment) throw new NotFoundException('Evaluacion de talento no encontrada para este ciclo');

    const score = Number(assessment.performanceScore);
    const competencies = await this.competencyRepo.find({
      where: { tenantId, isActive: true },
    });

    let focusArea: string;
    let suggestedActionTypes: string[];

    if (score < 5) {
      focusArea = 'areas criticas';
      suggestedActionTypes = ['curso', 'mentoring', 'taller'];
    } else if (score <= 7) {
      focusArea = 'areas de mejora';
      suggestedActionTypes = ['proyecto', 'curso', 'lectura'];
    } else {
      focusArea = 'fortalezas a potenciar';
      suggestedActionTypes = ['rotacion', 'proyecto', 'mentoring'];
    }

    return {
      performanceScore: score,
      focusArea,
      suggestedCompetencies: competencies.map((c) => ({
        id: c.id,
        name: c.name,
        category: c.category,
        suggestedActionTypes,
      })),
    };
  }
}
