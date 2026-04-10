import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Subscription, SubscriptionStatus, SUBSCRIPTION_STATUS_VALUES } from './entities/subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { SubscriptionRequest } from './entities/subscription-request.entity';
import { PaymentHistory, BillingPeriod, PaymentStatus } from './entities/payment-history.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { EvaluationCycle, CycleType, CycleStatus } from '../evaluations/entities/evaluation-cycle.entity';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { PlanFeature } from '../../common/constants/plan-features';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(SubscriptionPlan)
    private readonly planRepo: Repository<SubscriptionPlan>,
    @InjectRepository(SubscriptionRequest)
    private readonly requestRepo: Repository<SubscriptionRequest>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(PaymentHistory)
    private readonly paymentRepo: Repository<PaymentHistory>,
    @InjectRepository(EvaluationCycle)
    private readonly cycleRepo: Repository<EvaluationCycle>,
    private readonly auditService: AuditService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
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
      quarterlyPrice: dto.quarterlyPrice ?? null,
      semiannualPrice: dto.semiannualPrice ?? null,
      yearlyPrice: dto.yearlyPrice ?? null,
      currency: dto.currency || 'UF',
      features: dto.features || [],
      maxAiCallsPerMonth: dto.maxAiCallsPerMonth ?? 0,
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
    if (dto.maxAiCallsPerMonth !== undefined) plan.maxAiCallsPerMonth = dto.maxAiCallsPerMonth;
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

    // Cancel any existing active/trial subscriptions for this tenant before creating the new one
    const previousSubs = await this.subRepo.find({
      where: { tenantId: dto.tenantId, status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]) },
    });
    for (const prev of previousSubs) {
      prev.status = SubscriptionStatus.CANCELLED;
      prev.endDate = new Date();
      await this.subRepo.save(prev);
      if (changedBy) {
        await this.auditService.log(
          dto.tenantId, changedBy, 'subscription.cancelled', 'subscription', prev.id,
          { reason: 'Reemplazada por nueva suscripción', replacedByPlan: plan.code },
        );
      }
    }

    const billingPeriod = dto.billingPeriod || BillingPeriod.MONTHLY;
    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const nextBillingDate = dto.nextBillingDate
      ? new Date(dto.nextBillingDate)
      : this.calculateNextBillingDate(startDate, billingPeriod);

    const sub = this.subRepo.create({
      tenantId: dto.tenantId,
      planId: dto.planId,
      status: dto.status || SubscriptionStatus.ACTIVE,
      billingPeriod,
      startDate,
      endDate: dto.endDate || nextBillingDate,
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
    // Always return the newest active/trial subscription (order by createdAt DESC)
    const activeSubs = await this.subRepo.find({
      where: { tenantId, status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]) },
      relations: ['plan', 'tenant'],
      order: { createdAt: 'DESC' },
    });

    // Auto-cancel stale duplicates — keep only the newest active one
    if (activeSubs.length > 1) {
      for (const stale of activeSubs.slice(1)) {
        stale.status = SubscriptionStatus.CANCELLED;
        stale.endDate = new Date();
        await this.subRepo.save(stale);
        this.logger.warn(`[findByTenantId] Auto-cancelled stale subscription ${stale.id} (plan: ${stale.plan?.name}) for tenant ${tenantId}`);
      }
    }

    const sub = activeSubs[0] ?? null;
    if (!sub) return null;

    // Auto-expire trial if past trialEndsAt
    if (sub.status === SubscriptionStatus.TRIAL && sub.trialEndsAt) {
      const now = new Date();
      const trialEnd = new Date(sub.trialEndsAt);
      if (now > trialEnd) {
        this.logger.warn(`Trial expired for tenant ${tenantId} — auto-expiring subscription ${sub.id}`);
        sub.status = SubscriptionStatus.EXPIRED;
        await this.subRepo.save(sub);
        return null;
      }
    }

    return sub;
  }

  async findMySubscription(tenantId: string): Promise<any> {
    // Prefer active/trial, fallback to most recent
    let sub = await this.subRepo.findOne({
      where: { tenantId, status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]) },
      relations: ['plan', 'tenant'],
      order: { createdAt: 'DESC' },
    });
    if (!sub) {
      sub = await this.subRepo.findOne({
        where: { tenantId },
        relations: ['plan', 'tenant'],
        order: { createdAt: 'DESC' },
      });
    }
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
        throw new ForbiddenException(
          `No se puede cambiar al plan "${newPlan.name}" (máx. ${newPlan.maxEmployees} usuarios). ` +
          `La organización tiene ${currentUsers} usuarios activos. ` +
          `Desactive usuarios hasta tener ${newPlan.maxEmployees} o menos antes de hacer downgrade.`,
        );
      }

      // ── Feature-in-use protection: check active cycles using premium features
      const currentPlan = sub.plan;
      if (currentPlan) {
        const currentFeatures: string[] = currentPlan.features || [];
        const newFeatures: string[] = newPlan.features || [];
        const lostFeatures = currentFeatures.filter((f) => !newFeatures.includes(f));

        if (lostFeatures.length > 0) {
          // Check active evaluation cycles that use features being removed
          const activeCycles = await this.cycleRepo.find({
            where: { tenantId: sub.tenantId, status: CycleStatus.ACTIVE },
          });

          const conflicts: string[] = [];

          for (const cycle of activeCycles) {
            if (cycle.type === CycleType.DEGREE_360 && lostFeatures.includes(PlanFeature.EVAL_360)) {
              conflicts.push(`Ciclo 360° activo: "${cycle.name}"`);
            }
            if (cycle.type === CycleType.DEGREE_270 && lostFeatures.includes(PlanFeature.EVAL_270)) {
              conflicts.push(`Ciclo 270° activo: "${cycle.name}"`);
            }
          }

          if (conflicts.length > 0) {
            throw new ForbiddenException(
              `No se puede cambiar al plan "${newPlan.name}" porque hay ciclos activos que usan funcionalidades no disponibles en ese plan:\n` +
              conflicts.map((c) => `  • ${c}`).join('\n') +
              `\n\nCierre o archive estos ciclos antes de hacer el downgrade.`,
            );
          }
        }
      }

      // Directly update plan_id column — avoids TypeORM relation-cache override
      await this.subRepo.update(id, { planId: dto.planId });
      sub.planId = dto.planId;
      (sub as any).plan = newPlan; // keep in-memory object consistent
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

    if (dto.status !== undefined) {
      if (!SUBSCRIPTION_STATUS_VALUES.includes(dto.status)) {
        throw new BadRequestException(
          `Estado de suscripción inválido. Permitidos: ${SUBSCRIPTION_STATUS_VALUES.join(', ')}`,
        );
      }
      sub.status = dto.status;
    }
    if (dto.trialEndsAt !== undefined) sub.trialEndsAt = dto.trialEndsAt;
    if (dto.autoRenew !== undefined) sub.autoRenew = dto.autoRenew;
    if (dto.notes !== undefined) sub.notes = dto.notes;

    // Recalculate billing dates when plan or billing period changes
    const planChanged = dto.planId !== undefined;
    const periodChanged = dto.billingPeriod !== undefined && dto.billingPeriod !== sub.billingPeriod;

    if (dto.billingPeriod !== undefined) sub.billingPeriod = dto.billingPeriod;

    if ((planChanged || periodChanged) && !dto.startDate && !dto.nextBillingDate) {
      // Auto-recalculate: reset start to today and calculate new next billing date
      const today = new Date();
      sub.startDate = today;
      sub.nextBillingDate = this.calculateNextBillingDate(today, sub.billingPeriod as BillingPeriod);
      sub.endDate = null;
    } else {
      if (dto.startDate !== undefined) sub.startDate = dto.startDate;
      if (dto.endDate !== undefined) sub.endDate = dto.endDate;
      if (dto.nextBillingDate !== undefined) sub.nextBillingDate = dto.nextBillingDate;
    }

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
    sub.status = SubscriptionStatus.CANCELLED;
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
    const active = await this.subRepo.count({ where: { status: SubscriptionStatus.ACTIVE } });
    const trial = await this.subRepo.count({ where: { status: SubscriptionStatus.TRIAL } });
    const suspended = await this.subRepo.count({ where: { status: SubscriptionStatus.SUSPENDED } });
    const cancelled = await this.subRepo.count({ where: { status: SubscriptionStatus.CANCELLED } });
    const expired = await this.subRepo.count({ where: { status: SubscriptionStatus.EXPIRED } });

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
      .set({ status: SubscriptionStatus.EXPIRED })
      .where('status = :status', { status: SubscriptionStatus.TRIAL })
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

    // Validate required fields
    if (dto.amount == null || isNaN(Number(dto.amount))) {
      throw new BadRequestException('El campo "amount" es requerido y debe ser numérico');
    }
    if (!dto.periodStart || !dto.periodEnd) {
      throw new BadRequestException('Los campos "periodStart" y "periodEnd" son requeridos');
    }
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
      throw new BadRequestException('Las fechas "periodStart" y "periodEnd" deben ser válidas');
    }
    if (periodEnd < periodStart) {
      throw new BadRequestException('La fecha fin del período debe ser igual o posterior a la fecha inicio');
    }

    // Guard: cannot register payment on cancelled subscription
    if (sub.status === SubscriptionStatus.CANCELLED) {
      throw new ForbiddenException('No se puede registrar un pago en una suscripción cancelada. Reactive la suscripción primero.');
    }

    const payment = this.paymentRepo.create({
      tenantId: sub.tenantId,
      subscriptionId: sub.id,
      amount: Number(dto.amount),
      currency: dto.currency || sub.plan?.currency || 'UF',
      billingPeriod: dto.billingPeriod || sub.billingPeriod || BillingPeriod.MONTHLY,
      periodStart,
      periodEnd,
      status: dto.status || PaymentStatus.PAID,
      paymentMethod: dto.paymentMethod || null,
      transactionRef: dto.transactionRef || null,
      notes: dto.notes || null,
      paidAt: (dto.status || PaymentStatus.PAID) === PaymentStatus.PAID
        ? (dto.paidAt ? new Date(dto.paidAt) : new Date())
        : null,
    });
    const saved = await this.paymentRepo.save(payment);

    // Update subscription billing info
    if (saved.status === PaymentStatus.PAID) {
      sub.lastPaymentDate = saved.paidAt || new Date();
      sub.lastPaymentAmount = Number(saved.amount);

      // Calculate next billing date, ensuring it's never in the past
      let nextBilling = this.calculateNextBillingDate(
        periodEnd,
        sub.billingPeriod || BillingPeriod.MONTHLY,
      );
      const now = new Date();
      while (nextBilling < now) {
        nextBilling = this.calculateNextBillingDate(nextBilling, sub.billingPeriod || BillingPeriod.MONTHLY);
      }
      sub.nextBillingDate = nextBilling;

      // Reactivate if was suspended/expired
      if (sub.status === SubscriptionStatus.SUSPENDED || sub.status === SubscriptionStatus.EXPIRED) {
        sub.status = SubscriptionStatus.ACTIVE;
      }
      await this.subRepo.save(sub);
    }

    if (changedBy) {
      await this.auditService.log(
        sub.tenantId, changedBy, 'payment.registered', 'payment', saved.id,
        { amount: Number(saved.amount), currency: saved.currency, status: saved.status },
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

  async updatePayment(paymentId: string, dto: any, changedBy?: string): Promise<PaymentHistory> {
    const payment = await this.paymentRepo.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Pago no encontrado');

    if (dto.amount != null) payment.amount = Number(dto.amount);
    if (dto.periodStart) payment.periodStart = new Date(dto.periodStart);
    if (dto.periodEnd) payment.periodEnd = new Date(dto.periodEnd);
    if (dto.paymentMethod !== undefined) payment.paymentMethod = dto.paymentMethod || null;
    if (dto.transactionRef !== undefined) payment.transactionRef = dto.transactionRef || null;
    if (dto.notes !== undefined) payment.notes = dto.notes || null;
    if (dto.status) {
      payment.status = dto.status;
      if (dto.status === PaymentStatus.PAID && !payment.paidAt) payment.paidAt = new Date();
    }

    const saved = await this.paymentRepo.save(payment);
    if (changedBy && payment.tenantId) {
      await this.auditService.log(payment.tenantId, changedBy, 'payment.updated', 'payment', saved.id, { amount: Number(saved.amount) }).catch(() => {});
    }
    return saved;
  }

  async deletePayment(paymentId: string, changedBy?: string): Promise<void> {
    const payment = await this.paymentRepo.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Pago no encontrado');

    if (changedBy && payment.tenantId) {
      await this.auditService.log(payment.tenantId, changedBy, 'payment.deleted', 'payment', payment.id, { amount: Number(payment.amount), transactionRef: payment.transactionRef }).catch(() => {});
    }
    await this.paymentRepo.remove(payment);
  }

  async getPaymentsBySubscription(subscriptionId: string): Promise<PaymentHistory[]> {
    return this.paymentRepo.find({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
    });
  }

  async getUpcomingRenewals(daysAhead: number): Promise<Subscription[]> {
    const now = new Date();
    const target = new Date();
    target.setDate(target.getDate() + daysAhead);

    return this.subRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.plan', 'p')
      .leftJoinAndSelect('s.tenant', 't')
      .where('s.status IN (:...statuses)', { statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] })
      .andWhere('COALESCE(s.next_billing_date, s.end_date) BETWEEN :now AND :target', { now, target })
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

  // ─── Subscription Requests ────────────────────────────────────────────

  /**
   * Calculate proration credit for remaining days in current subscription period.
   * Returns USD/UF credit amount.
   */
  async calculateProration(tenantId: string): Promise<{ credit: number; daysRemaining: number; totalDays: number }> {
    const sub = await this.findByTenantId(tenantId);
    if (!sub || !sub.lastPaymentAmount || !sub.nextBillingDate) {
      return { credit: 0, daysRemaining: 0, totalDays: 0 };
    }
    const now = new Date();
    const periodEnd = new Date(sub.nextBillingDate);
    const periodStart = sub.lastPaymentDate ? new Date(sub.lastPaymentDate) : new Date(sub.startDate);
    const totalDays = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000));
    const daysRemaining = Math.max(0, Math.round((periodEnd.getTime() - now.getTime()) / 86_400_000));
    const credit = Math.max(0, Number(((Number(sub.lastPaymentAmount) / totalDays) * daysRemaining).toFixed(2)));
    return { credit, daysRemaining, totalDays };
  }

  /** Tenant admin creates a plan-change or cancel request. */
  async createRequest(
    tenantId: string,
    requestedBy: string,
    dto: { type: 'plan_change' | 'cancel'; targetPlan?: string; targetBillingPeriod?: string; notes?: string },
  ): Promise<SubscriptionRequest> {
    // Block if there's already a pending request
    const existing = await this.requestRepo.findOne({
      where: { tenantId, status: 'pending' },
    });
    if (existing) {
      throw new ConflictException('Ya existe una solicitud pendiente para esta organización');
    }

    // Validate targetPlan exists for plan_change requests
    if (dto.type === 'plan_change' && dto.targetPlan) {
      const plan = await this.planRepo.findOne({ where: { code: dto.targetPlan, isActive: true } });
      if (!plan) throw new NotFoundException(`Plan "${dto.targetPlan}" no encontrado`);
    }

    const req = this.requestRepo.create({
      tenantId,
      requestedBy,
      type: dto.type,
      targetPlan: dto.targetPlan || null,
      targetBillingPeriod: dto.targetBillingPeriod || null,
      notes: dto.notes || null,
      status: 'pending',
    });
    return this.requestRepo.save(req);
  }

  /** List all pending requests (super_admin). */
  async getPendingRequests(): Promise<any[]> {
    const requests = await this.requestRepo.find({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' },
    });

    // Enrich with tenant and user info
    const enriched = await Promise.all(
      requests.map(async (r) => {
        const tenant = await this.tenantRepo.findOne({ where: { id: r.tenantId } });
        const user = await this.userRepo.findOne({ where: { id: r.requestedBy } });
        return {
          ...r,
          tenantName: tenant?.name ?? r.tenantId,
          requestedByName: user ? `${user.firstName} ${user.lastName}` : r.requestedBy,
        };
      }),
    );
    return enriched;
  }

  /** List requests for a specific tenant (tenant_admin). */
  async getMyRequests(tenantId: string): Promise<SubscriptionRequest[]> {
    return this.requestRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  /** Super admin approves a request — applies the change. */
  async approveRequest(requestId: string, processedBy: string): Promise<void> {
    const req = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Solicitud no encontrada');
    if (req.status !== 'pending') throw new ConflictException('La solicitud ya fue procesada');

    // Calculate proration before making the change
    const { credit } = await this.calculateProration(req.tenantId);

    if (req.type === 'plan_change' && req.targetPlan) {
      const plan = await this.planRepo.findOne({ where: { code: req.targetPlan, isActive: true } });
      if (!plan) throw new NotFoundException(`Plan "${req.targetPlan}" no encontrado`);

      await this.create(
        {
          tenantId: req.tenantId,
          planId: plan.id,
          billingPeriod: req.targetBillingPeriod || BillingPeriod.MONTHLY,
          status: SubscriptionStatus.ACTIVE,
        },
        processedBy,
      );
    } else if (req.type === 'cancel') {
      const sub = await this.findByTenantId(req.tenantId);
      if (sub) await this.cancel(sub.id, processedBy);
    }

    req.status = 'approved';
    req.processedBy = processedBy;
    req.processedAt = new Date();
    req.prorationCredit = credit;
    await this.requestRepo.save(req);

    await this.auditService.log(
      req.tenantId, processedBy, 'subscription_request.approved', 'subscription_request', req.id,
      { type: req.type, targetPlan: req.targetPlan, prorationCredit: credit },
    );
  }

  /** Super admin rejects a request. */
  async rejectRequest(requestId: string, processedBy: string, reason: string): Promise<void> {
    const req = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Solicitud no encontrada');
    if (req.status !== 'pending') throw new ConflictException('La solicitud ya fue procesada');

    req.status = 'rejected';
    req.processedBy = processedBy;
    req.processedAt = new Date();
    req.rejectionReason = reason || 'Sin motivo especificado';
    await this.requestRepo.save(req);

    await this.auditService.log(
      req.tenantId, processedBy, 'subscription_request.rejected', 'subscription_request', req.id,
      { type: req.type, reason: req.rejectionReason },
    );
  }

  /** Tenant admin toggles auto-renew on their active subscription. */
  async toggleAutoRenew(tenantId: string, autoRenew: boolean): Promise<void> {
    const sub = await this.findByTenantId(tenantId);
    if (!sub) throw new NotFoundException('No hay suscripción activa para esta organización');
    sub.autoRenew = autoRenew;
    await this.subRepo.save(sub);
    this.logger.log(`[AutoRenew] Tenant ${tenantId} set autoRenew=${autoRenew} on subscription ${sub.id}`);
  }

  // ─── Auto-Renewal ─────────────────────────────────────────────────────

  /**
   * Process auto-renewals for active subscriptions with autoRenew=true
   * whose nextBillingDate has passed.
   *
   * For each qualifying subscription:
   * - If autoRenew=true: extend nextBillingDate forward (simulate renewal)
   * - If autoRenew=false: suspend the subscription
   *
   * Returns count of processed subscriptions.
   */
  async processAutoRenewals(): Promise<{ renewed: number; suspended: number }> {
    const now = new Date();
    let renewed = 0;
    let suspended = 0;

    // Find active subscriptions past their billing date
    const overdue = await this.subRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.plan', 'p')
      .where('s.status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere('s.next_billing_date IS NOT NULL')
      .andWhere('s.next_billing_date <= :now', { now })
      .getMany();

    for (const sub of overdue) {
      if (sub.autoRenew) {
        // Auto-renew: advance billing date forward
        let nextDate = this.calculateNextBillingDate(
          sub.nextBillingDate!,
          sub.billingPeriod || BillingPeriod.MONTHLY,
        );
        // Ensure it's in the future
        while (nextDate <= now) {
          nextDate = this.calculateNextBillingDate(nextDate, sub.billingPeriod || BillingPeriod.MONTHLY);
        }
        sub.nextBillingDate = nextDate;
        await this.subRepo.save(sub);
        renewed++;

        this.logger.log(
          `[AutoRenew] Subscription ${sub.id} (tenant ${sub.tenantId}) renewed, next billing: ${nextDate.toISOString().split('T')[0]}`,
        );
      } else {
        // No auto-renew: suspend the subscription
        const previousStatus = sub.status;
        sub.status = SubscriptionStatus.SUSPENDED;
        await this.subRepo.save(sub);
        suspended++;

        await this.auditService.log(
          sub.tenantId, 'system', 'subscription.auto_suspended', 'subscription', sub.id,
          { reason: 'Auto-renovación desactivada y fecha de facturación vencida', previousStatus },
        );

        this.logger.log(
          `[AutoRenew] Subscription ${sub.id} (tenant ${sub.tenantId}) SUSPENDED — autoRenew is off`,
        );
      }
    }

    return { renewed, suspended };
  }

  // ─── AI Add-on Packs ──────────────────────────────────────────────────

  /** Available AI packs for purchase */
  getAiPacks(): { id: string; name: string; calls: number; monthlyPrice: number; currency: string }[] {
    return [
      { id: 'ai-pack-50',  name: '+50 análisis IA / mes',  calls: 50,  monthlyPrice: 0.5, currency: 'UF' },
      { id: 'ai-pack-100', name: '+100 análisis IA / mes', calls: 100, monthlyPrice: 0.8, currency: 'UF' },
      { id: 'ai-pack-250', name: '+250 análisis IA / mes', calls: 250, monthlyPrice: 1.5, currency: 'UF' },
      { id: 'ai-pack-500', name: '+500 análisis IA / mes', calls: 500, monthlyPrice: 2.5, currency: 'UF' },
    ];
  }

  /** Purchase, upgrade, downgrade or cancel AI pack for a tenant */
  async setAiAddon(tenantId: string, packId: string | null, approvedBy: string): Promise<{ subscription: Subscription; pack: any }> {
    const sub = await this.findByTenantId(tenantId);
    if (!sub) throw new NotFoundException('No se encontró una suscripción activa');

    const currency = sub.plan?.currency || 'UF';
    const previousCalls = sub.aiAddonCalls || 0;
    const previousPrice = Number(sub.aiAddonPrice) || 0;
    const addonUsed = sub.aiAddonUsed || 0;
    const hadAddon = previousCalls > 0 && previousPrice > 0;

    // Calculate current billing period (rolling from last payment or start)
    const now = new Date();
    const billingBase = sub.lastPaymentDate || sub.startDate || now;
    const periodEnd = sub.nextBillingDate || now;

    // Fetch tenant name once for notifications
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId }, select: ['id', 'name'] });
    const orgName = tenant?.name || 'Organización';

    // Helper: notify super_admins
    const notifySA = async (title: string, message: string) => {
      const superAdmins = await this.userRepo.find({ where: { role: 'super_admin', isActive: true }, select: ['id'] });
      for (const sa of superAdmins) {
        await this.notificationsService.create({ tenantId, userId: sa.id, type: NotificationType.GENERAL, title, message }).catch(() => {});
      }
    };

    // ═══ CANCEL (Sin add-on) ═══
    if (!packId || packId === 'none') {
      sub.aiAddonCalls = 0;
      sub.aiAddonPrice = 0;
      sub.aiAddonUsed = 0; // Reset counter for future re-purchase

      // If credits were used, register a pending charge for the full period
      if (hadAddon && addonUsed > 0) {
        await this.paymentRepo.save(this.paymentRepo.create({
          tenantId, subscriptionId: sub.id, amount: previousPrice, currency,
          billingPeriod: sub.billingPeriod || BillingPeriod.MONTHLY,
          periodStart: billingBase, periodEnd, status: PaymentStatus.PENDING,
          concept: `Add-on IA +${previousCalls}/mes (cancelado con ${addonUsed} créditos usados — cobro completo del período)`,
          isAddon: true, paidAt: null,
        }));
        await notifySA(
          `Add-on IA cancelado: ${orgName}`,
          `${orgName} canceló add-on IA (+${previousCalls}/mes, ${previousPrice} ${currency}). Se usaron ${addonUsed} créditos — cobro completo del período registrado.`,
        );
      }
      await this.subRepo.save(sub);
      await this.auditService.log(tenantId, approvedBy, 'subscription.ai_addon_removed', 'subscription', sub.id, {
        previousCalls, previousPrice, addonUsed, chargedFull: hadAddon && addonUsed > 0,
      }).catch(() => {});
      return { subscription: sub, pack: null };
    }

    // ═══ PURCHASE / UPGRADE / DOWNGRADE ═══
    const packs = this.getAiPacks();
    const pack = packs.find(p => p.id === packId);
    if (!pack) throw new BadRequestException('Paquete de IA no válido');

    const isUpgrade = hadAddon && pack.calls > previousCalls;
    const isDowngrade = hadAddon && pack.calls < previousCalls;

    // Downgrade validation: can't go below credits already used THIS period
    // (addonUsed is reset on cancel/new purchase, so it reflects current period usage)
    if (isDowngrade && addonUsed > pack.calls) {
      throw new BadRequestException(
        `No puede reducir a +${pack.calls} créditos porque ya ha utilizado ${addonUsed} créditos en este período. Cancele el add-on (se cobrará la cuota completa) o espere al siguiente período.`,
      );
    }

    // If upgrading with used credits, register charge for previous pack and reset usage
    if (isUpgrade && addonUsed > 0) {
      await this.paymentRepo.save(this.paymentRepo.create({
        tenantId, subscriptionId: sub.id, amount: previousPrice, currency,
        billingPeriod: sub.billingPeriod || BillingPeriod.MONTHLY,
        periodStart: billingBase, periodEnd, status: PaymentStatus.PENDING,
        concept: `Add-on IA +${previousCalls}/mes → +${pack.calls}/mes (upgrade — ${addonUsed} créditos usados, cobro pack anterior)`,
        isAddon: true, paidAt: null,
      }));
    }

    // Apply new pack — reset usage counter on upgrade (already charged) and new purchase
    sub.aiAddonCalls = pack.calls;
    sub.aiAddonPrice = pack.monthlyPrice;
    sub.aiAddonUsed = 0; // Always reset: upgrade already charged, new purchase starts fresh, downgrade keeps remaining
    await this.subRepo.save(sub);

    const action = isUpgrade ? 'upgraded' : isDowngrade ? 'downgraded' : 'purchased';
    await this.auditService.log(tenantId, approvedBy, `subscription.ai_addon_${action}`, 'subscription', sub.id, {
      pack: pack.name, calls: pack.calls, price: pack.monthlyPrice,
      previousCalls, previousPrice, addonUsed, action,
    }).catch(() => {});

    const actionLabel = isUpgrade ? 'Upgrade' : isDowngrade ? 'Downgrade' : 'Compra';
    await notifySA(
      `${actionLabel} Add-on IA: ${orgName}`,
      `${orgName} ${isUpgrade ? `subió de +${previousCalls} a` : isDowngrade ? `bajó de +${previousCalls} a` : 'adquirió'} "${pack.name}" (${pack.monthlyPrice} ${currency}/mes).${addonUsed > 0 ? ` ${addonUsed} créditos usados del pack anterior.` : ''}`,
    );

    return { subscription: sub, pack };
  }

  /** Get current AI addon for a tenant */
  async getAiAddon(tenantId: string): Promise<{ calls: number; price: number; packId: string | null }> {
    const sub = await this.findByTenantId(tenantId);
    if (!sub) return { calls: 0, price: 0, packId: null };
    const packs = this.getAiPacks();
    const currentPack = packs.find(p => p.calls === sub.aiAddonCalls) || null;
    return {
      calls: sub.aiAddonCalls || 0,
      price: Number(sub.aiAddonPrice) || 0,
      packId: currentPack?.id || null,
    };
  }
}
