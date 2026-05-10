/**
 * invoices.service.spec.ts — Tests unitarios del InvoicesService.
 *
 * Cubre:
 * - generateInvoice: plan/tenant faltante, duplicado, calculo IVA
 * - getNextInvoiceNumber: secuencia correcta, primer numero del año
 * - Fase 0 / Tarea 0.1 — Calculo correcto de periodStart por continuidad
 *   historica:
 *     · Primera factura sin previas -> periodStart = sub.startDate
 *     · Factura siguiente -> periodStart = lastInvoice.periodEnd
 *     · Plan anual / trimestral / semestral / mensual: periodEnd correcto
 *     · dueDate ancla en fecha de emision (now), NO en periodStart
 *     · Facturas CANCELLED no son consideradas para continuidad
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';
import { InvoiceLine } from './entities/invoice-line.entity';
import { Subscription } from './entities/subscription.entity';
import {
  PaymentHistory,
  BillingPeriod,
} from './entities/payment-history.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from './invoices.service';
import {
  createMockRepository,
  createMockQueryBuilder,
  createMockAuditService,
  createMockDataSource,
  createMockEmailService,
  createMockNotificationsService,
  createMockPlan,
  fakeUuid,
} from '../../../test/test-utils';

/**
 * Helper: arma una sub mock con plan + tenant + fechas razonables.
 * `startDate` se usa como base; los tests sobreescriben lo que necesitan.
 */
function buildMockSub(overrides: Record<string, any> = {}) {
  const tenantId = overrides.tenantId ?? fakeUuid(100);
  return {
    id: fakeUuid(600),
    tenantId,
    plan: createMockPlan(),
    tenant: { id: tenantId, name: 'Demo' },
    startDate: new Date('2026-05-01'),
    nextBillingDate: new Date('2026-06-01'),
    billingPeriod: BillingPeriod.MONTHLY,
    aiAddonCalls: 0,
    aiAddonPrice: 0,
    ...overrides,
  };
}

describe('InvoicesService', () => {
  let service: InvoicesService;
  let invoiceRepo: any;
  let lineRepo: any;
  let subRepo: any;

  const tenantId = fakeUuid(100);

  beforeEach(async () => {
    invoiceRepo = createMockRepository();
    lineRepo = createMockRepository();
    subRepo = createMockRepository();

    // getNextInvoiceNumber usa createQueryBuilder
    const numQb = createMockQueryBuilder();
    (numQb.getRawOne as jest.Mock).mockResolvedValue(null); // no existing invoices
    invoiceRepo.createQueryBuilder.mockReturnValue(numQb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: getRepositoryToken(Invoice), useValue: invoiceRepo },
        { provide: getRepositoryToken(InvoiceLine), useValue: lineRepo },
        { provide: getRepositoryToken(Subscription), useValue: subRepo },
        {
          provide: getRepositoryToken(PaymentHistory),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(Tenant),
          useValue: createMockRepository(),
        },
        { provide: getRepositoryToken(User), useValue: createMockRepository() },
        { provide: AuditService, useValue: createMockAuditService() },
        { provide: EmailService, useValue: createMockEmailService() },
        {
          provide: NotificationsService,
          useValue: createMockNotificationsService(),
        },
        // DataSource es usado por runWithBlockingAdvisoryLock (numeracion).
        { provide: DataSource, useValue: createMockDataSource() },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
  });

  // ─── generateInvoice — guards basicos ───────────────────────────────

  describe('generateInvoice — validations', () => {
    it('should throw NotFoundException if subscription not found', async () => {
      subRepo.findOne.mockResolvedValue(null);

      await expect(service.generateInvoice(fakeUuid(999))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if subscription has no plan', async () => {
      subRepo.findOne.mockResolvedValue({
        id: fakeUuid(600),
        tenantId,
        plan: null,
        tenant: { id: tenantId, name: 'Demo' },
      });

      await expect(service.generateInvoice(fakeUuid(600))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if subscription has no tenant', async () => {
      subRepo.findOne.mockResolvedValue({
        id: fakeUuid(600),
        tenantId,
        plan: createMockPlan(),
        tenant: null,
      });

      await expect(service.generateInvoice(fakeUuid(600))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException on duplicate invoice for same period', async () => {
      subRepo.findOne.mockResolvedValue(buildMockSub());
      // 1er findOne = lookup ultima factura no-cancelada (no hay) -> primera factura
      // 2do findOne = duplicate check -> existe ya una para este period_start
      invoiceRepo.findOne
        .mockResolvedValueOnce(null) // continuidad: no hay previas
        .mockResolvedValueOnce({
          id: fakeUuid(700),
          invoiceNumber: 'EVA-2026-0001',
        });

      await expect(service.generateInvoice(fakeUuid(600))).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── generateInvoice — IVA y money handling ──────────────────────────

  describe('generateInvoice — IVA calculation', () => {
    it('should generate invoice with correct IVA 19% calculation', async () => {
      const plan = createMockPlan({ monthlyPrice: 10 });
      subRepo.findOne.mockResolvedValue(buildMockSub({ plan }));
      // findOne #1 (continuidad) = null, findOne #2 (duplicate) = null,
      // findOne #3 (final reload con relations) = invoice persistida
      invoiceRepo.findOne
        .mockResolvedValueOnce(null) // continuidad
        .mockResolvedValueOnce(null) // duplicate
        .mockResolvedValueOnce({
          id: fakeUuid(700),
          total: 11.9,
          subtotal: 10,
          taxAmount: 1.9,
          taxRate: 19,
        });
      invoiceRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: fakeUuid(700), ...entity }),
      );

      await service.generateInvoice(fakeUuid(600));

      expect(invoiceRepo.save).toHaveBeenCalled();
      const savedEntity = invoiceRepo.save.mock.calls[0][0];
      expect(savedEntity.taxRate).toBe(19);
      expect(savedEntity.subtotal).toBe(10);
      expect(savedEntity.taxAmount).toBe(1.9); // 10 * 0.19
      expect(savedEntity.total).toBe(11.9); // 10 + 1.9
    });
  });

  // ─── Fase 0 / Tarea 0.1 — periodStart por continuidad historica ─────

  describe('generateInvoice — periodStart (Fase 0 / Tarea 0.1)', () => {
    /**
     * Helper: extrae el entity guardado en el primer save() del invoice
     * (NO el de las lines). El primer call de invoiceRepo.save es el de
     * la factura, los siguientes son las invoice lines guardadas via
     * lineRepo.save.
     */
    function getSavedInvoice(): any {
      expect(invoiceRepo.save).toHaveBeenCalled();
      return invoiceRepo.save.mock.calls[0][0];
    }

    function setupHappyPath(sub: any) {
      subRepo.findOne.mockResolvedValue(sub);
      invoiceRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ id: fakeUuid(700), ...entity }),
      );
    }

    it('first invoice (no previous): periodStart = sub.startDate (NOT nextBillingDate)', async () => {
      // Caso reproducido en produccion: tenant con plan anual creado el
      // 2026-05-01 facturaba periodo abr/2027 en vez de 2026-05.
      const sub = buildMockSub({
        startDate: new Date('2026-05-01'),
        nextBillingDate: new Date('2027-05-01'), // 1 ano adelante (correcto desde "proximo cobro")
        billingPeriod: BillingPeriod.ANNUAL,
        plan: createMockPlan({ monthlyPrice: 10, yearlyPrice: 96 }),
      });
      setupHappyPath(sub);
      invoiceRepo.findOne
        .mockResolvedValueOnce(null) // continuidad: no hay previas
        .mockResolvedValueOnce(null) // duplicate: ninguna existente
        .mockResolvedValueOnce({ id: fakeUuid(700) });

      await service.generateInvoice(sub.id);

      const saved = getSavedInvoice();
      // periodStart debe ser startDate (2026-05-01), NO nextBillingDate (2027-05-01).
      // Asserts en UTC para no depender de la TZ del runner (ver Tarea 0.1.6).
      expect(new Date(saved.periodStart).getUTCFullYear()).toBe(2026);
      expect(new Date(saved.periodStart).getUTCMonth()).toBe(4); // mayo (0-indexed)
      // periodEnd = startDate + 1 ano = 2027-05-01
      expect(new Date(saved.periodEnd).getUTCFullYear()).toBe(2027);
      expect(new Date(saved.periodEnd).getUTCMonth()).toBe(4);
    });

    it('subsequent invoice: periodStart = previous invoice periodEnd (continuity)', async () => {
      const sub = buildMockSub({
        startDate: new Date('2026-01-01'),
        billingPeriod: BillingPeriod.MONTHLY,
        plan: createMockPlan({ monthlyPrice: 10 }),
      });
      setupHappyPath(sub);
      const prevInvoice = {
        id: fakeUuid(701),
        periodStart: new Date('2026-04-01'),
        periodEnd: new Date('2026-05-01'),
        status: InvoiceStatus.PAID,
      };
      invoiceRepo.findOne
        .mockResolvedValueOnce(prevInvoice) // continuidad: encuentra la anterior
        .mockResolvedValueOnce(null) // duplicate: ninguna en este nuevo periodo
        .mockResolvedValueOnce({ id: fakeUuid(702) });

      await service.generateInvoice(sub.id);

      const saved = getSavedInvoice();
      // periodStart de la nueva = periodEnd de la anterior (continuidad sin gap)
      expect(new Date(saved.periodStart).toISOString().slice(0, 10)).toBe(
        '2026-05-01',
      );
      expect(new Date(saved.periodEnd).toISOString().slice(0, 10)).toBe(
        '2026-06-01',
      );
    });

    it('annual plan first invoice: periodEnd = startDate + 1 year', async () => {
      const sub = buildMockSub({
        startDate: new Date('2026-05-01'),
        billingPeriod: BillingPeriod.ANNUAL,
        plan: createMockPlan({ monthlyPrice: 10, yearlyPrice: 96 }),
      });
      setupHappyPath(sub);
      invoiceRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: fakeUuid(700) });

      await service.generateInvoice(sub.id);

      const saved = getSavedInvoice();
      expect(new Date(saved.periodStart).toISOString().slice(0, 10)).toBe(
        '2026-05-01',
      );
      expect(new Date(saved.periodEnd).toISOString().slice(0, 10)).toBe(
        '2027-05-01',
      );
    });

    it('quarterly plan first invoice: periodEnd = startDate + 3 months', async () => {
      const sub = buildMockSub({
        startDate: new Date('2026-05-01'),
        billingPeriod: BillingPeriod.QUARTERLY,
        plan: createMockPlan({ monthlyPrice: 10, quarterlyPrice: 27 }),
      });
      setupHappyPath(sub);
      invoiceRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: fakeUuid(700) });

      await service.generateInvoice(sub.id);

      const saved = getSavedInvoice();
      expect(new Date(saved.periodStart).toISOString().slice(0, 10)).toBe(
        '2026-05-01',
      );
      expect(new Date(saved.periodEnd).toISOString().slice(0, 10)).toBe(
        '2026-08-01',
      );
    });

    it('semiannual plan first invoice: periodEnd = startDate + 6 months', async () => {
      const sub = buildMockSub({
        startDate: new Date('2026-05-01'),
        billingPeriod: BillingPeriod.SEMIANNUAL,
        plan: createMockPlan({ monthlyPrice: 10, semiannualPrice: 51 }),
      });
      setupHappyPath(sub);
      invoiceRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: fakeUuid(700) });

      await service.generateInvoice(sub.id);

      const saved = getSavedInvoice();
      expect(new Date(saved.periodStart).toISOString().slice(0, 10)).toBe(
        '2026-05-01',
      );
      expect(new Date(saved.periodEnd).toISOString().slice(0, 10)).toBe(
        '2026-11-01',
      );
    });

    it('monthly plan first invoice: periodEnd = startDate + 1 month', async () => {
      const sub = buildMockSub({
        startDate: new Date('2026-05-01'),
        billingPeriod: BillingPeriod.MONTHLY,
        plan: createMockPlan({ monthlyPrice: 10 }),
      });
      setupHappyPath(sub);
      invoiceRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: fakeUuid(700) });

      await service.generateInvoice(sub.id);

      const saved = getSavedInvoice();
      expect(new Date(saved.periodStart).toISOString().slice(0, 10)).toBe(
        '2026-05-01',
      );
      expect(new Date(saved.periodEnd).toISOString().slice(0, 10)).toBe(
        '2026-06-01',
      );
    });

    it('continuity lookup excludes CANCELLED invoices', async () => {
      // Si la ultima factura fue cancelada, ese periodo no se cobro y debe
      // re-facturarse. Verificamos que el query de continuidad pasa el
      // filtro de status correcto (no incluye CANCELLED).
      const sub = buildMockSub();
      setupHappyPath(sub);
      invoiceRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: fakeUuid(700) });

      await service.generateInvoice(sub.id);

      // Inspecciono el `where` del 1er findOne (continuidad): debe contener
      // un filtro `status: In([DRAFT, SENT, PAID, OVERDUE])` que excluye
      // CANCELLED y CREDIT_NOTE.
      const continuityCall = invoiceRepo.findOne.mock.calls[0][0];
      expect(continuityCall.where.subscriptionId).toBe(sub.id);
      // typeorm In(...) wrapper expone los valores via `_value` o keys
      // internos; basta con verificar que CANCELLED no este en la lista.
      const statusFilter = continuityCall.where.status;
      const acceptedStatuses = statusFilter._value ?? statusFilter.value ?? [];
      expect(acceptedStatuses).toContain(InvoiceStatus.PAID);
      expect(acceptedStatuses).toContain(InvoiceStatus.SENT);
      expect(acceptedStatuses).toContain(InvoiceStatus.DRAFT);
      expect(acceptedStatuses).toContain(InvoiceStatus.OVERDUE);
      expect(acceptedStatuses).not.toContain(InvoiceStatus.CANCELLED);
    });
  });

  // ─── Fase 0 / Tarea 0.1.2 — dueDate ancla en fecha de emision ───────

  describe('generateInvoice — dueDate (Fase 0 / Tarea 0.1.2)', () => {
    it('dueDate is now + 15 days, NOT periodStart + 15 days', async () => {
      // Plan anual recien creado: periodStart=2026-05-01, periodEnd=2027-05-01.
      // dueDate debe ser ~ now + 15d (15 dias desde la emision).
      // PRE-fix: dueDate era periodStart + 15 = 2026-05-16, que en plan
      // anual con bug tambien quedaba en 2027-05-16.
      const fixedNow = new Date('2026-05-01T10:00:00Z');
      jest.useFakeTimers().setSystemTime(fixedNow);
      try {
        const sub = buildMockSub({
          startDate: new Date('2026-05-01'),
          billingPeriod: BillingPeriod.ANNUAL,
          plan: createMockPlan({ monthlyPrice: 10, yearlyPrice: 96 }),
        });
        subRepo.findOne.mockResolvedValue(sub);
        invoiceRepo.findOne
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: fakeUuid(700) });
        invoiceRepo.save.mockImplementation((entity: any) =>
          Promise.resolve({ id: fakeUuid(700), ...entity }),
        );

        await service.generateInvoice(sub.id);

        expect(invoiceRepo.save).toHaveBeenCalled();
        const saved = invoiceRepo.save.mock.calls[0][0];
        // dueDate debe estar a ~15 dias de hoy (2026-05-01), NO en mayo 2027.
        const due = new Date(saved.dueDate);
        const diffDays =
          (due.getTime() - fixedNow.getTime()) / (1000 * 60 * 60 * 24);
        expect(diffDays).toBeGreaterThanOrEqual(14.5);
        expect(diffDays).toBeLessThanOrEqual(15.5);
        // Sanity: dueDate NO esta en 2027.
        expect(due.getUTCFullYear()).toBe(2026);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // ─── processDunning (Fase 1 / Tarea 1.1) ───────────────────────────

  describe('processDunning', () => {
    /**
     * Acceso a los repos+services internos del service via reflection
     * para configurar mocks especificos de cada test sin reconstruir
     * todo el modulo. Justificacion: el mock global en beforeEach es
     * suficiente para los tests existentes; los de dunning necesitan
     * mocks puntuales por test.
     */
    function getDeps() {
      const userRepo = (service as any).userRepo;
      const emailService = (service as any).emailService;
      const auditService = (service as any).auditService;
      // Inyectar metodos de dunning que el helper global no tiene.
      emailService.sendInvoiceOverdueFriendly = jest.fn().mockResolvedValue(undefined);
      emailService.sendInvoiceOverdueUrgent = jest.fn().mockResolvedValue(undefined);
      emailService.sendAccountSuspended = jest.fn().mockResolvedValue(undefined);
      emailService.sendAccountCancellationWarning = jest.fn().mockResolvedValue(undefined);
      emailService.sendAccountCancelled = jest.fn().mockResolvedValue(undefined);
      return { userRepo, emailService, auditService };
    }

    /**
     * Helper para mockear el resultado del query builder de dunning.
     * processDunning hace createQueryBuilder('i').where().andWhere()
     * .leftJoinAndSelect().leftJoinAndSelect().orderBy().getMany().
     */
    function mockDunningCandidates(invoices: any[]) {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(invoices),
      };
      // Mantener el queryBuilder de getNextInvoiceNumber separado.
      // El de dunning entra solo cuando se llama processDunning.
      invoiceRepo.createQueryBuilder.mockReturnValueOnce(qb);
    }

    function buildOverdueInvoice(daysOverdue: number, overrides: Record<string, any> = {}) {
      // Construye dueDate UTC midnight - daysOverdue dias.
      const fixedNow = new Date('2026-05-15T10:00:00Z');
      const due = new Date(fixedNow);
      due.setUTCDate(due.getUTCDate() - daysOverdue);
      const tid = overrides.tenantId ?? fakeUuid(100);
      return {
        id: fakeUuid(700 + Math.floor(Math.random() * 100)),
        tenantId: tid,
        invoiceNumber: 'EVA-2026-0001',
        status: InvoiceStatus.SENT,
        dueDate: due,
        total: 11.9,
        currency: 'UF',
        dunning: {},
        tenant: { id: tid, name: 'Demo Org' },
        subscription: { id: fakeUuid(800), status: 'active' },
        subscriptionId: fakeUuid(800),
        ...overrides,
      };
    }

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-15T10:00:00Z'));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('stage 3: sends friendly reminder', async () => {
      const { userRepo, emailService } = getDeps();
      mockDunningCandidates([buildOverdueInvoice(3)]);
      userRepo.findOne.mockResolvedValue({
        id: fakeUuid(900),
        email: 'admin@demo.cl',
        firstName: 'Ana',
      });

      const result = await service.processDunning();

      expect(result.advanced).toBe(1);
      expect(emailService.sendInvoiceOverdueFriendly).toHaveBeenCalledTimes(1);
    });

    it('stage 14: suspends sub and sends "account suspended" email exactly once', async () => {
      const { userRepo, emailService } = getDeps();
      mockDunningCandidates([buildOverdueInvoice(14)]);
      userRepo.findOne.mockResolvedValue({
        id: fakeUuid(900),
        email: 'admin@demo.cl',
        firstName: 'Ana',
      });

      await service.processDunning();

      expect(subRepo.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'suspended' }),
      );
      expect(emailService.sendAccountSuspended).toHaveBeenCalledTimes(1);
    });

    it('B1.9 dedup: 3 invoices same tenant in stage 14 -> sub suspended ONCE, email sent ONCE', async () => {
      // Pre-fix: el tenant recibia 3 emails identicos "cuenta suspendida".
      // Post-fix: el email solo se envia con la transicion ACTIVE->SUSPENDED;
      // las invoices subsiguientes ven sub.status='suspended' y skipean.
      const { userRepo, emailService } = getDeps();
      const tid = fakeUuid(100);
      const subId = fakeUuid(800);
      const sub = { id: subId, status: 'active' };
      const invoices = [
        buildOverdueInvoice(20, { tenantId: tid, subscription: sub, subscriptionId: subId }),
        buildOverdueInvoice(17, { tenantId: tid, subscription: sub, subscriptionId: subId }),
        buildOverdueInvoice(14, { tenantId: tid, subscription: sub, subscriptionId: subId }),
      ];
      mockDunningCandidates(invoices);
      userRepo.findOne.mockResolvedValue({
        id: fakeUuid(900),
        email: 'admin@demo.cl',
        firstName: 'Ana',
      });

      await service.processDunning();

      // subRepo.update llamado UNA sola vez (transicion).
      expect(subRepo.update).toHaveBeenCalledTimes(1);
      // Email "suspended" enviado UNA sola vez, no 3.
      expect(emailService.sendAccountSuspended).toHaveBeenCalledTimes(1);
    });

    it('B1.4 dedup: stage 7 reminder NOT sent if sub already SUSPENDED (other invoice triggered it)', async () => {
      // Caso: tenant tiene invoice A (stage 14, sub suspended) e invoice B
      // (stage 7). B no debe mandar email "te suspendemos en X dias"
      // porque la sub ya esta suspendida.
      const { userRepo, emailService } = getDeps();
      const tid = fakeUuid(100);
      const subId = fakeUuid(800);
      const subActive = { id: subId, status: 'active' };
      const invoiceA = buildOverdueInvoice(14, {
        tenantId: tid, subscription: subActive, subscriptionId: subId,
      });
      const invoiceB = buildOverdueInvoice(7, {
        tenantId: tid, subscription: subActive, subscriptionId: subId,
      });
      // Order by dueDate ASC -> A primero (mas antigua), luego B.
      mockDunningCandidates([invoiceA, invoiceB]);
      userRepo.findOne.mockResolvedValue({
        id: fakeUuid(900),
        email: 'admin@demo.cl',
        firstName: 'Ana',
      });

      await service.processDunning();

      // A dispara stage 14 -> suspende + envia email "suspended" (1 vez).
      expect(emailService.sendAccountSuspended).toHaveBeenCalledTimes(1);
      // B veria sub ya 'suspended' (refrescado in-memory) y skipea email
      // urgent. Persiste el stage para no reintentar.
      expect(emailService.sendInvoiceOverdueUrgent).not.toHaveBeenCalled();
    });

    it('idempotent: 2nd run on same invoice already in stage X does nothing', async () => {
      const { userRepo, emailService } = getDeps();
      const inv = buildOverdueInvoice(7, { dunning: { stage: 7, lastEmailAt: '2026-05-13T09:00:00Z' } });
      mockDunningCandidates([inv]);
      userRepo.findOne.mockResolvedValue({
        id: fakeUuid(900), email: 'a@b.cl', firstName: 'A',
      });

      const result = await service.processDunning();

      expect(result.advanced).toBe(0);
      expect(emailService.sendInvoiceOverdueFriendly).not.toHaveBeenCalled();
      expect(emailService.sendInvoiceOverdueUrgent).not.toHaveBeenCalled();
    });

    it('skips emails when target=0 (daysOverdue < 3)', async () => {
      const { userRepo, emailService } = getDeps();
      mockDunningCandidates([buildOverdueInvoice(2)]);
      userRepo.findOne.mockResolvedValue({
        id: fakeUuid(900), email: 'a@b.cl', firstName: 'A',
      });

      const result = await service.processDunning();

      expect(result.advanced).toBe(0);
      expect(emailService.sendInvoiceOverdueFriendly).not.toHaveBeenCalled();
    });

    it('UTC-safe: invoice with dueDate as YYYY-MM-DD string still computes correct daysOverdue', async () => {
      // Caso real: PG `date` columns vienen como string '2026-05-08'.
      // Pre-fix Tarea 1.1.2 calculaba daysOverdue con drift.
      // Post-fix: comparacion UTC-day vs UTC-day, sin importar la hora.
      const { userRepo, emailService } = getDeps();
      // 7 dias antes de 2026-05-15 UTC = 2026-05-08
      const inv = buildOverdueInvoice(7);
      inv.dueDate = '2026-05-08' as any; // string, como llega de PG
      mockDunningCandidates([inv]);
      userRepo.findOne.mockResolvedValue({
        id: fakeUuid(900), email: 'a@b.cl', firstName: 'A',
      });

      await service.processDunning();

      // Debe ejecutar stage 7 (urgent), no stage 3 ni quedarse en target=0.
      expect(emailService.sendInvoiceOverdueUrgent).toHaveBeenCalledTimes(1);
    });

    it('tenant without active admin: suspension audit logs subscription.suspended_no_contact', async () => {
      const { userRepo, auditService, emailService } = getDeps();
      mockDunningCandidates([buildOverdueInvoice(14)]);
      userRepo.findOne.mockResolvedValue(null); // sin admin

      await service.processDunning();

      expect(emailService.sendAccountSuspended).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.any(String),
        null,
        'subscription.suspended_no_contact',
        'Subscription',
        expect.any(String),
        expect.any(Object),
      );
    });
  });
});
