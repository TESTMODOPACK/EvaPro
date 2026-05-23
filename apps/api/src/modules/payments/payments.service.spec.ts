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
  let invoiceRepo: any;
  let auditService: any;
  let invoicesService: any;
  let stripeProvider: any;
  let mercadopagoProvider: any;

  const tenantId = fakeUuid(100);
  const sessionId = fakeUuid(500);
  const invoiceId = fakeUuid(600);

  beforeEach(async () => {
    sessionRepo = createMockRepository();
    invoiceRepo = createMockRepository();
    auditService = createMockAuditService();

    // applyPaymentRefunded/Disputed usan createQueryBuilder().update().set().where().execute()
    // — devolver affected:1 simulando lock conseguido.
    const updateQb: any = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    sessionRepo.createQueryBuilder = jest.fn().mockReturnValue(updateQb);

    // Fase 2 / Tarea 2.3 — InvoicesService mock incluye issueCreditNote
    // (necesario para applyPaymentRefunded webhook-originated y para
    // refundInvoice manual). Default: retorna una credit note exitosa.
    invoicesService = {
      markAsPaid: jest.fn(),
      issueCreditNote: jest.fn().mockResolvedValue({
        id: fakeUuid(800),
        invoiceNumber: 'EVA-NC-2026-0001',
        total: 11.9,
      }),
    };

    stripeProvider = {
      name: 'stripe',
      isEnabled: true,
      refundPayment: jest.fn().mockResolvedValue({
        refundId: 're_test_123',
        status: 'succeeded',
        amount: 1190,
        currency: 'CLP',
      }),
    };
    mercadopagoProvider = { name: 'mercadopago', isEnabled: false };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(PaymentSession), useValue: sessionRepo },
        { provide: getRepositoryToken(Invoice), useValue: invoiceRepo },
        { provide: getRepositoryToken(User), useValue: createMockRepository() },
        { provide: getRepositoryToken(Tenant), useValue: createMockRepository() },
        { provide: StripeProvider, useValue: stripeProvider as any },
        { provide: MercadoPagoProvider, useValue: mercadopagoProvider as any },
        { provide: InvoicesService, useValue: invoicesService },
        { provide: EmailService, useValue: createMockEmailService() },
        { provide: AuditService, useValue: auditService },
        // Fase 3 / Tarea 3.4 — PaymentMethodsService usado por
        // applyPaymentMethodWebhook (eventos setup_intent.* y
        // payment_method.detached).
        {
          provide: require('./payment-methods.service').PaymentMethodsService,
          useValue: {
            confirmFromWebhook: jest.fn().mockResolvedValue(undefined),
            handleDetachedFromWebhook: jest.fn().mockResolvedValue(undefined),
          },
        },
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
      // Fase 2 / Tarea 2.3.5 — el handler ahora auto-emite credit note
      // cuando el webhook llega primero. El audit incluye creditNoteId
      // y manualRefund=false (refund originado en provider, no Eva360).
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
          manualRefund: false,
          requiresManualCreditNote: false,
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
        setParameter: jest.fn().mockReturnThis(),
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

  // ─── Fase 2 / Tarea 2.3 — Refund flow ──────────────────────────────

  describe('applyPaymentRefunded (webhook-originated, Tarea 2.3.5)', () => {
    it('webhook llega primero: emite credit note auto y audita manualRefund=false', async () => {
      sessionRepo.findOne.mockResolvedValue(buildSession({ status: 'paid' }));

      await service.applyWebhookEvent('stripe', {
        type: 'payment.refunded',
        externalId: 'ext_abc',
        amount: 11.9,
        currency: 'CLP',
      });

      expect(invoicesService.issueCreditNote).toHaveBeenCalledWith(
        invoiceId,
        expect.objectContaining({
          amount: 11.9,
          reason: expect.stringContaining('Refund recibido via webhook'),
        }),
        'system',
        tenantId,
      );
      expect(auditService.log).toHaveBeenCalledWith(
        tenantId,
        expect.any(String),
        'payment.refunded',
        'PaymentSession',
        sessionId,
        expect.objectContaining({
          manualRefund: false,
          creditNoteNumber: 'EVA-NC-2026-0001',
          requiresManualCreditNote: false,
        }),
      );
    });

    it('refund manual primero (session ya en refunded): webhook noop y NO emite NC duplicada', async () => {
      sessionRepo.findOne.mockResolvedValue(buildSession({ status: 'paid' }));
      // Simulate la atomic UPDATE pierde el lock (refund manual ya
      // habia transitionado).
      const updateQb: any = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      sessionRepo.createQueryBuilder = jest.fn().mockReturnValue(updateQb);

      const result = await service.applyWebhookEvent('stripe', {
        type: 'payment.refunded',
        externalId: 'ext_abc',
        amount: 11.9,
      });

      expect(result.handled).toBe(true);
      expect(result.reason).toContain('refund already processed manually');
      // CLAVE: NO se llama issueCreditNote (la NC ya existe del refund manual).
      expect(invoicesService.issueCreditNote).not.toHaveBeenCalled();
    });

    it('webhook OK pero issueCreditNote falla: audit invoice.credit_note_pending_manual', async () => {
      sessionRepo.findOne.mockResolvedValue(buildSession({ status: 'paid' }));
      invoicesService.issueCreditNote.mockRejectedValueOnce(
        new Error('invoice no en PAID — no se puede credit'),
      );

      await service.applyWebhookEvent('stripe', {
        type: 'payment.refunded',
        externalId: 'ext_abc',
        amount: 11.9,
      });

      expect(auditService.log).toHaveBeenCalledWith(
        tenantId,
        null,
        'invoice.credit_note_pending_manual',
        'invoice',
        invoiceId,
        expect.objectContaining({ requiresImmediateAction: true }),
      );
    });
  });

  describe('refundInvoice (manual, Tarea 2.3.3)', () => {
    function setupPaidInvoice() {
      invoiceRepo.findOne.mockResolvedValue({
        id: invoiceId,
        tenantId,
        status: 'paid',
        total: 11.9,
        currency: 'CLP',
      });
      sessionRepo.findOne.mockResolvedValue(
        buildSession({ status: 'paid', externalId: 'cs_test_123' }),
      );
    }

    it('happy path: llama provider, marca session refunded, emite NC, audita manualRefund=true', async () => {
      setupPaidInvoice();

      const result = await service.refundInvoice(
        invoiceId,
        { reason: 'Cliente solicito reembolso' },
        fakeUuid(200),
      );

      expect(stripeProvider.refundPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          externalChargeId: 'cs_test_123',
          amount: 11.9,
          reason: 'Cliente solicito reembolso',
          idempotencyKey: expect.any(String),
        }),
      );
      expect(invoicesService.issueCreditNote).toHaveBeenCalled();
      expect(result.refundId).toBe('re_test_123');
      expect(result.creditNoteNumber).toBe('EVA-NC-2026-0001');
      expect(auditService.log).toHaveBeenCalledWith(
        tenantId,
        expect.any(String),
        'payment.refunded',
        'PaymentSession',
        sessionId,
        expect.objectContaining({ manualRefund: true }),
      );
    });

    it('rechaza si invoice no esta PAID', async () => {
      invoiceRepo.findOne.mockResolvedValue({
        id: invoiceId,
        tenantId,
        status: 'draft',
        total: 11.9,
      });

      await expect(
        service.refundInvoice(invoiceId, { reason: 'test' }, fakeUuid(200)),
      ).rejects.toThrow(/Solo facturas pagadas/);
      expect(stripeProvider.refundPayment).not.toHaveBeenCalled();
    });

    it('rechaza si reason es vacio o muy corto', async () => {
      await expect(
        service.refundInvoice(invoiceId, { reason: '' } as any, fakeUuid(200)),
      ).rejects.toThrow(/reason es obligatorio/);
      await expect(
        service.refundInvoice(invoiceId, { reason: 'ok' }, fakeUuid(200)),
      ).rejects.toThrow(/min 3 chars/);
    });

    it('rechaza si amount excede el cobrado', async () => {
      setupPaidInvoice();

      await expect(
        service.refundInvoice(
          invoiceId,
          { amount: 9999, reason: 'too much' },
          fakeUuid(200),
        ),
      ).rejects.toThrow(/excede el monto cobrado/);
    });

    it('si provider responde failed: audit refund_failed y throw', async () => {
      setupPaidInvoice();
      stripeProvider.refundPayment.mockResolvedValueOnce({
        refundId: 're_failed',
        status: 'failed',
        amount: 0,
        currency: 'CLP',
        failureReason: 'card_expired',
      });

      await expect(
        service.refundInvoice(
          invoiceId,
          { reason: 'test refund' },
          fakeUuid(200),
        ),
      ).rejects.toThrow(/Refund rechazado por el proveedor/);
      expect(auditService.log).toHaveBeenCalledWith(
        tenantId,
        expect.any(String),
        'payment.refund_failed',
        'PaymentSession',
        sessionId,
        expect.objectContaining({ providerReason: 'card_expired' }),
      );
      // No se llama issueCreditNote en falla.
      expect(invoicesService.issueCreditNote).not.toHaveBeenCalled();
    });

    it('si provider throws: audit refund_failed con error y rethrow', async () => {
      setupPaidInvoice();
      stripeProvider.refundPayment.mockRejectedValueOnce(
        new Error('Stripe API timeout'),
      );

      await expect(
        service.refundInvoice(
          invoiceId,
          { reason: 'test refund' },
          fakeUuid(200),
        ),
      ).rejects.toThrow(/Refund rechazado por el proveedor: Stripe API timeout/);
    });

    it('si refund OK pero issueCreditNote falla: audit credit_note_pending_manual y throw', async () => {
      setupPaidInvoice();
      invoicesService.issueCreditNote.mockRejectedValueOnce(
        new Error('DB constraint violated'),
      );

      await expect(
        service.refundInvoice(
          invoiceId,
          { reason: 'test refund' },
          fakeUuid(200),
        ),
      ).rejects.toThrow(/credit note fallo/);
      expect(auditService.log).toHaveBeenCalledWith(
        tenantId,
        expect.any(String),
        'invoice.credit_note_pending_manual',
        'invoice',
        invoiceId,
        expect.objectContaining({ requiresImmediateAction: true }),
      );
    });

    it('rechaza si tenantId scoping falla (otro tenant)', async () => {
      invoiceRepo.findOne.mockResolvedValue({
        id: invoiceId,
        tenantId: fakeUuid(999), // tenant distinto
        status: 'paid',
      });

      await expect(
        service.refundInvoice(
          invoiceId,
          { reason: 'attack' },
          fakeUuid(200),
          tenantId, // expected tenant
        ),
      ).rejects.toThrow(/no pertenece al tenant/);
    });
  });

  // ─── Fase 5 / Tarea 5.3 — Tests de concurrencia ─────────────────────

  describe('concurrencia (T5.3)', () => {
    it('50 webhooks paralelos del mismo externalId: solo 1 gana el lock y emite credit note una vez', async () => {
      sessionRepo.findOne.mockResolvedValue(buildSession({ status: 'paid' }));

      // Mock: solo el PRIMER UPDATE devuelve affected=1; el resto
      // affected=0 simulando que perdieron el atomic acquire.
      let firstWinner = true;
      const updateQb: any = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        execute: jest.fn().mockImplementation(() => {
          if (firstWinner) {
            firstWinner = false;
            return Promise.resolve({ affected: 1 });
          }
          return Promise.resolve({ affected: 0 });
        }),
      };
      sessionRepo.createQueryBuilder = jest.fn().mockReturnValue(updateQb);

      // Disparar 50 webhooks paralelos.
      const results = await Promise.all(
        Array.from({ length: 50 }, () =>
          service.applyWebhookEvent('stripe', {
            type: 'payment.refunded',
            externalId: 'ext_abc',
            amount: 11.9,
          }),
        ),
      );

      // Todos handled=true (idempotente).
      expect(results.every((r) => r.handled)).toBe(true);
      // CREDIT NOTE: emitida UNA SOLA VEZ (solo el ganador del lock).
      expect(invoicesService.issueCreditNote).toHaveBeenCalledTimes(1);
      // 49 noop por concurrencia.
      const noopReasons = results.filter((r) => r.reason?.includes('already processed manually'));
      expect(noopReasons.length).toBe(49);

      // B6-01: el patch jsonb va como parámetro bindeado, NO interpolado.
      const setArg = updateQb.set.mock.calls[0][0];
      expect(typeof setArg.metadata).toBe('function');
      expect(setArg.metadata()).toBe('metadata || :patch::jsonb');
      expect(updateQb.setParameter).toHaveBeenCalledWith(
        'patch',
        expect.stringContaining('refundedAt'),
      );
    });

    it('webhook concurrente con success: 100 calls -> markAsPaid una sola vez', async () => {
      sessionRepo.findOne.mockResolvedValue(buildSession({ status: 'pending' }));
      let firstWinner = true;
      const updateQb: any = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        execute: jest.fn().mockImplementation(() => {
          if (firstWinner) {
            firstWinner = false;
            return Promise.resolve({ affected: 1 });
          }
          return Promise.resolve({ affected: 0 });
        }),
      };
      sessionRepo.createQueryBuilder = jest.fn().mockReturnValue(updateQb);

      const results = await Promise.all(
        Array.from({ length: 100 }, () =>
          service.applyWebhookEvent('stripe', {
            type: 'payment.succeeded',
            externalId: 'ext_abc',
            amount: 11.9,
          }),
        ),
      );

      expect(results.every((r) => r.handled)).toBe(true);
      // markAsPaid solo invocado UNA vez.
      expect(invoicesService.markAsPaid).toHaveBeenCalledTimes(1);
    });
  });
});
