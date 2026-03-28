import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrgDevelopmentPlan } from './entities/org-development-plan.entity';
import { OrgDevelopmentInitiative } from './entities/org-development-initiative.entity';
import { OrgDevelopmentAction } from './entities/org-development-action.entity';
import { DevelopmentPlan } from '../development/entities/development-plan.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class OrgDevelopmentService {
  constructor(
    @InjectRepository(OrgDevelopmentPlan)
    private readonly planRepo: Repository<OrgDevelopmentPlan>,
    @InjectRepository(OrgDevelopmentInitiative)
    private readonly initiativeRepo: Repository<OrgDevelopmentInitiative>,
    @InjectRepository(OrgDevelopmentAction)
    private readonly actionRepo: Repository<OrgDevelopmentAction>,
    @InjectRepository(DevelopmentPlan)
    private readonly pdiRepo: Repository<DevelopmentPlan>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ─── Planes ──────────────────────────────────────────────────────────────

  async findAllPlans(tenantId: string): Promise<OrgDevelopmentPlan[]> {
    const plans = await this.planRepo.find({
      where: { tenantId },
      relations: ['creator', 'initiatives'],
      order: { year: 'DESC', createdAt: 'DESC' },
    });
    return plans;
  }

  async createPlan(
    tenantId: string,
    createdBy: string,
    dto: { title: string; description?: string; year: number },
  ): Promise<OrgDevelopmentPlan> {
    const plan = this.planRepo.create({
      tenantId,
      createdBy,
      title: dto.title,
      description: dto.description ?? null,
      year: dto.year,
    });
    return this.planRepo.save(plan);
  }

  async updatePlan(
    tenantId: string,
    id: string,
    dto: { title?: string; description?: string; year?: number; status?: string },
  ): Promise<OrgDevelopmentPlan> {
    const plan = await this.planRepo.findOne({ where: { id, tenantId } });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    if (dto.title !== undefined) plan.title = dto.title;
    if (dto.description !== undefined) plan.description = dto.description ?? null;
    if (dto.year !== undefined) plan.year = dto.year;
    if (dto.status !== undefined) plan.status = dto.status;
    return this.planRepo.save(plan);
  }

  async deletePlan(tenantId: string, id: string): Promise<void> {
    const plan = await this.planRepo.findOne({
      where: { id, tenantId },
      relations: ['initiatives'],
    });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    const activeCount = plan.initiatives?.filter(
      (i) => i.status === 'en_curso',
    ).length ?? 0;
    if (activeCount > 0) {
      throw new BadRequestException(
        'No se puede eliminar un plan con iniciativas en curso',
      );
    }
    await this.planRepo.remove(plan);
  }

  // ─── Iniciativas ─────────────────────────────────────────────────────────

  async findInitiativesByPlan(
    tenantId: string,
    planId: string,
  ): Promise<OrgDevelopmentInitiative[]> {
    const plan = await this.planRepo.findOne({ where: { id: planId, tenantId } });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    return this.initiativeRepo.find({
      where: { tenantId, planId },
      relations: ['responsible', 'actions', 'actions.assignedTo'],
      order: { department: 'ASC', createdAt: 'ASC' },
    });
  }

  /**
   * Devuelve iniciativas activas para el dropdown en formularios PDI.
   * Si se pasa `userId` (y no es admin), busca el departamento del usuario y filtra
   * iniciativas de ese departamento + las de toda la empresa (department = null).
   */
  async findActiveInitiatives(
    tenantId: string,
    options: { department?: string; userId?: string } = {},
  ): Promise<any[]> {
    let department = options.department;

    // Si no viene departamento pero sí userId, buscarlo en BD
    if (!department && options.userId) {
      const user = await this.userRepo.findOne({
        where: { id: options.userId, tenantId },
        select: ['department'],
      });
      department = user?.department ?? undefined;
    }

    const qb = this.initiativeRepo
      .createQueryBuilder('ini')
      .leftJoinAndSelect('ini.plan', 'plan')
      // BUG #1 fix: usar camelCase (propiedad de entidad), no snake_case
      .where('ini.tenantId = :tenantId', { tenantId })
      // BUG #2 fix: parametrizar en lugar de SQL literal
      .andWhere('plan.status IN (:...planStatuses)', { planStatuses: ['activo', 'borrador'] })
      .andWhere('ini.status IN (:...iniStatuses)', { iniStatuses: ['pendiente', 'en_curso'] })
      .orderBy('plan.year', 'DESC')
      .addOrderBy('ini.department', 'ASC');

    if (department) {
      qb.andWhere(
        '(ini.department = :dept OR ini.department IS NULL)',
        { dept: department },
      );
    }

    const results = await qb.getMany();
    // BUG #9 fix: quitar casts `as any` — la relación plan está tipada correctamente
    return results.map((i) => ({
      id: i.id,
      title: i.title,
      department: i.department,
      planTitle: i.plan?.title ?? '',
      planYear: i.plan?.year ?? null,
    }));
  }

  async createInitiative(
    tenantId: string,
    planId: string,
    dto: {
      title: string;
      description?: string;
      department?: string | null;
      targetDate?: string | null;
      responsibleId?: string | null;
      budget?: number | null;
      currency?: string;
    },
  ): Promise<OrgDevelopmentInitiative> {
    const plan = await this.planRepo.findOne({ where: { id: planId, tenantId } });
    if (!plan) throw new NotFoundException('Plan no encontrado');

    const initiative = this.initiativeRepo.create({
      tenantId,
      planId,
      title: dto.title,
      description: dto.description ?? null,
      department: dto.department ?? null,
      targetDate: dto.targetDate ?? null,
      responsibleId: dto.responsibleId ?? null,
      budget: dto.budget ?? null,
      currency: dto.currency ?? 'UF',
    });
    return this.initiativeRepo.save(initiative);
  }

  async updateInitiative(
    tenantId: string,
    id: string,
    dto: {
      title?: string;
      description?: string | null;
      department?: string | null;
      status?: string;
      targetDate?: string | null;
      responsibleId?: string | null;
      progress?: number;
      budget?: number | null;
      currency?: string;
    },
  ): Promise<OrgDevelopmentInitiative> {
    const ini = await this.initiativeRepo.findOne({ where: { id, tenantId } });
    if (!ini) throw new NotFoundException('Iniciativa no encontrada');

    if (dto.title !== undefined) ini.title = dto.title;
    if (dto.description !== undefined) ini.description = dto.description ?? null;
    if (dto.department !== undefined) ini.department = dto.department ?? null;
    if (dto.status !== undefined) ini.status = dto.status;
    if (dto.targetDate !== undefined) ini.targetDate = dto.targetDate ?? null;
    if (dto.responsibleId !== undefined) ini.responsibleId = dto.responsibleId ?? null;
    if (dto.progress !== undefined) ini.progress = Math.min(100, Math.max(0, dto.progress));
    if (dto.budget !== undefined) ini.budget = dto.budget ?? null;
    if (dto.currency !== undefined) ini.currency = dto.currency;

    return this.initiativeRepo.save(ini);
  }

  async deleteInitiative(tenantId: string, id: string): Promise<void> {
    const ini = await this.initiativeRepo.findOne({ where: { id, tenantId } });
    if (!ini) throw new NotFoundException('Iniciativa no encontrada');
    await this.initiativeRepo.remove(ini);
  }

  // ─── Acciones de iniciativa ───────────────────────────────────────────────

  async addAction(
    tenantId: string,
    initiativeId: string,
    dto: {
      title: string;
      actionType?: string;
      dueDate?: string | null;
      assignedToId?: string | null;
      notes?: string | null;
    },
  ): Promise<OrgDevelopmentAction> {
    const ini = await this.initiativeRepo.findOne({
      where: { id: initiativeId, tenantId },
    });
    if (!ini) throw new NotFoundException('Iniciativa no encontrada');

    const action = this.actionRepo.create({
      tenantId,
      initiativeId,
      title: dto.title,
      actionType: dto.actionType ?? 'otro',
      dueDate: dto.dueDate ?? null,
      assignedToId: dto.assignedToId ?? null,
      notes: dto.notes ?? null,
    });
    return this.actionRepo.save(action);
  }

  async updateAction(
    tenantId: string,
    actionId: string,
    dto: {
      title?: string;
      actionType?: string;
      status?: string;
      dueDate?: string | null;
      assignedToId?: string | null;
      notes?: string | null;
    },
  ): Promise<OrgDevelopmentAction> {
    const action = await this.actionRepo.findOne({
      where: { id: actionId, tenantId },
    });
    if (!action) throw new NotFoundException('Acción no encontrada');

    if (dto.title !== undefined) action.title = dto.title;
    if (dto.actionType !== undefined) action.actionType = dto.actionType;
    if (dto.status !== undefined) action.status = dto.status;
    if (dto.dueDate !== undefined) action.dueDate = dto.dueDate ?? null;
    if (dto.assignedToId !== undefined) action.assignedToId = dto.assignedToId ?? null;
    if (dto.notes !== undefined) action.notes = dto.notes ?? null;

    return this.actionRepo.save(action);
  }

  async deleteAction(tenantId: string, actionId: string): Promise<void> {
    const action = await this.actionRepo.findOne({
      where: { id: actionId, tenantId },
    });
    if (!action) throw new NotFoundException('Acción no encontrada');
    await this.actionRepo.remove(action);
  }

  // ─── Trazabilidad ─────────────────────────────────────────────────────────

  async getLinkedPdis(tenantId: string, initiativeId: string): Promise<any[]> {
    // BUG #3 fix: quitar `as any` — orgInitiativeId ya está definido en la entidad
    const pdis = await this.pdiRepo.find({
      where: { tenantId, orgInitiativeId: initiativeId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
    return pdis.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      progress: p.progress,
      userName: p.user ? `${p.user.firstName} ${p.user.lastName}` : '',
    }));
  }
}
