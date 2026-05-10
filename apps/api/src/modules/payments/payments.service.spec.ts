/**
 * payments.service.spec.ts — Tests del PaymentsService.
 *
 * Foco actual (Fase 0 / Tarea 0.4): handlers de payment.refunded y
 * payment.disputed introducidos para diferenciar refunds y chargebacks
 * de simples cancelaciones (que era el comportamiento buggy pre-fix
 * en mercadopago-provider.ts:187).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentsService } from './payments.service';
import { PaymentSession } from './entities/payment-session.entity';
import { Invoice } from '../subscriptions/entities/invoice.entity';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { StripeProvider } from './providers/stripe-provider';
import { MercadoPagoProvider } from './providers/mercadopago-provider';
import { InvoicesService } from '../subscriptions/invoices.service';
import { EmailService } from '../notifications/email.service';
import { AuditService } from '../audit/audit.service';
import {
  createMockRepository,
  createMockAuditService,
  createMockEmailService,
  fakeUuid,
} from '../../../test/test-utils';

describe('PaymentsService — applyWebhookEvent (Fase 0 / Tarea 0.4)', () => {
  let service: PaymentsService;
  let sessionRepo: any;
  let auditService: any;

  const tenantId = fakeUuid(100);
  const sessionId = fakeUuid(500);
  const invoiceId = fakeUuid(600);

  beforeEach(async () => {
    sessionRepo = createMockRepository();
    auditService = createMockAuditService();

    // applyPaymentRefunded/Disputed usan createQueryBuilder().update().set().where().execute()
    // — devolver affected:1 simulando lock conseguido.
    const updateQb: any = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    sessionRepo.createQueryBuilder = jest.fn().mockReturnValue(updateQb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(PaymentSession), useValue: sessionRepo },
        { provide: getRepositoryToken(Invoice), useValue: createMockRepository() },
        { provide: getRepositoryToken(User), useValue: createMockRepository() },
        { provide: getRepositoryToken(Tenant), useValue: createMockRepository() },
        {
          provide: StripeProvider,
          useValue: { name: 'stripe', isEnabled: false } as any,
        },
        {
          provide: MercadoPagoProvider,
          useValue: { name: 'mercadopago', isEnabled: false } as any,
        },
        {
          provide: InvoicesService,
          useValue: { markAsPaid: jest.fn() },
        },
        { provide: EmailService, useValue: createMockEmailService() },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  function buildSession(overrides: Record<string, any> = {}) {
    return {
      id: sessionId,
      tenantId,
      invoiceId,
      initiatedBy: fakeUuid(200),
      provider: 'stripe' as const,
      externalId: 'ext_abc',
      status: 'paid',
      amount: '11.90',
      currency: 'CLP',
      metadata: {},
      ...overrides,
    };
  }

  // ─── payment.refunded ──────────────────────────────────────────────

  describe('payment.refunded', () => {
    it('transitions paid -> refunded and audits payment.refunded', async () => {
      sessionRepo.findOne.mockResolvedValue(buildSession({ status: 'paid' }));

      const result = await service.applyWebhookEvent('stripe', {
        type: 'payment.refunded',
        externalId: 'ext_abc',
        amount: 5000,
        currency: 'CLP',
      });

      expect(result.handled).toBe(true);
      expect(auditService.log).toHaveBeenCalledWith(
        tenantId,
        expect.any(String),
        'payment.refunded',
        'PaymentSession',
        sessionId,
        expect.objectContaining({
          provider: 'stripe',
          invoiceId,
          amount: 5000,
          requiresManualCreditNote: true,
        }),
      );
    });

    it('rejects refund on a non-paid session', async () => {
      sessionRepo.findOne.mockResolvedValue(buildSession({ status: 'pending' }));

      const result = await service.applyWebhookEvent('stripe', {
        type: 'payment.refunded',
        externalId: 'ext_abc',
      });

      expect(result.handled).toBe(false);
      expect(result.reason).toContain('non-paid');
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('idempotent: refunded session receiving payment.refunded again is noop', async () => {
      sessionRepo.findOne.mockResolvedValue(buildSession({ status: 'refunded' }));

      const result = await service.applyWebhookEvent('stripe', {
        type: 'payment.refunded',
        externalId: 'ext_abc',
      });

      expect(result.handled).toBe(true);
      // No audit log porque el fast-path retorna antes.
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  // ─── payment.disputed ──────────────────────────────────────────────

  describe('payment.disputed', () => {
    it('transitions paid -> disputed and audits payment.disputed with requiresImmediateAction', async () => {
      sessionRepo.findOne.mockResolvedValue(buildSession({ status: 'paid' }));

      const result = await service.applyWebhookEvent('mercadopago', {
        type: 'payment.disputed',
        externalId: 'ext_abc',
        amount: 12345,
        currency: 'CLP',
        failureReason: 'fraudulent',
      });

      expect(result.handled).toBe(true);
      expect(auditService.log).toHaveBeenCalledWith(
        tenantId,
        expect.any(String),
        'payment.disputed',
        'PaymentSession',
        sessionId,
        expect.objectContaining({
          provider: 'mercadopago',
          reason: 'fraudulent',
          requiresImmediateAction: true,
        }),
      );
    });

    it('rejects dispute on a never-paid session', async () => {
      sessionRepo.findOne.mockResolvedValue(buildSession({ status: 'failed' }));

      const result = await service.applyWebhookEvent('stripe', {
        type: 'payment.disputed',
        externalId: 'ext_abc',
        failureReason: 'fraud',
      });

      expect(result.handled).toBe(false);
      expect(result.reason).toContain('non-paid');
    });

    it('concurrent webhook losing the lock returns noop without duplicate audit', async () => {
      sessionRepo.findOne.mockResolvedValue(buildSession({ status: 'paid' }));
      // Simulate la query UPDATE pierde el lock (otro webhook lo gano).
      const updateQb: any = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      sessionRepo.createQueryBuilder = jest.fn().mockReturnValue(updateQb);

      const result = await service.applyWebhookEvent('stripe', {
        type: 'payment.disputed',
        externalId: 'ext_abc',
      });

      expect(result.handled).toBe(true);
      expect(result.reason).toContain('concurrent');
      // No audit duplicado.
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  // ─── Cross-cutting ─────────────────────────────────────────────────

  it('returns handled=false when externalId has no matching session', async () => {
    sessionRepo.findOne.mockResolvedValue(null);

    const result = await service.applyWebhookEvent('stripe', {
      type: 'payment.refunded',
      externalId: 'unknown_id',
    });

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('session not found');
  });
});
