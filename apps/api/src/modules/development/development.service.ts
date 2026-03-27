import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Competency, CompetencyStatus } from './entities/competency.entity';
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

  // ─── Competency Workflow ──────────────────────────────────────────────

  /** Manager proposes a new competency (status=proposed) */
  async proposeCompetency(tenantId: string, userId: string, dto: Partial<Competency>) {
    const competency = this.competencyRepo.create({
      ...dto,
      tenantId,
      status: CompetencyStatus.PROPOSED,
      proposedBy: userId,
    });
    return this.competencyRepo.save(competency);
  }

  /** Admin approves a proposed competency */
  async approveCompetency(tenantId: string, id: string, reviewerId: string, note?: string) {
    const comp = await this.competencyRepo.findOne({ where: { id, tenantId } });
    if (!comp) throw new NotFoundException('Competencia no encontrada');
    if (comp.status !== CompetencyStatus.PROPOSED) {
      throw new BadRequestException('Solo se pueden aprobar competencias en estado "propuesta"');
    }
    comp.status = CompetencyStatus.APPROVED;
    comp.reviewedBy = reviewerId;
    comp.reviewNote = note || null;
    comp.reviewedAt = new Date();
    return this.competencyRepo.save(comp);
  }

  /** Admin rejects a proposed competency */
  async rejectCompetency(tenantId: string, id: string, reviewerId: string, note: string) {
    const comp = await this.competencyRepo.findOne({ where: { id, tenantId } });
    if (!comp) throw new NotFoundException('Competencia no encontrada');
    if (comp.status !== CompetencyStatus.PROPOSED) {
      throw new BadRequestException('Solo se pueden rechazar competencias en estado "propuesta"');
    }
    comp.status = CompetencyStatus.REJECTED;
    comp.reviewedBy = reviewerId;
    comp.reviewNote = note;
    comp.reviewedAt = new Date();
    return this.competencyRepo.save(comp);
  }

  /** List competencies pending approval */
  async findPendingCompetencies(tenantId: string) {
    return this.competencyRepo.find({
      where: { tenantId, status: CompetencyStatus.PROPOSED },
      relations: ['proposer'],
      order: { createdAt: 'ASC' },
    });
  }

  // ─── Plans CRUD ────────────────────────────────────────────────────────

  async createPlan(tenantId: string, createdBy: string, dto: Partial<DevelopmentPlan>, role?: string) {
    // Employee co-construction: employee can create a plan for themselves
    // but it starts as 'pendiente_aprobacion' instead of 'borrador'
    const isEmployeeSelfCreation = role === 'employee';
    if (isEmployeeSelfCreation) {
      // Employee can only create plan for themselves
      dto.userId = createdBy;
    }

    const plan = this.planRepo.create({
      ...dto,
      tenantId,
      createdBy,
      status: isEmployeeSelfCreation ? 'pendiente_aprobacion' : 'borrador',
      progress: 0,
    });
    return this.planRepo.save(plan);
  }

  async approvePlan(tenantId: string, planId: string, approverId: string) {
    const plan = await this.planRepo.findOne({ where: { id: planId, tenantId } });
    if (!plan) throw new NotFoundException('Plan de desarrollo no encontrado');
    if (plan.status !== 'pendiente_aprobacion') {
      throw new BadRequestException('Solo se pueden aprobar planes en estado "pendiente_aprobacion"');
    }
    plan.status = 'aprobado';
    // Store approval info in metadata (JSONB-safe pattern)
    const metadata = (plan as any).metadata || {};
    metadata.approvedBy = approverId;
    metadata.approvedAt = new Date().toISOString();
    (plan as any).metadata = metadata;
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

  // Mapping: talentPool → which competency categories are most relevant + action types
  private readonly POOL_SUGGESTIONS: Record<string, {
    focusArea: string;
    priorityCategories: string[];
    actionTypes: string[];
    description: string;
  }> = {
    // Box 9 - Estrella: high performance + high potential
    star: {
      focusArea: 'Liderazgo y visi\u00f3n estrat\u00e9gica',
      priorityCategories: ['liderazgo', 'gestion'],
      actionTypes: ['rotacion', 'proyecto', 'mentoring'],
      description: 'Colaborador estrella. Potenciar liderazgo con rotaciones y proyectos de alto impacto.',
    },
    // Box 8 - Alto rendimiento: high performance + medium potential
    high_performer: {
      focusArea: 'Desarrollo de potencial',
      priorityCategories: ['liderazgo', 'gestion', 'blanda'],
      actionTypes: ['proyecto', 'mentoring', 'rotacion'],
      description: 'Alto rendimiento con potencial medio. Desarrollar habilidades de gesti\u00f3n para desbloquear su potencial.',
    },
    // Box 7 - Alto potencial: medium performance + high potential
    high_potential: {
      focusArea: 'Cierre de brechas t\u00e9cnicas',
      priorityCategories: ['tecnica', 'gestion'],
      actionTypes: ['curso', 'proyecto', 'taller'],
      description: 'Alto potencial con desempe\u00f1o medio. Cerrar brechas t\u00e9cnicas para aprovechar su potencial.',
    },
    // Box 6 - Enigma: high performance + low potential
    enigma: {
      focusArea: 'Ampliaci\u00f3n de perspectiva',
      priorityCategories: ['blanda', 'liderazgo'],
      actionTypes: ['rotacion', 'mentoring', 'lectura'],
      description: 'Buen desempe\u00f1o pero bajo potencial percibido. Ampliar perspectiva con exposici\u00f3n a nuevas \u00e1reas.',
    },
    // Box 5 - Profesional clave: medium performance + medium potential
    core_player: {
      focusArea: '\u00c1reas de mejora continua',
      priorityCategories: ['tecnica', 'blanda'],
      actionTypes: ['curso', 'proyecto', 'lectura'],
      description: 'Profesional s\u00f3lido. Fortalecer competencias t\u00e9cnicas y blandas para seguir creciendo.',
    },
    // Box 4 - Inconsistente: low performance + high potential
    inconsistent: {
      focusArea: 'Estabilizaci\u00f3n de desempe\u00f1o',
      priorityCategories: ['tecnica', 'blanda', 'gestion'],
      actionTypes: ['mentoring', 'curso', 'taller'],
      description: 'Potencial alto pero desempe\u00f1o bajo. Requiere acompa\u00f1amiento cercano para estabilizar resultados.',
    },
    // Box 3 - Riesgo: medium performance + low potential
    risk: {
      focusArea: 'Competencias fundamentales',
      priorityCategories: ['tecnica', 'blanda'],
      actionTypes: ['curso', 'taller', 'mentoring'],
      description: 'Desempe\u00f1o y potencial limitados. Reforzar competencias fundamentales del cargo.',
    },
    // Box 2 - Bajo rendimiento con potencial
    underperformer: {
      focusArea: '\u00c1reas cr\u00edticas de desempe\u00f1o',
      priorityCategories: ['tecnica', 'blanda'],
      actionTypes: ['curso', 'mentoring', 'taller'],
      description: 'Bajo rendimiento pero con potencial medio. Plan intensivo en \u00e1reas cr\u00edticas.',
    },
    // Box 1 - Bajo rendimiento
    dysfunctional: {
      focusArea: 'Plan de mejora urgente',
      priorityCategories: ['tecnica', 'blanda'],
      actionTypes: ['curso', 'taller', 'mentoring'],
      description: 'Bajo rendimiento y bajo potencial. Plan de mejora urgente en competencias b\u00e1sicas del cargo.',
    },
  };

  async suggestPlanFromAssessment(tenantId: string, userId: string, cycleId: string) {
    const assessment = await this.assessmentRepo.findOne({
      where: { tenantId, userId, cycleId },
    });
    if (!assessment) throw new NotFoundException('Evaluaci\u00f3n de talento no encontrada para este ciclo');

    const score = Number(assessment.performanceScore);
    const pool = assessment.talentPool || 'core_player';
    const potential = assessment.potentialScore;
    const nineBoxPosition = assessment.nineBoxPosition;

    const allCompetencies = await this.competencyRepo.find({
      where: { tenantId, isActive: true },
    });

    // Get pool-specific suggestions
    const poolConfig = this.POOL_SUGGESTIONS[pool] || this.POOL_SUGGESTIONS['core_player'];

    // Filter and sort competencies: priority categories first, then others
    const priorityCats = poolConfig.priorityCategories;
    const priorityCompetencies = allCompetencies.filter(
      (c) => priorityCats.includes(c.category),
    );
    const otherCompetencies = allCompetencies.filter(
      (c) => !priorityCats.includes(c.category),
    );

    // Build response with priority-sorted competencies
    const suggestedCompetencies = [
      ...priorityCompetencies.map((c) => ({
        id: c.id,
        name: c.name,
        category: c.category,
        priority: true,
        suggestedActionTypes: poolConfig.actionTypes,
      })),
      ...otherCompetencies.map((c) => ({
        id: c.id,
        name: c.name,
        category: c.category,
        priority: false,
        suggestedActionTypes: poolConfig.actionTypes.slice(0, 2), // fewer actions for secondary
      })),
    ];

    return {
      performanceScore: score,
      potentialScore: potential,
      nineBoxPosition,
      talentPool: pool,
      focusArea: poolConfig.focusArea,
      poolDescription: poolConfig.description,
      suggestedCompetencies,
    };
  }
}
