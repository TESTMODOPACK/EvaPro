import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { cachedFetch, invalidateCache } from '../../common/cache/cache.helper';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Competency, CompetencyStatus } from './entities/competency.entity';
import { DevelopmentPlan } from './entities/development-plan.entity';
import { DevelopmentAction, DevelopmentActionStatus } from './entities/development-action.entity';
import { DevelopmentComment } from './entities/development-comment.entity';
import { User } from '../users/entities/user.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { RoleCompetency } from './entities/role-competency.entity';
import { Position } from '../tenants/entities/position.entity';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RecognitionService } from '../recognition/recognition.service';
import { PointsSource } from '../recognition/entities/user-points.entity';
import { NotificationType } from '../notifications/entities/notification.entity';

@Injectable()
export class DevelopmentService {
  constructor(
    @InjectRepository(Competency)
    private readonly competencyRepo: Repository<Competency>,
    @InjectRepository(RoleCompetency)
    private readonly roleCompetencyRepo: Repository<RoleCompetency>,
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
    @InjectRepository(Position)
    private readonly positionRepo: Repository<Position>,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
    private readonly recognitionService: RecognitionService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  // ─── Competencies ──────────────────────────────────────────────────────

  async createCompetency(tenantId: string, dto: Partial<Competency>, userId?: string) {
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
    const saved = await this.competencyRepo.save(competency);
    await invalidateCache(this.cacheManager, `competencies:${tenantId}`);
    this.auditService.log(tenantId, userId || null, 'competency.created', 'competency', saved.id, {
      name: dto.name, category: dto.category,
    }).catch(() => {});
    return saved;
  }

  async findAllCompetencies(tenantId: string, includeAll = false) {
    const where: any = { tenantId, isActive: true };
    if (!includeAll) {
      where.status = CompetencyStatus.APPROVED;
    }
    // Solo cachear el caso mas comun (approved, sin relations pesadas).
    // includeAll=true se usa solo en la vista admin de competencias, que
    // necesita proposer/reviewer y se llama raramente.
    if (!includeAll) {
      return cachedFetch(this.cacheManager, `competencies:${tenantId}`, 600, () =>
        this.competencyRepo.find({ where, order: { category: 'ASC', name: 'ASC' } }),
      );
    }
    return this.competencyRepo.find({
      where,
      relations: ['proposer', 'reviewer'],
      order: { category: 'ASC', name: 'ASC' },
    });
  }

  async updateCompetency(tenantId: string, id: string, dto: Partial<Competency>) {
    const competency = await this.competencyRepo.findOne({ where: { id, tenantId } });
    if (!competency) throw new NotFoundException('Competencia no encontrada');
    Object.assign(competency, dto);
    const saved = await this.competencyRepo.save(competency);
    await invalidateCache(this.cacheManager, `competencies:${tenantId}`);
    return saved;
  }

  async deactivateCompetency(tenantId: string, id: string) {
    const competency = await this.competencyRepo.findOne({ where: { id, tenantId } });
    if (!competency) throw new NotFoundException('Competencia no encontrada');

    // Validate: check if competency is in use before deactivating
    const usages: string[] = [];

    const roleCompCount = await this.roleCompetencyRepo.count({ where: { competencyId: id } });
    if (roleCompCount > 0) {
      usages.push(`${roleCompCount} perfil(es) de cargo`);
    }

    const actionCount = await this.actionRepo.count({ where: { competencyId: id } });
    if (actionCount > 0) {
      usages.push(`${actionCount} acción(es) de desarrollo`);
    }

    if (usages.length > 0) {
      throw new BadRequestException(
        `No se puede desactivar la competencia "${competency.name}" porque está en uso en: ${usages.join(', ')}. Elimina primero las referencias.`,
      );
    }

    competency.isActive = false;
    competency.deactivatedAt = new Date();
    const saved = await this.competencyRepo.save(competency);
    await invalidateCache(this.cacheManager, `competencies:${tenantId}`);
    return saved;
  }

  // ─── Seed Default Competencies ────────────────────────────────────────

  async seedDefaultCompetencies(tenantId: string, userId?: string): Promise<{ created: number; skipped: number; updated: number; total: number }> {
    const defaults: Array<{ name: string; category: string; description: string }> = [
      { name: 'Liderazgo', category: 'Gestion', description: 'Capacidad de guiar, motivar e inspirar a equipos hacia el logro de objetivos organizacionales' },
      { name: 'Comunicación efectiva', category: 'Blanda', description: 'Habilidad para transmitir ideas de forma clara, asertiva y adaptada a la audiencia' },
      { name: 'Trabajo en equipo', category: 'Blanda', description: 'Capacidad de colaborar y contribuir activamente al logro colectivo respetando la diversidad' },
      { name: 'Resolución de problemas', category: 'Tecnica', description: 'Habilidad para analizar situaciones complejas y encontrar soluciones efectivas y sustentables' },
      { name: 'Adaptabilidad', category: 'Blanda', description: 'Flexibilidad para ajustarse a cambios, nuevas situaciones y ambientes de incertidumbre' },
      { name: 'Orientación a resultados', category: 'Gestion', description: 'Enfoque en cumplir objetivos y metas con calidad, eficiencia y dentro de los plazos establecidos' },
      { name: 'Conocimiento técnico del área', category: 'Tecnica', description: 'Dominio de las herramientas, tecnologías y procesos específicos del área de trabajo' },
      { name: 'Creatividad e innovación', category: 'Blanda', description: 'Capacidad de generar ideas nuevas y proponer mejoras a procesos y productos' },
    ];

    // Helper: normalize name for comparison (remove accents, lowercase)
    const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    // Load existing competencies to compare
    const existing = await this.competencyRepo.find({ where: { tenantId } });
    const existingNames = new Set(existing.map(c => normalize(c.name)));

    let created = 0;
    let skipped = 0;
    const updated: string[] = [];

    // First: update existing competencies that match by normalized name (fix accents + reactivate)
    for (const def of defaults) {
      const match = existing.find(c => normalize(c.name) === normalize(def.name));
      if (match) {
        let needsSave = false;
        // Fix accents if different
        if (match.name !== def.name) { match.name = def.name; needsSave = true; }
        if (match.description !== def.description) { match.description = def.description; needsSave = true; }
        // Reactivate if deactivated
        if (!match.isActive) { match.isActive = true; needsSave = true; }
        // Ensure approved status
        if (match.status !== CompetencyStatus.APPROVED) { match.status = CompetencyStatus.APPROVED; needsSave = true; }
        if (needsSave) {
          await this.competencyRepo.save(match);
          updated.push(def.name);
        }
      }
    }

    for (const def of defaults) {
      if (existingNames.has(normalize(def.name))) {
        skipped++;
        continue;
      }
      await this.competencyRepo.save(this.competencyRepo.create({
        tenantId,
        name: def.name,
        category: def.category,
        description: def.description,
        status: CompetencyStatus.APPROVED,
        isActive: true,
      }));
      created++;
    }

    if (userId) {
      await this.auditService.log(tenantId, userId, 'competencies.seeded', 'competency', undefined, { created, skipped, updated: updated.length }).catch(() => {});
    }

    await invalidateCache(this.cacheManager, `competencies:${tenantId}`);
    return { created, skipped, updated: updated.length, total: defaults.length };
  }

  // ─── Competency Workflow ──────────────────────────────────────────────

  /** Manager proposes a new competency (status=proposed) */
  async proposeCompetency(tenantId: string, userId: string, dto: Partial<Competency>) {
    // Check for duplicate names
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
    const saved = await this.competencyRepo.save(comp);
    await invalidateCache(this.cacheManager, `competencies:${tenantId}`);
    this.auditService.log(tenantId, reviewerId, 'competency.approved', 'competency', comp.id, {
      name: comp.name, approvedBy: reviewerId,
    }).catch(() => {});
    return saved;
  }

  /** Admin rejects a proposed competency */
  async rejectCompetency(tenantId: string, id: string, reviewerId: string, note: string) {
    if (!note || !note.trim()) {
      throw new BadRequestException('Se requiere una nota de rechazo');
    }
    const comp = await this.competencyRepo.findOne({ where: { id, tenantId } });
    if (!comp) throw new NotFoundException('Competencia no encontrada');
    if (comp.status !== CompetencyStatus.PROPOSED) {
      throw new BadRequestException('Solo se pueden rechazar competencias en estado "propuesta"');
    }
    comp.status = CompetencyStatus.REJECTED;
    comp.reviewedBy = reviewerId;
    comp.reviewNote = note.trim();
    comp.reviewedAt = new Date();
    const saved = await this.competencyRepo.save(comp);
    await invalidateCache(this.cacheManager, `competencies:${tenantId}`);
    this.auditService.log(tenantId, reviewerId, 'competency.rejected', 'competency', comp.id, {
      name: comp.name, rejectedBy: reviewerId, reason: note.trim(),
    }).catch(() => {});
    return saved;
  }

  /** List competencies pending approval */
  async findPendingCompetencies(tenantId: string) {
    return this.competencyRepo.find({
      where: { tenantId, status: CompetencyStatus.PROPOSED },
      relations: ['proposer'],
      order: { createdAt: 'ASC' },
    });
  }

  // ─── Competency Profile: Actual vs Expected ─────────────────────────────

  // ─── Role Competencies CRUD ──────────────────────────────────────────

  async findRoleCompetencies(tenantId: string, position?: string, positionId?: string): Promise<RoleCompetency[]> {
    const where: any = { tenantId };
    if (positionId) {
      where.positionId = positionId;
    } else if (position) {
      where.position = position;
    }
    return this.roleCompetencyRepo.find({ where, relations: ['competency'], order: { position: 'ASC', createdAt: 'ASC' } });
  }

  async createRoleCompetency(tenantId: string, dto: { position: string; positionId?: string; competencyId: string; expectedLevel: number }): Promise<RoleCompetency> {
    if (dto.expectedLevel < 1 || dto.expectedLevel > 10) throw new BadRequestException('El nivel esperado debe estar entre 1 y 10');

    // Dual-write: resolve positionId↔position
    let positionName = dto.position;
    let positionId: string | null = null;
    if (dto.positionId) {
      const p = await this.positionRepo.findOne({ where: { id: dto.positionId, tenantId } });
      if (p) { positionId = p.id; positionName = p.name; }
    } else if (positionName) {
      const p = await this.positionRepo.createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('LOWER(p.name) = LOWER(:name)', { name: positionName })
        .getOne();
      if (p) positionId = p.id;
    }

    const existing = await this.roleCompetencyRepo.findOne({ where: { tenantId, position: positionName, competencyId: dto.competencyId } });
    if (existing) throw new ConflictException('Esta competencia ya está asignada a este cargo');
    const rc = this.roleCompetencyRepo.create({ tenantId, position: positionName, positionId, competencyId: dto.competencyId, expectedLevel: dto.expectedLevel } as Partial<RoleCompetency>);
    return this.roleCompetencyRepo.save(rc);
  }

  /**
   * Update the expected level of a role↔competency mapping.
   *
   * Note: position and competencyId are intentionally NOT editable here —
   * changing either effectively creates a different mapping, so the right
   * pattern is delete + create. This keeps the dual-write of position
   * text↔FK contained to `createRoleCompetency` / `bulkAssignCompetencies`.
   */
  async updateRoleCompetency(tenantId: string, id: string, expectedLevel: number): Promise<RoleCompetency> {
    if (expectedLevel < 1 || expectedLevel > 10) throw new BadRequestException('El nivel esperado debe estar entre 1 y 10');
    const rc = await this.roleCompetencyRepo.findOne({ where: { id, tenantId } });
    if (!rc) throw new NotFoundException('Asignación no encontrada');
    rc.expectedLevel = expectedLevel;
    return this.roleCompetencyRepo.save(rc);
  }

  async deleteRoleCompetency(tenantId: string, id: string): Promise<void> {
    const rc = await this.roleCompetencyRepo.findOne({ where: { id, tenantId } });
    if (!rc) throw new NotFoundException('Asignación no encontrada');
    await this.roleCompetencyRepo.remove(rc);
  }

  async bulkAssignCompetencies(tenantId: string, position: string, defaultLevel: number = 5, positionId?: string): Promise<{ created: number }> {
    // Dual-write: resolve position↔positionId in BOTH directions so new
    // rows always carry the canonical name + FK regardless of which the
    // caller supplied.
    let resolvedPosName = position;
    let resolvedPosId = positionId || null;
    if (resolvedPosId) {
      const p = await this.positionRepo.findOne({ where: { id: resolvedPosId, tenantId } });
      if (p) resolvedPosName = p.name; // snap text to the canonical name
    } else if (resolvedPosName) {
      const p = await this.positionRepo.createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('LOWER(p.name) = LOWER(:name)', { name: resolvedPosName })
        .getOne();
      if (p) resolvedPosId = p.id;
    }

    const competencies = await this.competencyRepo.find({ where: { tenantId, isActive: true, status: CompetencyStatus.APPROVED } });
    let created = 0;
    for (const comp of competencies) {
      const exists = await this.roleCompetencyRepo.findOne({ where: { tenantId, position: resolvedPosName, competencyId: comp.id } });
      if (!exists) {
        await this.roleCompetencyRepo.save(this.roleCompetencyRepo.create({ tenantId, position: resolvedPosName, positionId: resolvedPosId, competencyId: comp.id, expectedLevel: defaultLevel } as any));
        created++;
      }
    }
    return { created };
  }

  /**
   * B8.3: Returns the user's competency profile comparing actual evaluation scores
   * against the expected level for their role (position).
   */
  async getCompetencyProfile(tenantId: string, userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId, tenantId },
      select: ['id', 'firstName', 'lastName', 'position'],
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // Get expected competencies for the user's role
    const roleCompetencies = user.position
      ? await this.roleCompetencyRepo.find({
          where: { tenantId, position: user.position },
          relations: ['competency'],
        })
      : [];

    // Get user's latest talent assessment for actual scores
    const assessment = await this.assessmentRepo.findOne({
      where: { tenantId, userId },
      order: { updatedAt: 'DESC' },
    });

    // Get development actions only for this user's plans
    const userPlans = await this.planRepo.find({
      where: { tenantId, userId },
      select: ['id'],
    });
    const userPlanIds = userPlans.map((p) => p.id);
    const userActions = userPlanIds.length > 0
      ? await this.actionRepo.find({ where: { tenantId, planId: In(userPlanIds) } })
      : [];

    // Build profile comparing expected vs actual per competency
    // Note: actualLevel requires per-competency evaluation data (from 360 responses),
    // which is not directly available here. We set it to null and flag competencies
    // that have development actions (indicating identified gaps).
    const profile = roleCompetencies.map((rc) => {
      const relatedActions = userActions.filter((a) => a.competencyId === rc.competencyId);
      const hasGap = relatedActions.length > 0;
      return {
        competencyId: rc.competencyId,
        competencyName: rc.competency?.name || 'N/A',
        competencyCategory: rc.competency?.category || null,
        expectedLevel: rc.expectedLevel,
        hasIdentifiedGap: hasGap,
        developmentActions: relatedActions.length,
        completedActions: relatedActions.filter((a) => a.status === 'completada').length,
        pendingActions: relatedActions.filter((a) => a.status === 'pendiente' || a.status === 'en_progreso').length,
      };
    });

    return {
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName, position: user.position },
      position: user.position,
      totalCompetencies: profile.length,
      competenciesWithGap: profile.filter((p) => p.hasIdentifiedGap).length,
      competenciesFullyCovered: profile.filter((p) => p.developmentActions > 0 && p.pendingActions === 0).length,
      profile,
    };
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
    const saved = await this.planRepo.save(plan);
    this.auditService.log(tenantId, createdBy, 'pdi.created', 'development_plan', saved.id, {
      planTitle: dto.title, employeeId: dto.userId, createdBy,
    }).catch(() => {});

    // Send email to plan owner only when created by someone else (manager/admin)
    const ownerId = dto.userId || createdBy;
    if (ownerId !== createdBy) {
      const owner = await this.userRepo.findOne({ where: { id: ownerId }, select: ['id', 'email', 'firstName'] });
      if (owner?.email) {
        const creator = await this.userRepo.findOne({ where: { id: createdBy }, select: ['id', 'firstName', 'lastName'] });
        this.emailService.sendPdiAssigned(owner.email, {
          firstName: owner.firstName,
          planTitle: dto.title || saved.title || 'Plan de desarrollo',
          createdByName: creator ? `${creator.firstName} ${creator.lastName}` : undefined,
          tenantId,
          userId: owner.id,
        }).catch(() => {});
      }
    }

    return saved;
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

  /**
   * Shared queryBuilder for development plan lookups. Enforces tenant-match
   * on every joined relation (user, creator, actions) so an orphan FK can't
   * leak cross-tenant data via the JOIN.
   */
  private plansWithRelationsQb(tenantId: string) {
    return this.planRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.user', 'user', 'user.tenant_id = p.tenant_id')
      .leftJoinAndSelect('p.creator', 'creator', 'creator.tenant_id = p.tenant_id')
      .leftJoinAndSelect('p.actions', 'actions', 'actions.tenant_id = p.tenant_id')
      .leftJoinAndSelect('actions.competency', 'competency', 'competency.tenant_id = p.tenant_id')
      .where('p.tenantId = :tenantId', { tenantId })
      .orderBy('p.createdAt', 'DESC');
  }

  async findAllPlans(tenantId: string) {
    return this.plansWithRelationsQb(tenantId).take(200).getMany();
  }

  async findPlansByManager(tenantId: string, managerId: string) {
    const directReports = await this.userRepo.find({
      where: { tenantId, managerId },
      select: ['id'],
    });
    const userIds = directReports.map((u) => u.id);
    userIds.push(managerId);

    return this.plansWithRelationsQb(tenantId)
      .andWhere('p.userId IN (:...userIds)', { userIds })
      .take(200)
      .getMany();
  }

  async findPlansByUser(tenantId: string, userId: string) {
    return this.plansWithRelationsQb(tenantId)
      .andWhere('p.userId = :userId', { userId })
      .take(200)
      .getMany();
  }

  async findPlanById(tenantId: string, id: string) {
    const plan = await this.plansWithRelationsQb(tenantId)
      .leftJoinAndSelect('p.comments', 'comments', 'comments.tenant_id = p.tenant_id')
      .leftJoinAndSelect('comments.author', 'commentAuthor', 'commentAuthor.tenant_id = p.tenant_id')
      .andWhere('p.id = :id', { id })
      .getOne();
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

  async activatePlan(tenantId: string, id: string, userId?: string) {
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
        'No se puede activar un plan sin acciones de desarrollo. Agrega al menos una acción antes de activar.',
      );
    }

    // B9.1: All actions must be linked to a competency gap
    const actionsWithoutCompetency = plan.actions.filter((a) => !a.competencyId);
    if (actionsWithoutCompetency.length > 0) {
      throw new BadRequestException(
        `${actionsWithoutCompetency.length} acción(es) no están vinculadas a una competencia. Todas las acciones deben estar asociadas a una brecha de competencia para activar el plan.`,
      );
    }

    // B8.1: Validate that the user's role has at least 3 competencies mapped
    const user = await this.userRepo.findOne({
      where: { id: plan.userId, tenantId },
      select: ['id', 'position'],
    });
    if (user?.position) {
      const roleCompCount = await this.roleCompetencyRepo.count({
        where: { tenantId, position: user.position },
      });
      if (roleCompCount > 0 && roleCompCount < 3) {
        throw new BadRequestException(
          `El rol "${user.position}" tiene solo ${roleCompCount} competencia(s) asignada(s). Se requieren mínimo 3 competencias críticas por rol para activar un plan de desarrollo.`,
        );
      }
    }

    plan.status = 'activo';
    const saved = await this.planRepo.save(plan);
    this.auditService.log(tenantId, userId || null, 'pdi.status_changed', 'development_plan', plan.id, {
      planTitle: plan.title, previousStatus: 'borrador', newStatus: 'activo',
    }).catch(() => {});

    // Notify plan owner: signature pending for PDI
    this.notificationsService.create({
      tenantId,
      userId: plan.userId,
      type: NotificationType.GENERAL,
      title: 'Firma pendiente — Plan de desarrollo',
      message: `Tu plan de desarrollo "${plan.title}" ha sido activado. Por favor revisa y firma el plan en la sección Desarrollo.`,
      metadata: { planId: plan.id, action: 'signature_pending', documentType: 'development_plan' },
    }).catch(() => {});

    // Send email notification
    const owner = await this.userRepo.findOne({ where: { id: plan.userId }, select: ['id', 'email', 'firstName'] });
    if (owner?.email) {
      this.emailService.sendPdiAssigned(owner.email, {
        firstName: owner.firstName,
        planTitle: `[Requiere firma] ${plan.title}`,
        tenantId,
        userId: owner.id,
      }).catch(() => {});
    }

    return saved;
  }

  async completePlan(tenantId: string, id: string, userId?: string) {
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
    const saved = await this.planRepo.save(plan);
    this.auditService.log(tenantId, userId || null, 'pdi.status_changed', 'development_plan', plan.id, {
      planTitle: plan.title, previousStatus: 'activo', newStatus: 'completado',
    }).catch(() => {});
    return saved;
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

  /**
   * Marca una acción de desarrollo como completada.
   *
   * Reglas de negocio:
   *   1. El plan debe estar ACTIVO (o en revisión). Si está en borrador,
   *      cancelado o completado, se rechaza con 409 — el manager tiene que
   *      activar el plan primero.
   *   2. Permisos:
   *      · employee → solo puede completar acciones de SU plan (plan.userId)
   *      · manager  → solo si el owner del plan es su direct report
   *      · tenant_admin / super_admin → siempre pueden
   *   3. Si la acción ya está completada, no-op (idempotente).
   *
   *   4. Al completar, se setea completedAt = now() (usado por el UI para
   *      mostrar "Cumplida en tiempo" vs "Tardía" comparando con dueDate).
   */
  /**
   * Resumen para el dashboard del admin: cuántos planes activos no tienen
   * NINGUNA acción cargada (sospechoso — un PDI sin acciones es un plan
   * vacío que nunca se completará).
   *
   * Devuelve el count + lista mínima (id, title, userId) de hasta 5 ejemplos.
   */
  async getActivePlansWithoutActions(
    tenantId: string,
  ): Promise<{ count: number; samples: Array<{ id: string; title: string; userId: string }> }> {
    const rows = await this.planRepo
      .createQueryBuilder('p')
      .leftJoin('development_actions', 'a', 'a.plan_id = p.id')
      .select('p.id', 'id')
      .addSelect('p.title', 'title')
      .addSelect('p.user_id', 'userId')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere("p.status = 'activo'")
      .groupBy('p.id')
      .having('COUNT(a.id) = 0')
      .limit(50) // nunca devolver más que esto al admin
      .getRawMany();
    return {
      count: rows.length,
      samples: rows.slice(0, 5).map((r) => ({ id: r.id, title: r.title, userId: r.userId })),
    };
  }

  async completeAction(
    tenantId: string,
    actionId: string,
    actorId: string,
    actorRole: string,
  ) {
    const action = await this.actionRepo.findOne({ where: { id: actionId, tenantId } });
    if (!action) throw new NotFoundException('Acción no encontrada');

    // Idempotencia
    if (action.status === DevelopmentActionStatus.COMPLETADA) {
      return action;
    }

    // 1. Estado del plan
    const plan = await this.planRepo.findOne({ where: { id: action.planId, tenantId } });
    if (!plan) throw new NotFoundException('Plan de desarrollo no encontrado');
    if (plan.status === 'borrador') {
      throw new ConflictException(
        'El plan está en borrador. Debe ser activado por un manager o admin antes de poder completar acciones.',
      );
    }
    if (plan.status === 'cancelado') {
      throw new ConflictException('El plan fue cancelado; no se pueden completar acciones.');
    }
    if (plan.status === 'completado') {
      throw new ConflictException('El plan ya está completado; no se pueden modificar sus acciones.');
    }

    // 2. Permisos
    if (actorRole !== 'super_admin' && actorRole !== 'tenant_admin') {
      if (actorRole === 'employee') {
        if (plan.userId !== actorId) {
          throw new ForbiddenException('Solo puedes completar acciones de tu propio plan de desarrollo.');
        }
      } else if (actorRole === 'manager') {
        // Manager: only can complete actions of its direct reports
        const owner = await this.userRepo.findOne({
          where: { id: plan.userId, tenantId },
          select: ['id', 'managerId'],
        });
        if (!owner) throw new NotFoundException('Colaborador del plan no encontrado');
        if (owner.managerId !== actorId) {
          throw new ForbiddenException(
            'Solo puedes completar acciones de planes de tu equipo directo. El colaborador debería marcarla como completada él/ella mismo/a.',
          );
        }
      } else {
        throw new ForbiddenException('Rol no autorizado para completar acciones de desarrollo.');
      }
    }

    // 3. Marcar como completada
    action.status = DevelopmentActionStatus.COMPLETADA;
    action.completedAt = new Date();
    const saved = await this.actionRepo.save(action);
    // Pasa actionId para que recalculateProgress dispare los puntos de gamificación
    await this.recalculateProgress(action.planId, action.id);
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

  /**
   * Recalcula el progreso del plan y dispara gamificación:
   *   · Puntos al completar acción (+5)
   *   · Milestone notifications (50%, 75%, 100%)
   *   · Puntos al completar plan completo (+25)
   *   · Badge auto-check vía RecognitionService
   */
  private async recalculateProgress(planId: string, justCompletedActionId?: string) {
    const total = await this.actionRepo.count({ where: { planId } });
    const completed = await this.actionRepo.count({ where: { planId, status: DevelopmentActionStatus.COMPLETADA } });

    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) return;

    const previousProgress = plan.progress;
    plan.progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    const planJustCompleted = total > 0 && completed === total && plan.status === 'activo';

    if (planJustCompleted) {
      plan.status = 'completado';
      plan.completedAt = new Date();
    }

    await this.planRepo.save(plan);

    // ── Gamificación (fire-and-forget, no bloquea el flujo principal) ──

    // G1: Puntos al completar acción (+5)
    if (justCompletedActionId) {
      this.recognitionService.addPoints(
        plan.tenantId, plan.userId, 5, PointsSource.PDI_ACTION_COMPLETED,
        'Acción de desarrollo completada', justCompletedActionId,
      ).catch(() => {});
    }

    // G3: Milestone notifications (solo si el progreso cruzó el umbral)
    const milestones = [50, 75, 100];
    for (const m of milestones) {
      if (previousProgress < m && plan.progress >= m && m < 100) {
        this.notificationsService.create({
          tenantId: plan.tenantId,
          userId: plan.userId,
          type: 'general' as any,
          title: `🎯 ¡${m}% de tu PDI completado!`,
          message: `Tu plan "${plan.title}" alcanzó el ${m}% de progreso. ${m === 75 ? '¡Falta poco para terminar!' : '¡Buen avance, sigue así!'}`,
          metadata: { planId, progress: m, milestone: true },
        }).catch(() => {});
      }
    }

    // G2: Puntos + notificación al completar plan completo (+25)
    if (planJustCompleted) {
      this.recognitionService.addPoints(
        plan.tenantId, plan.userId, 25, PointsSource.PDI_PLAN_COMPLETED,
        `Plan de desarrollo "${plan.title}" completado`, planId,
      ).catch(() => {});

      this.notificationsService.create({
        tenantId: plan.tenantId,
        userId: plan.userId,
        type: 'general' as any,
        title: '🏆 ¡Plan de Desarrollo completado!',
        message: `Felicitaciones — completaste todas las acciones de tu plan "${plan.title}". Los puntos fueron sumados a tu perfil.`,
        metadata: { planId, progress: 100, planCompleted: true },
      }).catch(() => {});

      // Trigger auto-badge check (si hay badges configurados con criteria
      // que cuenten planes completados, se otorgarán automáticamente).
      this.recognitionService.checkAutoBadges(plan.tenantId, plan.userId).catch(() => {});
    }
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

  // ─── Export ────────────────────────────────────────────────────────────

  private escapeCsv(val: any): string {
    const str = String(val ?? '');
    return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
  }

  private async getExportPlans(tenantId: string, userId: string, role: string): Promise<any[]> {
    if (role === 'tenant_admin' || role === 'super_admin') return this.findAllPlans(tenantId);
    if (role === 'manager') return this.findPlansByManager(tenantId, userId);
    return this.findPlansByUser(tenantId, userId);
  }

  private readonly pdiStatusLabels: Record<string, string> = {
    borrador: 'Borrador', activo: 'Activo', pendiente_aprobacion: 'Pend. Aprobación',
    aprobado: 'Aprobado', en_revision: 'En Revisión', completado: 'Completado', cancelado: 'Cancelado',
  };

  async exportPlansCsv(tenantId: string, userId: string, role: string): Promise<string> {
    const plans = await this.getExportPlans(tenantId, userId, role);
    const rows: string[] = [];
    rows.push('Plan,Colaborador,Estado,Acciones Total,Acciones Completadas,Progreso %,Creado Por,Fecha Creación');
    for (const p of plans) {
      const userName = p.user ? `${p.user.firstName || ''} ${p.user.lastName || ''}`.trim() : '';
      const creatorName = p.creator ? `${p.creator.firstName || ''} ${p.creator.lastName || ''}`.trim() : '';
      const actions = p.actions || [];
      const completed = actions.filter((a: any) => a.status === 'completada').length;
      const progress = actions.length > 0 ? Math.round((completed / actions.length) * 100) : 0;
      rows.push([
        this.escapeCsv(p.title || 'Sin título'), this.escapeCsv(userName),
        this.pdiStatusLabels[p.status] || p.status, actions.length, completed, progress,
        this.escapeCsv(creatorName),
        p.createdAt ? new Date(p.createdAt).toLocaleDateString('es-CL') : '',
      ].join(','));
    }
    return '\uFEFF' + rows.join('\n');
  }

  async exportPlansXlsx(tenantId: string, userId: string, role: string): Promise<Buffer> {
    const plans = await this.getExportPlans(tenantId, userId, role);

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const accent = { argb: 'FFC9933A' };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const headerFill: any = { type: 'pattern', pattern: 'solid', fgColor: accent };

    // Sheet 1: Resumen
    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ width: 25 }, { width: 15 }];
    ws1.addRow(['Planes de Desarrollo (PDI)']).font = { bold: true, size: 14 };
    ws1.addRow([]);
    const total = plans.length;
    const activos = plans.filter((p: any) => p.status === 'activo').length;
    const completados = plans.filter((p: any) => p.status === 'completado').length;
    ws1.addRow(['Total planes', total]);
    ws1.addRow(['Activos', activos]);
    ws1.addRow(['Completados', completados]);
    ws1.addRow(['Fecha exportación', new Date().toLocaleDateString('es-CL')]);

    // Sheet 2: Planes
    const ws2 = wb.addWorksheet('Planes');
    ws2.columns = [
      { width: 30 }, { width: 22 }, { width: 16 }, { width: 10 },
      { width: 12 }, { width: 12 }, { width: 22 }, { width: 14 },
    ];
    const h2 = ws2.addRow(['Plan', 'Colaborador', 'Estado', 'Acciones', 'Completadas', 'Progreso %', 'Creado Por', 'Fecha']);
    h2.eachCell((cell) => { cell.font = headerFont; cell.fill = headerFill; });
    for (const p of plans) {
      const userName = p.user ? `${p.user.firstName || ''} ${p.user.lastName || ''}`.trim() : '';
      const creatorName = p.creator ? `${p.creator.firstName || ''} ${p.creator.lastName || ''}`.trim() : '';
      const actions = p.actions || [];
      const completed = actions.filter((a: any) => a.status === 'completada').length;
      const progress = actions.length > 0 ? Math.round((completed / actions.length) * 100) : 0;
      ws2.addRow([p.title || 'Sin título', userName, this.pdiStatusLabels[p.status] || p.status,
        actions.length, completed, progress, creatorName,
        p.createdAt ? new Date(p.createdAt).toLocaleDateString('es-CL') : '']);
    }

    // Sheet 3: Acciones
    const ws3 = wb.addWorksheet('Acciones');
    ws3.columns = [{ width: 30 }, { width: 30 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 20 }];
    const h3 = ws3.addRow(['Plan', 'Acción', 'Tipo', 'Estado', 'Vencimiento', 'Competencia']);
    h3.eachCell((cell) => { cell.font = headerFont; cell.fill = headerFill; });
    for (const p of plans) {
      for (const a of (p.actions || [])) {
        ws3.addRow([
          p.title || 'Sin título', a.title || a.description || '',
          a.actionType || a.type || '', a.status || '',
          a.dueDate ? new Date(a.dueDate).toLocaleDateString('es-CL') : '',
          a.competency?.name || '',
        ]);
      }
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async exportPlansPdf(tenantId: string, userId: string, role: string): Promise<Buffer> {
    const plans = await this.getExportPlans(tenantId, userId, role);

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
    doc.text('Planes de Desarrollo (PDI)', margin, 16);
    doc.setFontSize(9);
    doc.setTextColor(201, 147, 58);
    doc.text(`${plans.length} planes — ${new Date().toLocaleDateString('es-CL')}`, margin, 24);

    let y = 38;

    // KPIs
    const activos = plans.filter((p: any) => p.status === 'activo').length;
    const completados = plans.filter((p: any) => p.status === 'completado').length;
    const kpis = [
      { label: 'Total', value: `${plans.length}` },
      { label: 'Activos', value: `${activos}` },
      { label: 'Completados', value: `${completados}` },
    ];
    const kpiW = (pageW - 2 * margin - 2 * 4) / 3;
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
      head: [['Plan', 'Colaborador', 'Estado', 'Acciones', 'Progreso', 'Creado Por']],
      body: plans.map((p: any) => {
        const userName = p.user ? `${p.user.firstName || ''} ${p.user.lastName || ''}`.trim() : '';
        const creatorName = p.creator ? `${p.creator.firstName || ''} ${p.creator.lastName || ''}`.trim() : '';
        const actions = p.actions || [];
        const completed = actions.filter((a: any) => a.status === 'completada').length;
        const progress = actions.length > 0 ? Math.round((completed / actions.length) * 100) : 0;
        return [p.title || 'Sin título', userName, this.pdiStatusLabels[p.status] || p.status,
          `${completed}/${actions.length}`, `${progress}%`, creatorName];
      }),
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
}
