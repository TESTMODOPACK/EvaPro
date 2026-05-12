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
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { cachedFetch, invalidateCache } from '../../common/cache/cache.helper';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  Subscription,
  SubscriptionStatus,
  SUBSCRIPTION_STATUS_VALUES,
} from './entities/subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { SubscriptionRequest } from './entities/subscription-request.entity';
import {
  PaymentHistory,
  BillingPeriod,
  PaymentStatus,
} from './entities/payment-history.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import {
  EvaluationCycle,
  CycleType,
  CycleStatus,
} from '../evaluations/entities/evaluation-cycle.entity';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { PlanFeature } from '../../common/constants/plan-features';
import { InvoicesService } from './invoices.service';
import { PaymentMethodsService } from '../payments/payment-methods.service';

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
    @Inject(forwardRef(() => EmailService))
    private readonly emailService: EmailService,
    // Fase 0 / Tarea 0.2.1: forwardRef para evitar dependencia circular
    // potencial. Aunque InvoicesService y SubscriptionsService viven en
    // el mismo modulo, InvoicesService podria a futuro consumir methods
    // de SubscriptionsService (calculateProration, etc.) y Nest necesita
    // la indireccion para resolver el ciclo.
    @Inject(forwardRef(() => InvoicesService))
    private readonly invoicesService: InvoicesService,
    // Fase 3 / Tarea 1.3 — Cobra automaticamente con tarjeta guardada
    // en processAutoRenewals.
    @Inject(forwardRef(() => PaymentMethodsService))
    private readonly paymentMethodsService: PaymentMethodsService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  // ─── Plans CRUD ────────────────────────────────────────────────────────

  async createPlan(dto: any): Promise<SubscriptionPlan> {
    const existing = await this.planRepo.findOne({ where: { code: dto.code } });
    if (existing)
      throw new ConflictException('Ya existe un plan con ese código');

    // Fase 1 / Tarea 1.2.3 — Validar dunningThresholds antes de persistir.
    // Si el caller envia thresholds invalidos (no estrictamente crecientes
    // o valores no numericos), rechazamos con 400 explicito en vez de
    // persistir basura que processDunning ignoraria silenciosamente.
    const dunningThresholds = this.validateDunningThresholdsDto(dto.dunningThresholds);

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
      dunningThresholds,
    });
    return this.planRepo.save(plan);
  }

  /**
   * Fase 1 / Tarea 1.2.3 — Valida un dunningThresholds DTO.
   * - undefined / null -> retorna null (usar defaults).
   * - Objeto con keys numericas estrictamente crecientes en orden
   *   reminder1 < reminder2 < suspend < cancelWarning < cancel -> OK.
   * - Cualquier otra cosa -> BadRequestException con mensaje claro.
   *
   * Permite definicion parcial: si el caller solo envia
   * { suspend: 21 }, las demas keys se consideran null y processDunning
   * usara los defaults para esas. La validacion de "estrictamente
   * crecientes" se aplica luego del merge con defaults (ver
   * resolveDunningThresholds en invoices.service).
   */
  private validateDunningThresholdsDto(
    raw: unknown,
  ): { reminder1?: number; reminder2?: number; suspend?: number; cancelWarning?: number; cancel?: number } | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException('dunningThresholds debe ser un objeto.');
    }
    const t = raw as Record<string, unknown>;
    const allowed = ['reminder1', 'reminder2', 'suspend', 'cancelWarning', 'cancel'];
    const result: Record<string, number> = {};
    for (const k of allowed) {
      if (t[k] === undefined || t[k] === null) continue;
      const v = t[k];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 365) {
        throw new BadRequestException(
          `dunningThresholds.${k} debe ser un entero >= 0 y <= 365.`,
        );
      }
      result[k] = v;
    }
    // Validacion final: si el caller define varias keys, deben ser
    // estrictamente crecientes (entre las definidas, no contra defaults).
    const orderedKeys = allowed.filter((k) => k in result);
    for (let i = 1; i < orderedKeys.length; i++) {
      if (result[orderedKeys[i]] <= result[orderedKeys[i - 1]]) {
        throw new BadRequestException(
          `dunningThresholds: los valores deben ser estrictamente crecientes (recibido ${orderedKeys[i - 1]}=${result[orderedKeys[i - 1]]} >= ${orderedKeys[i]}=${result[orderedKeys[i]]}).`,
        );
      }
    }
    return Object.keys(result).length > 0 ? (result as any) : null;
  }

  async findAllPlans(): Promise<SubscriptionPlan[]> {
    return this.planRepo.find({ order: { displayOrder: 'ASC', name: 'ASC' } });
  }

  async findPlanById(id: string): Promise<SubscriptionPlan> {
    const plan = await cachedFetch(this.cacheManager, `plan:${id}`, 300, () =>
      this.planRepo.findOne({ where: { id } }),
    );
    if (!plan) throw new NotFoundException('Plan no encontrado');
    return plan;
  }

  async updatePlan(id: string, dto: any): Promise<SubscriptionPlan> {
    const plan = await this.findPlanById(id);
    if (dto.name !== undefined) plan.name = dto.name;
    if (dto.description !== undefined) plan.description = dto.description;
    if (dto.maxEmployees !== undefined) plan.maxEmployees = dto.maxEmployees;
    if (dto.monthlyPrice !== undefined) plan.monthlyPrice = dto.monthlyPrice;
    if (dto.quarterlyPrice !== undefined)
      plan.quarterlyPrice = dto.quarterlyPrice;
    if (dto.semiannualPrice !== undefined)
      plan.semiannualPrice = dto.semiannualPrice;
    if (dto.yearlyPrice !== undefined) plan.yearlyPrice = dto.yearlyPrice;
    if (dto.currency !== undefined) plan.currency = dto.currency;
    if (dto.features !== undefined) plan.features = dto.features;
    if (dto.maxAiCallsPerMonth !== undefined)
      plan.maxAiCallsPerMonth = dto.maxAiCallsPerMonth;
    if (dto.isActive !== undefined) plan.isActive = dto.isActive;
    if (dto.displayOrder !== undefined) plan.displayOrder = dto.displayOrder;
    // Fase 1 / Tarea 1.2.3 — Validar y persistir dunningThresholds.
    // Convencion: pasar `null` explicito para limpiar (volver a defaults
    // globales); omitir el campo deja el valor previo intacto.
    if (dto.dunningThresholds !== undefined) {
      plan.dunningThresholds = this.validateDunningThresholdsDto(dto.dunningThresholds);
    }
    const saved = await this.planRepo.save(plan);
    await invalidateCache(this.cacheManager, `plan:${id}`);
    return saved;
  }

  async deactivatePlan(id: string): Promise<void> {
    const plan = await this.findPlanById(id);
    plan.isActive = false;
    await this.planRepo.save(plan);
    await invalidateCache(this.cacheManager, `plan:${id}`);
  }

  // ─── Subscriptions CRUD ────────────────────────────────────────────────

  async create(dto: any, changedBy?: string): Promise<Subscription> {
    const plan = await this.findPlanById(dto.planId);

    // Cancel any existing active/trial subscriptions for this tenant before creating the new one
    const previousSubs = await this.subRepo.find({
      where: {
        tenantId: dto.tenantId,
        status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]),
      },
    });
    for (const prev of previousSubs) {
      prev.status = SubscriptionStatus.CANCELLED;
      prev.endDate = new Date();
      await this.subRepo.save(prev);
      if (changedBy) {
        await this.auditService.log(
          dto.tenantId,
          changedBy,
          'subscription.cancelled',
          'subscription',
          prev.id,
          {
            reason: 'Reemplazada por nueva suscripción',
            replacedByPlan: plan.code,
          },
        );
      }
    }

    const billingPeriod = dto.billingPeriod || BillingPeriod.MONTHLY;
    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const nextBillingDate = dto.nextBillingDate
      ? new Date(dto.nextBillingDate)
      : this.calculateNextBillingDate(startDate, billingPeriod);

    // Fase 0 / Tarea 0.1.3: endDate solo se setea si el caller lo pasa
    // explicitamente (plan no recurrente o cierre conocido). Pre-fix: se
    // pisaba con `nextBillingDate` (1 ciclo adelante), lo que marcaba
    // todas las subs como con fecha de termino — semanticamente
    // incorrecto para suscripciones recurrentes activas, ademas de
    // confundir reportes de "subs vigentes hasta X". Post-fix: null por
    // default (suscripcion abierta hasta cancelar/suspender).
    const sub = this.subRepo.create({
      tenantId: dto.tenantId,
      planId: dto.planId,
      status: dto.status || SubscriptionStatus.ACTIVE,
      billingPeriod,
      startDate,
      endDate: dto.endDate ? new Date(dto.endDate) : null,
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
        dto.tenantId,
        changedBy,
        'subscription.created',
        'subscription',
        saved.id,
        { planCode: plan.code, planName: plan.name, status: sub.status },
      );
    }

    // Trial nurture welcome — send synchronously so the admin gets the
    // email in minutes rather than ~24h from the next cron run. Record
    // the stage so the cron never re-sends.
    if (saved.status === SubscriptionStatus.TRIAL) {
      try {
        const admin = await this.userRepo.findOne({
          where: {
            tenantId: dto.tenantId,
            role: 'tenant_admin',
            isActive: true,
          },
        });
        const tenant = await this.tenantRepo.findOne({
          where: { id: dto.tenantId },
        });
        if (admin?.email) {
          await this.emailService.sendTrialWelcome(admin.email, {
            firstName: admin.firstName,
            orgName: tenant?.name || '',
            tenantId: dto.tenantId,
          });
          await this.subRepo.update(saved.id, {
            nurtureEmailsSent: ['welcome'],
          });
        }
      } catch (err: any) {
        // Never block subscription creation because of a flaky email.
        // The cron will pick up 'welcome' on its first run since the
        // marker wasn't persisted.
        this.logger?.warn?.(
          `Trial welcome email failed: ${err?.message || err}`,
        );
      }
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
      where: {
        tenantId,
        status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]),
      },
      relations: ['plan', 'tenant'],
      order: { createdAt: 'DESC' },
    });

    // Auto-cancel stale duplicates — keep only the newest active one
    if (activeSubs.length > 1) {
      for (const stale of activeSubs.slice(1)) {
        stale.status = SubscriptionStatus.CANCELLED;
        stale.endDate = new Date();
        await this.subRepo.save(stale);
        this.logger.warn(
          `[findByTenantId] Auto-cancelled stale subscription ${stale.id} (plan: ${stale.plan?.name}) for tenant ${tenantId}`,
        );
      }
    }

    const sub = activeSubs[0] ?? null;
    if (!sub) return null;

    // Auto-expire trial if past trialEndsAt
    if (sub.status === SubscriptionStatus.TRIAL && sub.trialEndsAt) {
      const now = new Date();
      const trialEnd = new Date(sub.trialEndsAt);
      if (now > trialEnd) {
        this.logger.warn(
          `Trial expired for tenant ${tenantId} — auto-expiring subscription ${sub.id}`,
        );
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
      where: {
        tenantId,
        status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]),
      },
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
  async update(
    id: string,
    dto: any,
    changedBy?: string,
  ): Promise<Subscription> {
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
        const lostFeatures = currentFeatures.filter(
          (f) => !newFeatures.includes(f),
        );

        if (lostFeatures.length > 0) {
          // Check active evaluation cycles that use features being removed
          const activeCycles = await this.cycleRepo.find({
            where: { tenantId: sub.tenantId, status: CycleStatus.ACTIVE },
          });

          const conflicts: string[] = [];

          for (const cycle of activeCycles) {
            if (
              cycle.type === CycleType.DEGREE_360 &&
              lostFeatures.includes(PlanFeature.EVAL_360)
            ) {
              conflicts.push(`Ciclo 360° activo: "${cycle.name}"`);
            }
            if (
              cycle.type === CycleType.DEGREE_270 &&
              lostFeatures.includes(PlanFeature.EVAL_270)
            ) {
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
        const oldPlan = previousPlanId
          ? await this.planRepo.findOne({ where: { id: previousPlanId } })
          : null;
        await this.auditService.log(
          sub.tenantId,
          changedBy,
          'subscription.plan_changed',
          'subscription',
          sub.id,
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
    const periodChanged =
      dto.billingPeriod !== undefined &&
      dto.billingPeriod !== sub.billingPeriod;

    if (dto.billingPeriod !== undefined) sub.billingPeriod = dto.billingPeriod;

    if (
      (planChanged || periodChanged) &&
      !dto.startDate &&
      !dto.nextBillingDate
    ) {
      // Auto-recalculate: reset start to today and calculate new next billing date
      const today = new Date();
      sub.startDate = today;
      sub.nextBillingDate = this.calculateNextBillingDate(
        today,
        sub.billingPeriod,
      );
      sub.endDate = null;
    } else {
      if (dto.startDate !== undefined) sub.startDate = dto.startDate;
      if (dto.endDate !== undefined) sub.endDate = dto.endDate;
      if (dto.nextBillingDate !== undefined)
        sub.nextBillingDate = dto.nextBillingDate;
    }

    await this.subRepo.save(sub);

    // Audit status change
    if (
      changedBy &&
      dto.status !== undefined &&
      dto.status !== previousStatus
    ) {
      await this.auditService.log(
        sub.tenantId,
        changedBy,
        'subscription.status_changed',
        'subscription',
        sub.id,
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
        sub.tenantId,
        changedBy,
        'subscription.cancelled',
        'subscription',
        sub.id,
        { previousStatus },
      );
    }
  }

  // ─── Fase 3 / Tarea 3.5 — Pausa voluntaria ──────────────────────────

  /**
   * Pausa la suscripcion del tenant. Reglas:
   *   - Solo subs ACTIVE o TRIAL pueden pausarse. SUSPENDED, CANCELLED,
   *     EXPIRED, PAUSED -> 400.
   *   - `resumeAt` opcional: si null -> pausa indefinida (cliente
   *     reactiva manual). Si presente -> validar > ahora + 1 dia
   *     (evita pausas instantaneas/pasadas).
   *   - Tarea 3.5.4: processAutoRenewals y dunning excluyen PAUSED, no
   *     factura ni envia recordatorios.
   *
   * Audit: subscription.paused con previousStatus + resumeAt.
   */
  async pauseSubscription(
    tenantId: string,
    resumeAt: Date | null,
    changedBy: string,
  ): Promise<Subscription> {
    const sub = await this.findByTenantId(tenantId);
    if (!sub) throw new NotFoundException('No hay suscripcion activa para pausar.');
    if (
      sub.status !== SubscriptionStatus.ACTIVE &&
      sub.status !== SubscriptionStatus.TRIAL
    ) {
      throw new BadRequestException(
        `Solo suscripciones activas o en trial pueden pausarse (estado actual: ${sub.status}).`,
      );
    }
    if (resumeAt) {
      const minResume = new Date(Date.now() + 24 * 60 * 60 * 1000);
      if (resumeAt.getTime() < minResume.getTime()) {
        throw new BadRequestException(
          'La fecha de reactivacion debe ser al menos 24h en el futuro.',
        );
      }
      const maxResume = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      if (resumeAt.getTime() > maxResume.getTime()) {
        throw new BadRequestException(
          'La fecha de reactivacion no puede ser mas de 1 ano en el futuro. Considere cancelar.',
        );
      }
    }

    const previousStatus = sub.status;
    sub.status = SubscriptionStatus.PAUSED;
    sub.pausedAt = new Date();
    sub.resumeAt = resumeAt;
    await this.subRepo.save(sub);

    await this.auditService
      .log(tenantId, changedBy, 'subscription.paused', 'subscription', sub.id, {
        previousStatus,
        resumeAt: resumeAt ? resumeAt.toISOString() : null,
      })
      .catch(() => undefined);

    this.logger.log(
      `[Pause] Subscription ${sub.id} (tenant ${tenantId}) paused. Resume: ${
        resumeAt ? resumeAt.toISOString().split('T')[0] : 'manual'
      }`,
    );

    return sub;
  }

  /**
   * Reactiva una suscripcion PAUSED. Reglas:
   *   - Solo PAUSED puede reactivarse via este metodo. Otros estados ->
   *     400 (use el endpoint correspondiente).
   *   - Vuelve a ACTIVE (no TRIAL — el trial pre-pausa ya consumio sus
   *     dias; si quedaba trial, simplemente lo retomamos pero el
   *     trialEndsAt sigue siendo el original).
   *   - nextBillingDate: si quedo en el pasado durante la pausa,
   *     avanzamos hasta el siguiente ciclo posterior a ahora (cron de
   *     auto-renewal aceptara y facturara).
   */
  async resumeSubscription(
    tenantId: string,
    changedBy: string,
  ): Promise<Subscription> {
    const sub = await this.findByTenantId(tenantId);
    if (!sub) throw new NotFoundException('No hay suscripcion para reactivar.');
    if (sub.status !== SubscriptionStatus.PAUSED) {
      throw new BadRequestException(
        `Solo suscripciones PAUSED pueden reactivarse aqui (estado actual: ${sub.status}).`,
      );
    }

    const previousStatus = sub.status;
    sub.status = SubscriptionStatus.ACTIVE;
    sub.pausedAt = null;
    sub.resumeAt = null;

    // Avanzar nextBillingDate si quedo en el pasado durante la pausa.
    const now = new Date();
    if (sub.nextBillingDate && new Date(sub.nextBillingDate).getTime() <= now.getTime()) {
      let next = this.calculateNextBillingDate(
        now,
        sub.billingPeriod || BillingPeriod.MONTHLY,
      );
      // Loop defensivo (caso edge: ciclo muy corto).
      while (next.getTime() <= now.getTime()) {
        next = this.calculateNextBillingDate(
          next,
          sub.billingPeriod || BillingPeriod.MONTHLY,
        );
      }
      sub.nextBillingDate = next;
    }

    await this.subRepo.save(sub);

    await this.auditService
      .log(tenantId, changedBy, 'subscription.resumed', 'subscription', sub.id, {
        previousStatus,
        newNextBillingDate: sub.nextBillingDate?.toISOString?.() || null,
      })
      .catch(() => undefined);

    this.logger.log(
      `[Resume] Subscription ${sub.id} (tenant ${tenantId}) reactivated. Next billing: ${
        sub.nextBillingDate?.toISOString?.().split('T')[0] || 'n/a'
      }`,
    );

    return sub;
  }

  /**
   * Cron diario: reactiva automaticamente subs PAUSED con resumeAt <= ahora.
   * Llamado por reminders.service @Cron.
   */
  async processScheduledResumes(): Promise<{ reactivated: number }> {
    const now = new Date();
    const pausedReady = await this.subRepo
      .createQueryBuilder('s')
      .where('s.status = :status', { status: SubscriptionStatus.PAUSED })
      .andWhere('s.resume_at IS NOT NULL')
      .andWhere('s.resume_at <= :now', { now })
      .getMany();

    let reactivated = 0;
    for (const sub of pausedReady) {
      try {
        await this.resumeSubscription(sub.tenantId, 'system');
        reactivated++;
      } catch (err: any) {
        this.logger.error(
          `[ScheduledResume] failed for sub ${sub.id} (tenant ${sub.tenantId}): ${err?.message || err}`,
        );
      }
    }
    return { reactivated };
  }

  async getStats(): Promise<any> {
    const total = await this.subRepo.count();
    const active = await this.subRepo.count({
      where: { status: SubscriptionStatus.ACTIVE },
    });
    const trial = await this.subRepo.count({
      where: { status: SubscriptionStatus.TRIAL },
    });
    const suspended = await this.subRepo.count({
      where: { status: SubscriptionStatus.SUSPENDED },
    });
    const cancelled = await this.subRepo.count({
      where: { status: SubscriptionStatus.CANCELLED },
    });
    const expired = await this.subRepo.count({
      where: { status: SubscriptionStatus.EXPIRED },
    });

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
  //
  // Post-auditoria Fases 0-5: el metodo legacy `registerPayment` fue
  // ELIMINADO porque violaba 8 reglas de negocio del nuevo modelo:
  //
  //   1. Pagos sin invoice asociada -> sin snapshot fiscal SII (T3.3-fix-1).
  //   2. Doble cobro: super_admin podia pagar aqui + en /facturacion
  //      (markAsPaid) sobre la misma factura -> duplicado en
  //      payment_history.
  //   3. Saltea credit notes auto-aplicadas (T2.4.2).
  //   4. Saltea metricas SaaS DSO/collection rate (T4.2) — cuentan invoices.
  //   5. Saltea settings dinamicos de IVA/prefijo (T4.5).
  //   6. Saltea cron auto-renewal/dunning (T0.2 + T1.1) — operan sobre
  //      invoices, no sobre pagos sueltos.
  //   7. Audit trail incompleto: no encadena a invoice id.
  //   8. nextBillingDate manual recalculado podia chocar con la lógica
  //      de continuidad historica (T0.1).
  //
  // FLUJO CORRECTO: super_admin -> /dashboard/facturacion ->
  //   1. "Generar factura del periodo" (genera invoice DRAFT con
  //      snapshot fiscal + credit notes aplicadas + IVA dinamico).
  //   2. "Marcar como pagada" (markAsPaid en invoices.service)
  //      -> crea payment_history vinculado a invoice + audit log SII.
  //
  // Los registros payment_history HISTORICOS (creados pre-eliminacion)
  // se mantienen intactos en BD. Solo se eliminan las puertas de entrada
  // (endpoint + UI button) para prevenir mas datos huerfanos.
  // updatePayment y deletePayment se mantienen por si super_admin
  // necesita corregir entradas viejas; igual deben usarse con cuidado
  // y solo sobre rows con invoiceId=NULL.

  /**
   * Fase 3 / Tarea 3.1 — Paginacion real (vs el `take: 50` hardcoded).
   *
   * Reglas:
   *   - `limit` capped a 100 para evitar payloads gigantes.
   *   - `offset` >= 0 (clamp).
   *   - Retorna `{ data, total }` para que el frontend pueda mostrar
   *     "X de Y pagos" y deshabilitar "Cargar mas" cuando se llego al final.
   *   - Mantener compat backward: caller sin params recibe los primeros 50
   *     en `data` con el mismo orden de antes (createdAt DESC).
   */
  async getPaymentHistory(
    tenantId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ data: PaymentHistory[]; total: number }> {
    const limit = Math.min(Math.max(1, Number(opts.limit) || 50), 100);
    const offset = Math.max(0, Number(opts.offset) || 0);
    const [data, total] = await this.paymentRepo.findAndCount({
      where: { tenantId },
      relations: ['subscription'],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { data, total };
  }

  async updatePayment(
    paymentId: string,
    dto: any,
    changedBy?: string,
  ): Promise<PaymentHistory> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Pago no encontrado');

    if (dto.amount != null) payment.amount = Number(dto.amount);
    if (dto.periodStart) payment.periodStart = new Date(dto.periodStart);
    if (dto.periodEnd) payment.periodEnd = new Date(dto.periodEnd);
    if (dto.paymentMethod !== undefined)
      payment.paymentMethod = dto.paymentMethod || null;
    if (dto.transactionRef !== undefined)
      payment.transactionRef = dto.transactionRef || null;
    if (dto.notes !== undefined) payment.notes = dto.notes || null;
    if (dto.status) {
      payment.status = dto.status;
      if (dto.status === PaymentStatus.PAID && !payment.paidAt)
        payment.paidAt = new Date();
    }

    const saved = await this.paymentRepo.save(payment);
    if (changedBy && payment.tenantId) {
      await this.auditService
        .log(
          payment.tenantId,
          changedBy,
          'payment.updated',
          'payment',
          saved.id,
          { amount: Number(saved.amount) },
        )
        .catch(() => {});
    }
    return saved;
  }

  async deletePayment(paymentId: string, changedBy?: string): Promise<void> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Pago no encontrado');

    if (changedBy && payment.tenantId) {
      await this.auditService
        .log(
          payment.tenantId,
          changedBy,
          'payment.deleted',
          'payment',
          payment.id,
          {
            amount: Number(payment.amount),
            transactionRef: payment.transactionRef,
          },
        )
        .catch(() => {});
    }
    await this.paymentRepo.remove(payment);
  }

  async getPaymentsBySubscription(
    subscriptionId: string,
  ): Promise<PaymentHistory[]> {
    // Fase 0 / Tarea 0.5 — Defense-in-depth de aislamiento multi-tenant.
    //
    // Pre-fix: solo filtrabamos por subscriptionId. Hoy el unico caller
    // expuesto es GET /subscriptions/:id/payments con @Roles('super_admin'),
    // por lo que cross-tenant queries son legitimas. PERO el patron del
    // resto del modulo es scopear por tenantId siempre — y si manana
    // alguien expone este metodo a tenant_admin sin agregar el filtro,
    // hay leak directo.
    //
    // Fix: resolver tenantId desde la sub y filtrar payments por ese
    // mismo tenantId. Si por alguna corrupcion los payments quedaran con
    // tenantId divergente del de la sub (data inconsistency), no los
    // mezclamos. Si la sub no existe, retornamos [].
    const sub = await this.subRepo.findOne({
      where: { id: subscriptionId },
      select: ['id', 'tenantId'],
    });
    if (!sub) return [];
    return this.paymentRepo.find({
      where: { subscriptionId, tenantId: sub.tenantId },
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
      .where('s.status IN (:...statuses)', {
        statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL],
      })
      .andWhere(
        'COALESCE(s.next_billing_date, s.end_date) BETWEEN :now AND :target',
        { now, target },
      )
      .getMany();
  }

  async calculatePriceForPeriod(
    planId: string,
    period: BillingPeriod,
  ): Promise<any> {
    const plan = await this.findPlanById(planId);
    const monthly = Number(plan.monthlyPrice);

    const pricing = {
      monthly: { price: monthly, discount: 0, savings: 0, period: 1 },
      quarterly: {
        price: plan.quarterlyPrice
          ? Number(plan.quarterlyPrice)
          : Math.round(monthly * 3 * 0.9 * 100) / 100,
        discount: 10,
        savings: Math.round(monthly * 3 * 0.1 * 100) / 100,
        period: 3,
      },
      semiannual: {
        price: plan.semiannualPrice
          ? Number(plan.semiannualPrice)
          : Math.round(monthly * 6 * 0.85 * 100) / 100,
        discount: 15,
        savings: Math.round(monthly * 6 * 0.15 * 100) / 100,
        period: 6,
      },
      annual: {
        price: plan.yearlyPrice
          ? Number(plan.yearlyPrice)
          : Math.round(monthly * 12 * 0.8 * 100) / 100,
        discount: 20,
        savings: Math.round(monthly * 12 * 0.2 * 100) / 100,
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
    // Fase 0 / Tarea 0.1.6 — UTC-safe, identico fix que `addBillingPeriod`
    // en invoices.service. Razon: si esta funcion usara local time y
    // addBillingPeriod usara UTC, `nextBillingDate` y `invoice.periodEnd`
    // divergirian dia a dia bajo TZ Chile.
    const next = new Date(from);
    switch (period) {
      case BillingPeriod.MONTHLY:
        next.setUTCMonth(next.getUTCMonth() + 1);
        break;
      case BillingPeriod.QUARTERLY:
        next.setUTCMonth(next.getUTCMonth() + 3);
        break;
      case BillingPeriod.SEMIANNUAL:
        next.setUTCMonth(next.getUTCMonth() + 6);
        break;
      case BillingPeriod.ANNUAL:
        next.setUTCFullYear(next.getUTCFullYear() + 1);
        break;
    }
    return next;
  }

  private async syncTenantPlan(
    tenantId: string,
    plan: SubscriptionPlan,
  ): Promise<void> {
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
  async calculateProration(
    tenantId: string,
  ): Promise<{ credit: number; daysRemaining: number; totalDays: number }> {
    const sub = await this.findByTenantId(tenantId);
    if (!sub || !sub.lastPaymentAmount || !sub.nextBillingDate) {
      return { credit: 0, daysRemaining: 0, totalDays: 0 };
    }
    const now = new Date();
    const periodEnd = new Date(sub.nextBillingDate);
    const periodStart = sub.lastPaymentDate
      ? new Date(sub.lastPaymentDate)
      : new Date(sub.startDate);
    const totalDays = Math.max(
      1,
      Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000),
    );
    const daysRemaining = Math.max(
      0,
      Math.round((periodEnd.getTime() - now.getTime()) / 86_400_000),
    );
    const credit = Math.max(
      0,
      Number(
        ((Number(sub.lastPaymentAmount) / totalDays) * daysRemaining).toFixed(
          2,
        ),
      ),
    );
    return { credit, daysRemaining, totalDays };
  }

  /** Tenant admin creates a plan-change or cancel request. */
  async createRequest(
    tenantId: string,
    requestedBy: string,
    dto: {
      type: 'plan_change' | 'cancel';
      targetPlan?: string;
      targetBillingPeriod?: string;
      notes?: string;
    },
  ): Promise<SubscriptionRequest> {
    // Block if there's already a pending request
    const existing = await this.requestRepo.findOne({
      where: { tenantId, status: 'pending' },
    });
    if (existing) {
      throw new ConflictException(
        'Ya existe una solicitud pendiente para esta organización',
      );
    }

    // Validate targetPlan exists for plan_change requests
    if (dto.type === 'plan_change' && dto.targetPlan) {
      const plan = await this.planRepo.findOne({
        where: { code: dto.targetPlan, isActive: true },
      });
      if (!plan)
        throw new NotFoundException(`Plan "${dto.targetPlan}" no encontrado`);
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
        const tenant = await this.tenantRepo.findOne({
          where: { id: r.tenantId },
        });
        const user = await this.userRepo.findOne({
          where: { id: r.requestedBy },
        });
        return {
          ...r,
          tenantName: tenant?.name ?? r.tenantId,
          requestedByName: user
            ? `${user.firstName} ${user.lastName}`
            : r.requestedBy,
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
    if (req.status !== 'pending')
      throw new ConflictException('La solicitud ya fue procesada');

    // Calculate proration before making the change
    const { credit } = await this.calculateProration(req.tenantId);

    // Fase 2 / Tarea 2.4.1 — Emitir credit note auto cuando hay credito
    // por prorrateo. Pre-fix calculabamos el credito y lo descartabamos
    // (solo quedaba como `prorationCredit` informativo en el request).
    // Post-fix: emitimos NC vinculada a la ultima factura PAID del
    // tenant; cuando se genere la primera factura del plan nuevo
    // (T2.4.2), generateInvoice aplicara automaticamente las NCs
    // disponibles como linea negativa.
    //
    // Solo aplica para plan_change. En 'cancel' el credito tambien
    // existe, pero no hay factura futura donde aplicarlo — se emite NC
    // como reembolso pendiente que el super_admin puede usar via refund
    // manual o transferencia.
    let creditNoteIssuedId: string | null = null;
    let creditNoteIssuedNumber: string | null = null;
    if (credit > 0) {
      try {
        const lastPaid = await this.invoicesService.findLatestPaidInvoiceByTenant(
          req.tenantId,
        );
        if (lastPaid) {
          const reason =
            req.type === 'plan_change'
              ? `Prorrateo por cambio de plan a ${req.targetPlan ?? '(s/d)'}`
              : 'Prorrateo por cancelacion de suscripcion';
          const cn = await this.invoicesService.issueCreditNote(
            lastPaid.id,
            { amount: credit, reason, notes: `Solicitud ${req.id}` },
            processedBy,
            req.tenantId,
          );
          creditNoteIssuedId = cn.id;
          creditNoteIssuedNumber = cn.invoiceNumber;
        } else {
          // Sin factura PAID previa, no hay donde anclar la NC. Caso
          // raro: tenant esta en TRIAL y nunca pago. credit deberia ser
          // 0 en ese caso (calculateProration lo verifica), pero por si
          // acaso loggeamos.
          this.logger.warn(
            `[Proration] tenant=${req.tenantId} credit=${credit} pero sin invoice PAID — credit note NO emitida.`,
          );
        }
      } catch (err: any) {
        // Si la NC falla, NO bloqueamos el cambio de plan — el cliente
        // necesita su upgrade. Audit log + flag manual.
        this.logger.error(
          `[Proration] issueCreditNote fallo para tenant=${req.tenantId}: ${err?.message}. Cambio de plan procede sin NC.`,
        );
        await this.auditService
          .log(req.tenantId, processedBy, 'invoice.credit_note_pending_manual', 'subscription_request', req.id, {
            error: String(err?.message || err).slice(0, 500),
            credit,
            requiresImmediateAction: true,
          })
          .catch(() => undefined);
      }
    }

    if (req.type === 'plan_change' && req.targetPlan) {
      const plan = await this.planRepo.findOne({
        where: { code: req.targetPlan, isActive: true },
      });
      if (!plan)
        throw new NotFoundException(`Plan "${req.targetPlan}" no encontrado`);

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
      req.tenantId,
      processedBy,
      'subscription_request.approved',
      'subscription_request',
      req.id,
      {
        type: req.type,
        targetPlan: req.targetPlan,
        prorationCredit: credit,
        // Fase 2 / Tarea 2.4.1 — referencia a la NC auto-emitida (si aplica).
        creditNoteId: creditNoteIssuedId,
        creditNoteNumber: creditNoteIssuedNumber,
      },
    );
  }

  /** Super admin rejects a request. */
  async rejectRequest(
    requestId: string,
    processedBy: string,
    reason: string,
  ): Promise<void> {
    const req = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Solicitud no encontrada');
    if (req.status !== 'pending')
      throw new ConflictException('La solicitud ya fue procesada');

    req.status = 'rejected';
    req.processedBy = processedBy;
    req.processedAt = new Date();
    req.rejectionReason = reason || 'Sin motivo especificado';
    await this.requestRepo.save(req);

    await this.auditService.log(
      req.tenantId,
      processedBy,
      'subscription_request.rejected',
      'subscription_request',
      req.id,
      { type: req.type, reason: req.rejectionReason },
    );
  }

  /** Tenant admin toggles auto-renew on their active subscription. */
  async toggleAutoRenew(tenantId: string, autoRenew: boolean): Promise<void> {
    const sub = await this.findByTenantId(tenantId);
    if (!sub)
      throw new NotFoundException(
        'No hay suscripción activa para esta organización',
      );
    sub.autoRenew = autoRenew;
    await this.subRepo.save(sub);
    this.logger.log(
      `[AutoRenew] Tenant ${tenantId} set autoRenew=${autoRenew} on subscription ${sub.id}`,
    );
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
  async processAutoRenewals(): Promise<{
    renewed: number;
    suspended: number;
    invoicesGenerated: number;
    invoiceErrors: number;
  }> {
    const now = new Date();
    let renewed = 0;
    let suspended = 0;
    let invoicesGenerated = 0;
    let invoiceErrors = 0;

    // Find active subscriptions past their billing date.
    // Fase 3 / Tarea 3.5.4 — PAUSED EXCLUIDO explicitamente: las subs
    // pausadas no facturan ni entran a dunning. El cron de
    // processScheduledResumes las reactiva cuando llegue resumeAt.
    const overdue = await this.subRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.plan', 'p')
      .where('s.status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere('s.next_billing_date IS NOT NULL')
      .andWhere('s.next_billing_date <= :now', { now })
      .getMany();

    for (const sub of overdue) {
      if (sub.autoRenew) {
        // Fase 0 / Tarea 0.2.2 — ORDER MATTERS:
        //   1. Generar factura del nuevo periodo PRIMERO.
        //   2. Solo si la factura se genero OK, avanzar nextBillingDate.
        //
        // Pre-fix: el cron avanzaba nextBillingDate sin generar factura,
        // dejando el ciclo recurrente roto (super_admin debia clickear
        // "Generar facturas del periodo" manualmente). Pero ademas, si
        // hubieramos avanzado primero y la generacion fallaba, el next
        // cron run no encontraria la sub como overdue (next_billing_date
        // > now) y ese periodo NUNCA se facturaria. Por eso generar
        // primero: si falla, log + skip; el proximo cron lo reintenta.
        //
        // generateInvoice ya usa continuidad historica (Tarea 0.1.1), por
        // lo que cubre `[lastInvoice.periodEnd, +1 ciclo]` correctamente
        // sin depender de nextBillingDate.
        let invoiceResult: { id: string; invoiceNumber: string; total: number } | null =
          null;
        try {
          const generated = await this.invoicesService.generateInvoice(
            sub.id,
            'system',
          );
          invoiceResult = {
            id: generated.id,
            invoiceNumber: generated.invoiceNumber,
            total: Number(generated.total),
          };
          invoicesGenerated++;
        } catch (err: any) {
          invoiceErrors++;
          this.logger.error(
            `[AutoRenew] generateInvoice failed for subscription ${sub.id} (tenant ${sub.tenantId}): ${err?.message || err}`,
          );
          await this.auditService
            .log(
              sub.tenantId,
              'system',
              'subscription.renewal_invoice_failed',
              'subscription',
              sub.id,
              {
                error: String(err?.message || err).slice(0, 500),
                billingPeriod: sub.billingPeriod,
                nextBillingDate: sub.nextBillingDate?.toISOString?.() || null,
              },
            )
            .catch(() => undefined);
          // SKIP el avance de nextBillingDate: el proximo cron run vera
          // la sub aun overdue y reintentara. Si el error es persistente
          // (plan sin precio, etc.), super_admin tiene que intervenir.
          continue;
        }

        // Fase 3 / Tarea 1.3 (reincorporada) — Intentar cobro automatico
        // off-session con la tarjeta default del tenant. Si tiene
        // metodo activo y succeed, marcamos la invoice como PAID y el
        // tenant evita el flow de pago manual. Si no hay metodo o el
        // cobro falla, dejamos la invoice en DRAFT/SENT y el cron de
        // dunning + email de aviso se encargaran.
        try {
          const chargeResult = await this.paymentMethodsService.chargeWithDefault({
            tenantId: sub.tenantId,
            // Invoice total -> CLP conversion la hace el chargeStored
            // si la moneda no es CLP. Aqui pasamos el valor en la
            // moneda de la invoice; provider convierte si es UF/USD.
            amount: invoiceResult.total,
            currency: 'CLP', // TODO multi-currency Fase 5
            description: `Eva360 — Factura ${invoiceResult.invoiceNumber}`,
            metadata: {
              tenant_id: sub.tenantId,
              subscription_id: sub.id,
              invoice_id: invoiceResult.id,
              invoice_number: invoiceResult.invoiceNumber,
              source: 'auto_renewal_charge',
            },
            // Idempotency deterministica: misma invoice -> mismo key
            // -> Stripe retorna el cargo existente sin duplicar.
            idempotencyKey: `auto-renew-${invoiceResult.id}`,
          });
          if (chargeResult && chargeResult.status === 'succeeded') {
            // Cobro OK: marcar invoice PAID.
            await this.invoicesService.markAsPaid(
              invoiceResult.id,
              {
                paymentMethod: 'stripe_auto',
                transactionRef: chargeResult.chargeId,
                notes: 'Cobro automatico con tarjeta default en renovacion.',
              },
              'system',
            );
            this.logger.log(
              `[AutoRenew] tenant=${sub.tenantId} invoice=${invoiceResult.invoiceNumber} cobrado automaticamente (charge=${chargeResult.chargeId}).`,
            );
            await this.auditService
              .log(sub.tenantId, 'system', 'invoice.auto_charged', 'invoice', invoiceResult.id, {
                chargeId: chargeResult.chargeId,
                amount: invoiceResult.total,
              })
              .catch(() => undefined);
          } else if (chargeResult && chargeResult.status === 'requires_action') {
            // Stripe pide 3DS interactivo — cliente debe completar manual.
            // Dejamos la invoice DRAFT y email normal lo notificara.
            this.logger.warn(
              `[AutoRenew] tenant=${sub.tenantId} invoice=${invoiceResult.invoiceNumber} requiere autenticacion 3DS — fallback a flow manual.`,
            );
          } else if (chargeResult && chargeResult.status === 'failed') {
            // Tarjeta declinada / expirada / fondos insuficientes.
            this.logger.warn(
              `[AutoRenew] tenant=${sub.tenantId} invoice=${invoiceResult.invoiceNumber} cobro automatico fallido: ${chargeResult.failureReason}`,
            );
            await this.auditService
              .log(sub.tenantId, 'system', 'invoice.auto_charge_failed', 'invoice', invoiceResult.id, {
                reason: chargeResult.failureReason,
              })
              .catch(() => undefined);
          }
          // chargeResult=null: tenant no tiene metodo default, flow manual.
        } catch (chargeErr: any) {
          // Error inesperado del provider — no bloquea la renovacion,
          // la invoice queda en DRAFT esperando pago manual.
          this.logger.error(
            `[AutoRenew] cobro automatico arrojo error para invoice ${invoiceResult.invoiceNumber}: ${chargeErr?.message || chargeErr}`,
          );
        }

        // Auto-renew: advance billing date forward (post-invoice success)
        let nextDate = this.calculateNextBillingDate(
          sub.nextBillingDate!,
          sub.billingPeriod || BillingPeriod.MONTHLY,
        );
        // Ensure it's in the future
        while (nextDate <= now) {
          nextDate = this.calculateNextBillingDate(
            nextDate,
            sub.billingPeriod || BillingPeriod.MONTHLY,
          );
        }
        sub.nextBillingDate = nextDate;
        await this.subRepo.save(sub);
        renewed++;

        // Fase 0 / Tarea 0.2.3 — Audit log de renovacion exitosa con
        // referencia a la factura generada. Util para reconciliacion
        // contable (saber que invoice corresponde a que renovacion).
        await this.auditService
          .log(
            sub.tenantId,
            'system',
            'subscription.renewed_invoice_generated',
            'subscription',
            sub.id,
            {
              invoiceId: invoiceResult.id,
              invoiceNumber: invoiceResult.invoiceNumber,
              total: invoiceResult.total,
              nextBillingDate: nextDate.toISOString(),
              billingPeriod: sub.billingPeriod,
            },
          )
          .catch(() => undefined);

        this.logger.log(
          `[AutoRenew] Subscription ${sub.id} (tenant ${sub.tenantId}) renewed, invoice ${invoiceResult.invoiceNumber} generated, next billing: ${nextDate.toISOString().split('T')[0]}`,
        );
      } else {
        // No auto-renew: suspend the subscription
        const previousStatus = sub.status;
        sub.status = SubscriptionStatus.SUSPENDED;
        await this.subRepo.save(sub);
        suspended++;

        await this.auditService.log(
          sub.tenantId,
          'system',
          'subscription.auto_suspended',
          'subscription',
          sub.id,
          {
            reason:
              'Auto-renovación desactivada y fecha de facturación vencida',
            previousStatus,
          },
        );

        this.logger.log(
          `[AutoRenew] Subscription ${sub.id} (tenant ${sub.tenantId}) SUSPENDED — autoRenew is off`,
        );
      }
    }

    return { renewed, suspended, invoicesGenerated, invoiceErrors };
  }

  // ─── AI Add-on Packs ──────────────────────────────────────────────────

  /** Available AI packs for purchase */
  getAiPacks(): {
    id: string;
    name: string;
    calls: number;
    monthlyPrice: number;
    currency: string;
  }[] {
    return [
      {
        id: 'ai-pack-50',
        name: '+50 análisis IA / mes',
        calls: 50,
        monthlyPrice: 0.5,
        currency: 'UF',
      },
      {
        id: 'ai-pack-100',
        name: '+100 análisis IA / mes',
        calls: 100,
        monthlyPrice: 0.8,
        currency: 'UF',
      },
      {
        id: 'ai-pack-250',
        name: '+250 análisis IA / mes',
        calls: 250,
        monthlyPrice: 1.5,
        currency: 'UF',
      },
      {
        id: 'ai-pack-500',
        name: '+500 análisis IA / mes',
        calls: 500,
        monthlyPrice: 2.5,
        currency: 'UF',
      },
    ];
  }

  /** Purchase, upgrade, downgrade or cancel AI pack for a tenant */
  async setAiAddon(
    tenantId: string,
    packId: string | null,
    approvedBy: string,
  ): Promise<{ subscription: Subscription; pack: any }> {
    const sub = await this.findByTenantId(tenantId);
    if (!sub)
      throw new NotFoundException('No se encontró una suscripción activa');

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
    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: ['id', 'name'],
    });
    const orgName = tenant?.name || 'Organización';

    // Helper: notify super_admins
    const notifySA = async (title: string, message: string) => {
      const superAdmins = await this.userRepo.find({
        where: { role: 'super_admin', isActive: true },
        select: ['id'],
      });
      for (const sa of superAdmins) {
        await this.notificationsService
          .create({
            tenantId,
            userId: sa.id,
            type: NotificationType.GENERAL,
            title,
            message,
          })
          .catch(() => {});
      }
    };

    // ═══ CANCEL (Sin add-on) ═══
    if (!packId || packId === 'none') {
      sub.aiAddonCalls = 0;
      sub.aiAddonPrice = 0;
      sub.aiAddonUsed = 0; // Reset counter for future re-purchase

      // If credits were used, register a pending charge for the full period
      if (hadAddon && addonUsed > 0) {
        await this.paymentRepo.save(
          this.paymentRepo.create({
            tenantId,
            subscriptionId: sub.id,
            amount: previousPrice,
            currency,
            billingPeriod: sub.billingPeriod || BillingPeriod.MONTHLY,
            periodStart: billingBase,
            periodEnd,
            status: PaymentStatus.PENDING,
            concept: `Add-on IA +${previousCalls}/mes (cancelado con ${addonUsed} créditos usados — cobro completo del período)`,
            isAddon: true,
            paidAt: null,
          }),
        );
        await notifySA(
          `Add-on IA cancelado: ${orgName}`,
          `${orgName} canceló add-on IA (+${previousCalls}/mes, ${previousPrice} ${currency}). Se usaron ${addonUsed} créditos — cobro completo del período registrado.`,
        );
      }
      await this.subRepo.save(sub);
      await this.auditService
        .log(
          tenantId,
          approvedBy,
          'subscription.ai_addon_removed',
          'subscription',
          sub.id,
          {
            previousCalls,
            previousPrice,
            addonUsed,
            chargedFull: hadAddon && addonUsed > 0,
          },
        )
        .catch(() => {});
      return { subscription: sub, pack: null };
    }

    // ═══ PURCHASE / UPGRADE / DOWNGRADE ═══
    const packs = this.getAiPacks();
    const pack = packs.find((p) => p.id === packId);
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
      await this.paymentRepo.save(
        this.paymentRepo.create({
          tenantId,
          subscriptionId: sub.id,
          amount: previousPrice,
          currency,
          billingPeriod: sub.billingPeriod || BillingPeriod.MONTHLY,
          periodStart: billingBase,
          periodEnd,
          status: PaymentStatus.PENDING,
          concept: `Add-on IA +${previousCalls}/mes → +${pack.calls}/mes (upgrade — ${addonUsed} créditos usados, cobro pack anterior)`,
          isAddon: true,
          paidAt: null,
        }),
      );
    }

    // Apply new pack — reset usage counter on upgrade (already charged) and new purchase
    sub.aiAddonCalls = pack.calls;
    sub.aiAddonPrice = pack.monthlyPrice;
    sub.aiAddonUsed = 0; // Always reset: upgrade already charged, new purchase starts fresh, downgrade keeps remaining
    await this.subRepo.save(sub);

    const action = isUpgrade
      ? 'upgraded'
      : isDowngrade
        ? 'downgraded'
        : 'purchased';
    await this.auditService
      .log(
        tenantId,
        approvedBy,
        `subscription.ai_addon_${action}`,
        'subscription',
        sub.id,
        {
          pack: pack.name,
          calls: pack.calls,
          price: pack.monthlyPrice,
          previousCalls,
          previousPrice,
          addonUsed,
          action,
        },
      )
      .catch(() => {});

    const actionLabel = isUpgrade
      ? 'Upgrade'
      : isDowngrade
        ? 'Downgrade'
        : 'Compra';
    await notifySA(
      `${actionLabel} Add-on IA: ${orgName}`,
      `${orgName} ${isUpgrade ? `subió de +${previousCalls} a` : isDowngrade ? `bajó de +${previousCalls} a` : 'adquirió'} "${pack.name}" (${pack.monthlyPrice} ${currency}/mes).${addonUsed > 0 ? ` ${addonUsed} créditos usados del pack anterior.` : ''}`,
    );

    return { subscription: sub, pack };
  }

  /** Get current AI addon for a tenant */
  async getAiAddon(
    tenantId: string,
  ): Promise<{ calls: number; price: number; packId: string | null }> {
    const sub = await this.findByTenantId(tenantId);
    if (!sub) return { calls: 0, price: 0, packId: null };
    const packs = this.getAiPacks();
    const currentPack = packs.find((p) => p.calls === sub.aiAddonCalls) || null;
    return {
      calls: sub.aiAddonCalls || 0,
      price: Number(sub.aiAddonPrice) || 0,
      packId: currentPack?.id || null,
    };
  }
}
