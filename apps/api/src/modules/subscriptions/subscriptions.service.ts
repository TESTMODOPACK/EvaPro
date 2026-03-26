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
import { PaymentHistory, BillingPeriod, PaymentStatus } from './entities/payment-history.entity';
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
    @InjectRepository(PaymentHistory)
    private readonly paymentRepo: Repository<PaymentHistory>,
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
    if (dto.quarterlyPrice !== undefined) plan.quarterlyPrice = dto.quarterlyPrice;
    if (dto.semiannualPrice !== undefined) plan.semiannualPrice = dto.semiannualPrice;
    if (dto.yearlyPrice !== undefined) plan.yearlyPrice = dto.yearlyPrice;
    if (dto.currency !== undefined) plan.currency = dto.currency;
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

    const billingPeriod = dto.billingPeriod || BillingPeriod.MONTHLY;
    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const nextBillingDate = dto.nextBillingDate
      ? new Date(dto.nextBillingDate)
      : this.calculateNextBillingDate(startDate, billingPeriod);

    const sub = this.subRepo.create({
      tenantId: dto.tenantId,
      planId: dto.planId,
      status: dto.status || 'active',
      billingPeriod,
      startDate,
      endDate: dto.endDate || null,
      nextBillingDate,
      autoRenew: dto.autoRenew ?? true,
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
    if (dto.billingPeriod !== undefined) sub.billingPeriod = dto.billingPeriod;
    if (dto.autoRenew !== undefined) sub.autoRenew = dto.autoRenew;
    if (dto.nextBillingDate !== undefined) sub.nextBillingDate = dto.nextBillingDate;
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

  // ─── Payment History ──────────────────────────────────────────────────

  async registerPayment(subscriptionId: string, dto: any, changedBy?: string): Promise<PaymentHistory> {
    const sub = await this.findById(subscriptionId);

    const payment = this.paymentRepo.create({
      tenantId: sub.tenantId,
      subscriptionId: sub.id,
      amount: dto.amount,
      currency: dto.currency || sub.plan?.currency || 'UF',
      billingPeriod: dto.billingPeriod || sub.billingPeriod || BillingPeriod.MONTHLY,
      periodStart: new Date(dto.periodStart),
      periodEnd: new Date(dto.periodEnd),
      status: dto.status || PaymentStatus.PAID,
      paymentMethod: dto.paymentMethod || null,
      transactionRef: dto.transactionRef || null,
      notes: dto.notes || null,
      paidAt: dto.status === PaymentStatus.PAID ? (dto.paidAt ? new Date(dto.paidAt) : new Date()) : null,
    });
    const saved = await this.paymentRepo.save(payment);

    // Update subscription billing info
    if (saved.status === PaymentStatus.PAID) {
      sub.lastPaymentDate = saved.paidAt || new Date();
      sub.lastPaymentAmount = saved.amount;
      sub.nextBillingDate = this.calculateNextBillingDate(
        new Date(saved.periodEnd),
        sub.billingPeriod || BillingPeriod.MONTHLY,
      );
      // Reactivate if was suspended/expired
      if (sub.status === 'suspended' || sub.status === 'expired') {
        sub.status = 'active';
      }
      await this.subRepo.save(sub);
    }

    if (changedBy) {
      await this.auditService.log(
        sub.tenantId, changedBy, 'payment.registered', 'payment', saved.id,
        { amount: saved.amount, currency: saved.currency, status: saved.status },
      );
    }

    return saved;
  }

  async getPaymentHistory(tenantId: string): Promise<PaymentHistory[]> {
    return this.paymentRepo.find({
      where: { tenantId },
      relations: ['subscription'],
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async getPaymentsBySubscription(subscriptionId: string): Promise<PaymentHistory[]> {
    return this.paymentRepo.find({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
    });
  }

  async getUpcomingRenewals(daysAhead: number): Promise<Subscription[]> {
    const target = new Date();
    target.setDate(target.getDate() + daysAhead);

    return this.subRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.plan', 'p')
      .leftJoinAndSelect('s.tenant', 't')
      .where('s.status IN (:...statuses)', { statuses: ['active', 'trial'] })
      .andWhere('(s.next_billing_date <= :target OR s.end_date <= :target)', { target })
      .andWhere('(s.next_billing_date >= :now OR s.end_date >= :now)', { now: new Date() })
      .getMany();
  }

  async calculatePriceForPeriod(planId: string, period: BillingPeriod): Promise<any> {
    const plan = await this.findPlanById(planId);
    const monthly = Number(plan.monthlyPrice);

    const pricing = {
      monthly: { price: monthly, discount: 0, savings: 0, period: 1 },
      quarterly: {
        price: plan.quarterlyPrice ? Number(plan.quarterlyPrice) : Math.round(monthly * 3 * 0.90 * 100) / 100,
        discount: 10,
        savings: Math.round(monthly * 3 * 0.10 * 100) / 100,
        period: 3,
      },
      semiannual: {
        price: plan.semiannualPrice ? Number(plan.semiannualPrice) : Math.round(monthly * 6 * 0.85 * 100) / 100,
        discount: 15,
        savings: Math.round(monthly * 6 * 0.15 * 100) / 100,
        period: 6,
      },
      annual: {
        price: plan.yearlyPrice ? Number(plan.yearlyPrice) : Math.round(monthly * 12 * 0.80 * 100) / 100,
        discount: 20,
        savings: Math.round(monthly * 12 * 0.20 * 100) / 100,
        period: 12,
      },
    };

    return {
      planId: plan.id,
      planName: plan.name,
      currency: plan.currency,
      monthlyBase: monthly,
      pricing,
      selected: pricing[period] || pricing.monthly,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private calculateNextBillingDate(from: Date, period: BillingPeriod): Date {
    const next = new Date(from);
    switch (period) {
      case BillingPeriod.MONTHLY: next.setMonth(next.getMonth() + 1); break;
      case BillingPeriod.QUARTERLY: next.setMonth(next.getMonth() + 3); break;
      case BillingPeriod.SEMIANNUAL: next.setMonth(next.getMonth() + 6); break;
      case BillingPeriod.ANNUAL: next.setFullYear(next.getFullYear() + 1); break;
    }
    return next;
  }

  private async syncTenantPlan(tenantId: string, plan: SubscriptionPlan): Promise<void> {
    await this.tenantRepo.update(tenantId, {
      plan: plan.code,
      maxEmployees: plan.maxEmployees,
    });
  }
}
