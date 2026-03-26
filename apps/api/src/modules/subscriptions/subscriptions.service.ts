import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Subscription } from './entities/subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(SubscriptionPlan)
    private readonly planRepo: Repository<SubscriptionPlan>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly auditService: AuditService,
  ) {}

  // ─── Plans CRUD ────────────────────────────────────────────────────────

  async createPlan(dto: any): Promise<SubscriptionPlan> {
    const existing = await this.planRepo.findOne({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Ya existe un plan con ese código');

    const plan = this.planRepo.create({
      name: dto.name,
      code: dto.code,
      description: dto.description || null,
      maxEmployees: dto.maxEmployees ?? 50,
      monthlyPrice: dto.monthlyPrice ?? 0,
      yearlyPrice: dto.yearlyPrice ?? null,
      features: dto.features || [],
      isActive: true,
      displayOrder: dto.displayOrder ?? 0,
    });
    return this.planRepo.save(plan);
  }

  async findAllPlans(): Promise<SubscriptionPlan[]> {
    return this.planRepo.find({ order: { displayOrder: 'ASC', name: 'ASC' } });
  }

  async findPlanById(id: string): Promise<SubscriptionPlan> {
    const plan = await this.planRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    return plan;
  }

  async updatePlan(id: string, dto: any): Promise<SubscriptionPlan> {
    const plan = await this.findPlanById(id);
    if (dto.name !== undefined) plan.name = dto.name;
    if (dto.description !== undefined) plan.description = dto.description;
    if (dto.maxEmployees !== undefined) plan.maxEmployees = dto.maxEmployees;
    if (dto.monthlyPrice !== undefined) plan.monthlyPrice = dto.monthlyPrice;
    if (dto.yearlyPrice !== undefined) plan.yearlyPrice = dto.yearlyPrice;
    if (dto.features !== undefined) plan.features = dto.features;
    if (dto.isActive !== undefined) plan.isActive = dto.isActive;
    if (dto.displayOrder !== undefined) plan.displayOrder = dto.displayOrder;
    return this.planRepo.save(plan);
  }

  async deactivatePlan(id: string): Promise<void> {
    const plan = await this.findPlanById(id);
    plan.isActive = false;
    await this.planRepo.save(plan);
  }

  // ─── Subscriptions CRUD ────────────────────────────────────────────────

  async create(dto: any, changedBy?: string): Promise<Subscription> {
    const plan = await this.findPlanById(dto.planId);

    const sub = this.subRepo.create({
      tenantId: dto.tenantId,
      planId: dto.planId,
      status: dto.status || 'active',
      startDate: dto.startDate || new Date(),
      endDate: dto.endDate || null,
      trialEndsAt: dto.trialEndsAt || null,
      notes: dto.notes || null,
    });
    const saved = await this.subRepo.save(sub);

    // Sync tenant plan & maxEmployees
    await this.syncTenantPlan(dto.tenantId, plan);

    // Audit log
    if (changedBy) {
      await this.auditService.log(
        dto.tenantId, changedBy, 'subscription.created', 'subscription', saved.id,
        { planCode: plan.code, planName: plan.name, status: sub.status },
      );
    }

    return this.findById(saved.id);
  }

  async findAll(): Promise<Subscription[]> {
    return this.subRepo.find({
      relations: ['tenant', 'plan'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<Subscription> {
    const sub = await this.subRepo.findOne({
      where: { id },
      relations: ['tenant', 'plan'],
    });
    if (!sub) throw new NotFoundException('Suscripción no encontrada');
    return sub;
  }

  /**
   * Find active or trial subscription for a tenant.
   * Also checks for trial expiration and auto-expires if needed.
   */
  async findByTenantId(tenantId: string): Promise<Subscription | null> {
    const sub = await this.subRepo.findOne({
      where: { tenantId, status: In(['active', 'trial']) },
      relations: ['plan', 'tenant'],
    });

    if (!sub) return null;

    // Auto-expire trial if past trialEndsAt
    if (sub.status === 'trial' && sub.trialEndsAt) {
      const now = new Date();
      const trialEnd = new Date(sub.trialEndsAt);
      if (now > trialEnd) {
        this.logger.warn(`Trial expired for tenant ${tenantId} — auto-expiring subscription ${sub.id}`);
        sub.status = 'expired';
        await this.subRepo.save(sub);
        return null;
      }
    }

    return sub;
  }

  async findMySubscription(tenantId: string): Promise<any> {
    const sub = await this.subRepo.findOne({
      where: { tenantId },
      relations: ['plan'],
      order: { createdAt: 'DESC' },
    });
    return sub;
  }

  /**
   * Update subscription with downgrade protection and audit logging.
   */
  async update(id: string, dto: any, changedBy?: string): Promise<Subscription> {
    const sub = await this.findById(id);
    const previousPlanId = sub.planId;
    const previousStatus = sub.status;

    if (dto.planId !== undefined && dto.planId !== sub.planId) {
      const newPlan = await this.findPlanById(dto.planId);

      // ── Downgrade protection: check if current users exceed new plan limit
      const currentUsers = await this.userRepo.count({
        where: { tenantId: sub.tenantId, isActive: true },
      });

      if (currentUsers > newPlan.maxEmployees) {
        const oldPlan = sub.plan;
        throw new ForbiddenException(
          `No se puede cambiar al plan "${newPlan.name}" (máx. ${newPlan.maxEmployees} usuarios). ` +
          `La organización tiene ${currentUsers} usuarios activos. ` +
          `Desactive usuarios hasta tener ${newPlan.maxEmployees} o menos antes de hacer downgrade.`,
        );
      }

      sub.planId = dto.planId;
      await this.syncTenantPlan(sub.tenantId, newPlan);

      // Audit plan change
      if (changedBy) {
        const oldPlan = previousPlanId ? await this.planRepo.findOne({ where: { id: previousPlanId } }) : null;
        await this.auditService.log(
          sub.tenantId, changedBy, 'subscription.plan_changed', 'subscription', sub.id,
          {
            previousPlan: oldPlan?.code || 'none',
            previousPlanName: oldPlan?.name || 'none',
            newPlan: newPlan.code,
            newPlanName: newPlan.name,
            currentUsers,
            newMaxEmployees: newPlan.maxEmployees,
          },
        );
      }
    }

    if (dto.status !== undefined) sub.status = dto.status;
    if (dto.startDate !== undefined) sub.startDate = dto.startDate;
    if (dto.endDate !== undefined) sub.endDate = dto.endDate;
    if (dto.trialEndsAt !== undefined) sub.trialEndsAt = dto.trialEndsAt;
    if (dto.notes !== undefined) sub.notes = dto.notes;

    await this.subRepo.save(sub);

    // Audit status change
    if (changedBy && dto.status !== undefined && dto.status !== previousStatus) {
      await this.auditService.log(
        sub.tenantId, changedBy, 'subscription.status_changed', 'subscription', sub.id,
        { previousStatus, newStatus: dto.status },
      );
    }

    return this.findById(id);
  }

  async cancel(id: string, changedBy?: string): Promise<void> {
    const sub = await this.findById(id);
    const previousStatus = sub.status;
    sub.status = 'cancelled';
    await this.subRepo.save(sub);

    if (changedBy) {
      await this.auditService.log(
        sub.tenantId, changedBy, 'subscription.cancelled', 'subscription', sub.id,
        { previousStatus },
      );
    }
  }

  async getStats(): Promise<any> {
    const total = await this.subRepo.count();
    const active = await this.subRepo.count({ where: { status: 'active' } });
    const trial = await this.subRepo.count({ where: { status: 'trial' } });
    const suspended = await this.subRepo.count({ where: { status: 'suspended' } });
    const cancelled = await this.subRepo.count({ where: { status: 'cancelled' } });
    const expired = await this.subRepo.count({ where: { status: 'expired' } });

    const byPlan = await this.subRepo
      .createQueryBuilder('s')
      .leftJoin('s.plan', 'p')
      .select('p.name', 'plan')
      .addSelect('COUNT(s.id)', 'count')
      .groupBy('p.name')
      .getRawMany();

    return { total, active, trial, suspended, cancelled, expired, byPlan };
  }

  // ─── Trial Expiration Check (called by cron) ────────────────────────────

  async expireTrials(): Promise<number> {
    const now = new Date();
    const expiredTrials = await this.subRepo
      .createQueryBuilder()
      .update(Subscription)
      .set({ status: 'expired' })
      .where('status = :status', { status: 'trial' })
      .andWhere('trial_ends_at IS NOT NULL')
      .andWhere('trial_ends_at < :now', { now })
      .execute();

    const count = expiredTrials.affected || 0;
    if (count > 0) {
      this.logger.log(`Auto-expired ${count} trial subscriptions`);
    }
    return count;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private async syncTenantPlan(tenantId: string, plan: SubscriptionPlan): Promise<void> {
    await this.tenantRepo.update(tenantId, {
      plan: plan.code,
      maxEmployees: plan.maxEmployees,
    });
  }
}
