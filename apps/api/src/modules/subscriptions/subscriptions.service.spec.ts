/**
 * subscriptions.service.spec.ts — Tests unitarios del SubscriptionsService.
 *
 * Cubre:
 * - findPlanById: cache hit/miss, plan no encontrado
 * - createPlan: duplicado de código
 * - create subscription: plan válido requerido, cancel subs anteriores
 * - findMySubscription: devuelve suscripción con plan
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Subscription } from './entities/subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { SubscriptionRequest } from './entities/subscription-request.entity';
import { PaymentHistory } from './entities/payment-history.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';
import { SubscriptionsService } from './subscriptions.service';
import { InvoicesService } from './invoices.service';
import {
  createMockRepository,
  createMockAuditService,
  createMockEmailService,
  createMockNotificationsService,
  createMockCacheManager,
  createMockPlan,
  fakeUuid,
} from '../../../test/test-utils';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let planRepo: any;
  let subRepo: any;
  let tenantRepo: any;
  let cacheManager: any;
  let invoicesService: any;
  let auditService: any;

  beforeEach(async () => {
    planRepo = createMockRepository();
    subRepo = createMockRepository();
    tenantRepo = createMockRepository();
    cacheManager = createMockCacheManager();

    // Fase 0 / Tarea 0.2.1 — InvoicesService ahora es dep de
    // SubscriptionsService (forwardRef) para que processAutoRenewals
    // pueda generar facturas. Mock con generateInvoice() para tests
    // del cron.
    invoicesService = {
      generateInvoice: jest.fn().mockResolvedValue({
        id: fakeUuid(700),
        invoiceNumber: 'EVA-2026-0001',
        total: 11.9,
      }),
    };
    auditService = createMockAuditService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: getRepositoryToken(Subscription), useValue: subRepo },
        { provide: getRepositoryToken(SubscriptionPlan), useValue: planRepo },
        { provide: getRepositoryToken(SubscriptionRequest), useValue: createMockRepository() },
        { provide: getRepositoryToken(PaymentHistory), useValue: createMockRepository() },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(User), useValue: createMockRepository() },
        { provide: getRepositoryToken(EvaluationCycle), useValue: createMockRepository() },
        { provide: AuditService, useValue: auditService },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
        // Pre-fix Fase 1: agregado EmailService (constructor lo inyecta para
        // emails de welcome/cancelacion). Pre-existente, no causado por Fase 1.
        { provide: EmailService, useValue: createMockEmailService() },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: CACHE_MANAGER, useValue: cacheManager },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
  });

  // ─── findPlanById ──────────────────────────────────────────────────

  describe('findPlanById', () => {
    it('should throw NotFoundException if plan does not exist', async () => {
      planRepo.findOne.mockResolvedValue(null);

      await expect(service.findPlanById(fakeUuid(999))).rejects.toThrow(NotFoundException);
    });

    it('should return plan when found', async () => {
      const plan = createMockPlan();
      planRepo.findOne.mockResolvedValue(plan);

      const result = await service.findPlanById(plan.id);

      expect(result.name).toBe('Pro');
      expect(result.code).toBe('pro');
    });

    it('should use cache on second call', async () => {
      const plan = createMockPlan();
      planRepo.findOne.mockResolvedValue(plan);

      // First call — cache miss, hits DB
      await service.findPlanById(plan.id);
      expect(planRepo.findOne).toHaveBeenCalledTimes(1);

      // Second call — should hit cache (findOne NOT called again)
      await service.findPlanById(plan.id);
      // Cache stores by key `plan:${id}`, so second call should NOT hit repo
      // Note: our mock cache actually stores, so findOne stays at 1
      expect(planRepo.findOne).toHaveBeenCalledTimes(1);
    });
  });

  // ─── createPlan ────────────────────────────────────────────────────

  describe('createPlan', () => {
    it('should throw ConflictException if plan code already exists', async () => {
      planRepo.findOne.mockResolvedValue(createMockPlan());

      await expect(
        service.createPlan({ name: 'New Plan', code: 'pro' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create plan when code is unique', async () => {
      planRepo.findOne.mockResolvedValue(null); // no existing plan with code
      planRepo.save.mockImplementation((entity: any) => Promise.resolve({ id: fakeUuid(500), ...entity }));

      const result = await service.createPlan({
        name: 'New Plan',
        code: 'new-plan',
        maxEmployees: 100,
        monthlyPrice: 2.0,
      });

      expect(result.name).toBe('New Plan');
      expect(result.code).toBe('new-plan');
      expect(planRepo.save).toHaveBeenCalled();
    });
  });

  // ─── findByTenantId ────────────────────────────────────────────────

  describe('findByTenantId', () => {
    it('should return null if no active subscription found', async () => {
      subRepo.find.mockResolvedValue([]);

      const result = await service.findByTenantId(fakeUuid(100));

      expect(result).toBeNull();
    });

    it('should return the active subscription with plan', async () => {
      const sub = {
        id: fakeUuid(600),
        tenantId: fakeUuid(100),
        status: 'active',
        plan: createMockPlan(),
        tenant: { id: fakeUuid(100), name: 'Demo' },
        createdAt: new Date(),
      };
      subRepo.find.mockResolvedValue([sub]);

      const result = await service.findByTenantId(fakeUuid(100));

      expect(result).toBeDefined();
      expect(result!.status).toBe('active');
      expect(result!.plan.name).toBe('Pro');
    });
  });

  // ─── updatePlan ────────────────────────────────────────────────────

  describe('updatePlan', () => {
    it('should update plan and invalidate cache', async () => {
      const plan = createMockPlan();
      planRepo.findOne.mockResolvedValue(plan);
      planRepo.save.mockResolvedValue({ ...plan, name: 'Updated Pro' });

      const result = await service.updatePlan(plan.id, { name: 'Updated Pro' });

      expect(result.name).toBe('Updated Pro');
      // Verify cache was invalidated
      expect(cacheManager.del).toHaveBeenCalledWith(`plan:${plan.id}`);
    });
  });

  // ─── processAutoRenewals (Fase 0 / Tarea 0.2) ──────────────────────

  describe('processAutoRenewals', () => {
    /**
     * Helper: configura el queryBuilder mock de subRepo para retornar
     * la lista de subs vencidas. processAutoRenewals usa
     * `createQueryBuilder(...).where(...).andWhere(...).getMany()`.
     */
    function mockOverdueSubs(subs: any[]) {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(subs),
      };
      subRepo.createQueryBuilder.mockReturnValue(qb);
    }

    function buildSub(overrides: Record<string, any> = {}) {
      return {
        id: fakeUuid(601),
        tenantId: fakeUuid(100),
        plan: createMockPlan(),
        billingPeriod: 'monthly',
        startDate: new Date('2026-04-01'),
        nextBillingDate: new Date('2026-05-01'), // ya vencida
        autoRenew: true,
        status: 'active',
        ...overrides,
      };
    }

    it('generates invoice and advances nextBillingDate when autoRenew=true', async () => {
      const sub = buildSub();
      mockOverdueSubs([sub]);

      const result = await service.processAutoRenewals();

      expect(invoicesService.generateInvoice).toHaveBeenCalledWith(sub.id, 'system');
      expect(invoicesService.generateInvoice).toHaveBeenCalledTimes(1);
      expect(result.renewed).toBe(1);
      expect(result.invoicesGenerated).toBe(1);
      expect(result.invoiceErrors).toBe(0);
      expect(result.suspended).toBe(0);
      // nextBillingDate fue avanzado
      expect(subRepo.save).toHaveBeenCalled();
      const savedSub = subRepo.save.mock.calls[0][0];
      expect(savedSub.nextBillingDate.getTime()).toBeGreaterThan(
        new Date('2026-05-01').getTime(),
      );
    });

    it('does NOT advance nextBillingDate if generateInvoice fails (so next cron retries)', async () => {
      const sub = buildSub();
      mockOverdueSubs([sub]);
      // Simulate falla persistente (e.g. plan sin precio)
      invoicesService.generateInvoice.mockRejectedValueOnce(
        new Error('plan sin precio configurado'),
      );

      const result = await service.processAutoRenewals();

      expect(result.invoiceErrors).toBe(1);
      expect(result.invoicesGenerated).toBe(0);
      expect(result.renewed).toBe(0); // NO incrementado
      // subRepo.save NO debe haber sido llamado para esta sub —
      // significa que nextBillingDate NO se avanzo y el proximo cron run
      // la encontrara aun overdue para reintento.
      expect(subRepo.save).not.toHaveBeenCalled();
      // Audit log de fallo registrado.
      expect(auditService.log).toHaveBeenCalledWith(
        sub.tenantId,
        'system',
        'subscription.renewal_invoice_failed',
        'subscription',
        sub.id,
        expect.objectContaining({ error: expect.stringContaining('sin precio') }),
      );
    });

    it('audits subscription.renewed_invoice_generated with invoice number on success', async () => {
      const sub = buildSub();
      mockOverdueSubs([sub]);
      invoicesService.generateInvoice.mockResolvedValueOnce({
        id: fakeUuid(701),
        invoiceNumber: 'EVA-2026-0042',
        total: 23.45,
      });

      await service.processAutoRenewals();

      expect(auditService.log).toHaveBeenCalledWith(
        sub.tenantId,
        'system',
        'subscription.renewed_invoice_generated',
        'subscription',
        sub.id,
        expect.objectContaining({
          invoiceNumber: 'EVA-2026-0042',
          total: 23.45,
        }),
      );
    });

    it('suspends sub (no invoice) when autoRenew=false', async () => {
      const sub = buildSub({ autoRenew: false });
      mockOverdueSubs([sub]);

      const result = await service.processAutoRenewals();

      expect(invoicesService.generateInvoice).not.toHaveBeenCalled();
      expect(result.suspended).toBe(1);
      expect(result.renewed).toBe(0);
      expect(result.invoicesGenerated).toBe(0);
      expect(auditService.log).toHaveBeenCalledWith(
        sub.tenantId,
        'system',
        'subscription.auto_suspended',
        'subscription',
        sub.id,
        expect.any(Object),
      );
    });

    it('isolates failures: bad sub does not block good ones in same batch', async () => {
      const goodSub = buildSub({ id: fakeUuid(602) });
      const badSub = buildSub({ id: fakeUuid(603) });
      mockOverdueSubs([badSub, goodSub]);
      invoicesService.generateInvoice
        .mockRejectedValueOnce(new Error('boom')) // primera (badSub) falla
        .mockResolvedValueOnce({
          id: fakeUuid(800),
          invoiceNumber: 'EVA-2026-0099',
          total: 11.9,
        });

      const result = await service.processAutoRenewals();

      expect(result.renewed).toBe(1); // solo goodSub
      expect(result.invoicesGenerated).toBe(1);
      expect(result.invoiceErrors).toBe(1);
    });
  });
});
