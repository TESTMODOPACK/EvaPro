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
import { Invoice, InvoiceStatus, InvoiceType } from './entities/invoice.entity';
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
  createSpyableDataSource,
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
  let dataSource: any;

  const tenantId = fakeUuid(100);

  beforeEach(async () => {
    invoiceRepo = createMockRepository();
    lineRepo = createMockRepository();
    subRepo = createMockRepository();
    // Fase 1 / Tarea 1.3 — usar createSpyableDataSource para poder
    // inspeccionar las entities guardadas dentro de la transaction
    // de generateInvoice (que pre-fix usaba invoiceRepo.save directo).
    dataSource = createSpyableDataSource();

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
        // DataSource es usado por runWithBlockingAdvisoryLock (numeracion)
        // y por generateInvoice (transaction atomica de invoice + lines).
        { provide: DataSource, useValue: dataSource },
        // Fase 4 / T4.3 — PriceOverridesService usado por generateInvoice
        // para resolver descuentos custom por tenant. Mock default:
        // sin override (retorna null) -> mismo comportamiento pre-T4.3.
        {
          provide: require('./price-overrides.service').PriceOverridesService,
          useValue: {
            getActiveOverride: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            listForSubscription: jest.fn().mockResolvedValue([]),
            closeActive: jest.fn(),
          },
        },
        // Fase 4 / T4.5 — BillingSettingsService para configuracion
        // fiscal (RUT emisor, IVA, prefijo, dueDays). Mock retorna
        // defaults Chile que mantienen el comportamiento pre-T4.5.
        {
          provide: require('./billing-settings.service').BillingSettingsService,
          useValue: {
            get: jest.fn().mockResolvedValue({
              id: 'singleton',
              issuerName: 'Ascenda Performance SpA',
              issuerRut: '77.000.000-0',
              issuerCity: 'Santiago',
              issuerCountry: 'Chile',
              invoicePrefix: 'EVA',
              creditNotePrefix: 'EVA-NC',
              taxRate: 19,
              dueDays: 15,
              // Post-fix EVA-2026-0004 — default 7 dias de anticipacion
              // permitidos para emitir factura antes del periodStart.
              invoiceAdvanceDays: 7,
              defaultCurrency: 'UF',
              footerNote: null,
            }),
            update: jest.fn(),
            invalidateCache: jest.fn(),
          },
        },
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

      await service.generateInvoice(fakeUuid(600));

      // Fase 1 / Tarea 1.3 — invoice se guarda dentro de
      // dataSource.transaction. El primer entity persistido es la invoice.
      expect(dataSource.txSavedEntities.length).toBeGreaterThan(0);
      const savedEntity = dataSource.txSavedEntities[0];
      expect(savedEntity.taxRate).toBe(19);
      expect(savedEntity.subtotal).toBe(10);
      expect(savedEntity.taxAmount).toBe(1.9); // 10 * 0.19
      expect(savedEntity.total).toBe(11.9); // 10 + 1.9
    });
  });

  // ─── Fase 0 / Tarea 0.1 — periodStart por continuidad historica ─────

  describe('generateInvoice — periodStart (Fase 0 / Tarea 0.1)', () => {
    /**
     * Fase 1 / Tarea 1.3 — invoice + lines se guardan via
     * dataSource.transaction. El primer entity persistido es la invoice
     * (luego siguen las lines).
     */
    function getSavedInvoice(): any {
      expect(dataSource.txSavedEntities.length).toBeGreaterThan(0);
      return dataSource.txSavedEntities[0];
    }

    function setupHappyPath(sub: any) {
      subRepo.findOne.mockResolvedValue(sub);
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

    // ─── Fase 1 / Tarea 1.3 — Atomicidad ──────────────────────────────

    it('rolls back invoice if a line save fails (no DRAFT corrupted)', async () => {
      // Pre-fix Tarea 1.3: si fallaba lineRepo.save mid-loop, la invoice
      // ya estaba persistida (DRAFT corrupto). El cron de auto-renewal
      // (T0.2) la encontraria como lastInvoice y avanzaria periodStart
      // -> el periodo "fallado" nunca se re-facturaria.
      // Post-fix: dataSource.transaction rollbackea TODO si cualquier
      // save adentro lanza.
      const sub = buildMockSub();
      setupHappyPath(sub);
      invoiceRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: fakeUuid(700) });

      // Override transaction mock para simular fallo en el 2do save
      // (la 1ra es la invoice, las siguientes son lines).
      const txCalls: any[] = [];
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => {
        const mockMgr = {
          save: jest.fn().mockImplementation((arg1: any) => {
            txCalls.push(arg1);
            if (txCalls.length === 1) {
              // Primera save (invoice) OK
              return Promise.resolve({ ...arg1, id: 'mock-tx-uuid' });
            }
            // Segunda save (line) FALLA — provider error simulado
            return Promise.reject(
              new Error('insert into invoice_lines failed: not-null violation'),
            );
          }),
          getRepository: jest.fn().mockReturnValue(createMockRepository()),
        };
        // El service llama a cb(mockMgr) y captura el throw — la
        // transaction real haria rollback. Aqui propagamos el reject
        // para que el outer catch lo trate como InternalServerError.
        return cb(mockMgr);
      });

      await expect(service.generateInvoice(sub.id)).rejects.toThrow(
        /Fallo al generar factura/,
      );

      // Verificar que la transaction se inicio (al menos un save) pero
      // que el error se propago (no se completo el flujo).
      expect(txCalls.length).toBeGreaterThanOrEqual(1);
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

  // ─── Fase 0 / T0.1.2 + Post-fix EVA-2026-0004 — dueDate anchored ─────

  describe('generateInvoice — dueDate (Fase 0 / Tarea 0.1.2 + EVA-2026-0004)', () => {
    it('emision dentro del periodo: dueDate = now + dueDays (max(now, periodStart) = now)', async () => {
      // Plan anual recien creado, emisor factura el mismo dia de inicio:
      // periodStart=2026-05-01, now=2026-05-01 -> ambos coinciden, dueDate = now + 15d.
      // PRE-fix Fase 0: dueDate era periodStart + 15 = 2026-05-16 (en plan
      // anual con bug F0 tambien quedaba en 2027-05-16).
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

        await service.generateInvoice(sub.id);

        expect(dataSource.txSavedEntities.length).toBeGreaterThan(0);
        const saved = dataSource.txSavedEntities[0];
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

    it('emision anticipada (dentro de la ventana): dueDate ancla a periodStart, no a now', async () => {
      // Post-fix EVA-2026-0004 Bug 2: emision dentro de la ventana de
      // invoiceAdvanceDays pero ANTES del inicio del periodo. El dueDate
      // debe medirse desde periodStart (cuando empieza el servicio), NO
      // desde now (cuando se emite). Asi el cliente tiene los 15 dias
      // completos a contar desde que recibe el servicio.
      //
      // Setup: emito hoy (2026-05-01) factura para periodo que arranca
      // 2026-05-06 (5 dias adelantado, dentro de la ventana default=7).
      const fixedNow = new Date('2026-05-01T10:00:00Z');
      jest.useFakeTimers().setSystemTime(fixedNow);
      try {
        const sub = buildMockSub({
          // startDate = +5d para que sin lastInvoice, periodStart=startDate
          // quede 5 dias en el futuro (dentro de invoiceAdvanceDays=7).
          startDate: new Date('2026-05-06'),
          billingPeriod: BillingPeriod.MONTHLY,
          plan: createMockPlan({ monthlyPrice: 10 }),
        });
        subRepo.findOne.mockResolvedValue(sub);
        invoiceRepo.findOne
          .mockResolvedValueOnce(null) // continuidad: primera factura
          .mockResolvedValueOnce(null) // duplicate: ninguna
          .mockResolvedValueOnce({ id: fakeUuid(700) });

        await service.generateInvoice(sub.id);

        const saved = dataSource.txSavedEntities[0];
        const due = new Date(saved.dueDate);
        // dueDate debe ser periodStart (2026-05-06) + 15d = 2026-05-21.
        // NO 2026-05-16 (= now + 15d, comportamiento pre-fix).
        expect(due.toISOString().slice(0, 10)).toBe('2026-05-21');
      } finally {
        jest.useRealTimers();
      }
    });

    it('emision anticipada excesiva (fuera de ventana): rechaza con 400', async () => {
      // Post-fix EVA-2026-0004 Bug 1: si periodStart > now + invoiceAdvanceDays
      // (default 7), generateInvoice debe rechazar con BadRequestException.
      // Caso real reproducido: invoice EVA-2026-0004 emitida 12-05-2026
      // con periodo 30-06 a 30-07 (50 dias adelantado). Cliente pagaba
      // 34 dias ANTES de empezar a recibir servicio.
      const fixedNow = new Date('2026-05-12T10:00:00Z');
      jest.useFakeTimers().setSystemTime(fixedNow);
      try {
        const sub = buildMockSub({
          // startDate 50d adelantado simulando el caso real.
          startDate: new Date('2026-06-30'),
          billingPeriod: BillingPeriod.MONTHLY,
          plan: createMockPlan({ monthlyPrice: 10 }),
        });
        subRepo.findOne.mockResolvedValue(sub);
        invoiceRepo.findOne.mockResolvedValueOnce(null); // continuidad

        await expect(service.generateInvoice(sub.id)).rejects.toThrow(
          /No se puede emitir factura/,
        );
        // Verifica que NO se persistio nada en la transaction (guard
        // ejecuta antes del runWithBlockingAdvisoryLock).
        expect(dataSource.txSavedEntities.length).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    // ─── Opcion B — Override per-tenant del plazo de pago ────────────

    it('tenant con dueDaysOverride=30: dueDate = max(now, periodStart) + 30, ignora global de 15', async () => {
      // Caso real: empresa con contrato negociado a 30 dias plazo.
      // tenant.dueDaysOverride=30 debe ganarle al global=15.
      const fixedNow = new Date('2026-05-15T10:00:00Z');
      jest.useFakeTimers().setSystemTime(fixedNow);
      try {
        const sub = buildMockSub({
          startDate: new Date('2026-05-01'),
          billingPeriod: BillingPeriod.MONTHLY,
          plan: createMockPlan({ monthlyPrice: 10 }),
          tenant: {
            id: fakeUuid(100),
            name: 'Enterprise Corp',
            dueDaysOverride: 30,
          },
        });
        subRepo.findOne.mockResolvedValue(sub);
        invoiceRepo.findOne
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: fakeUuid(700) });

        await service.generateInvoice(sub.id);

        const saved = dataSource.txSavedEntities[0];
        const due = new Date(saved.dueDate);
        // periodStart=2026-05-01 < now=2026-05-15 -> dueAnchor=now.
        // dueDate = now + 30 = 2026-06-14.
        const diffDays =
          (due.getTime() - fixedNow.getTime()) / (1000 * 60 * 60 * 24);
        expect(diffDays).toBeGreaterThanOrEqual(29.5);
        expect(diffDays).toBeLessThanOrEqual(30.5);
      } finally {
        jest.useRealTimers();
      }
    });

    it('tenant con dueDaysOverride=0 (contado): dueDate = dueAnchor (mismo dia)', async () => {
      // Caso: cliente con plan "pago contado" — la factura vence el
      // mismo dia de emision (o el dia que arranca el servicio si es
      // emision anticipada). Edge case importante: el operador `??`
      // trataria 0 como falsy y caeria al global=15. Usamos `!= null`
      // para preservar el 0.
      const fixedNow = new Date('2026-05-15T10:00:00Z');
      jest.useFakeTimers().setSystemTime(fixedNow);
      try {
        const sub = buildMockSub({
          startDate: new Date('2026-05-01'),
          billingPeriod: BillingPeriod.MONTHLY,
          plan: createMockPlan({ monthlyPrice: 10 }),
          tenant: {
            id: fakeUuid(100),
            name: 'Cash Customer',
            dueDaysOverride: 0,
          },
        });
        subRepo.findOne.mockResolvedValue(sub);
        invoiceRepo.findOne
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: fakeUuid(700) });

        await service.generateInvoice(sub.id);

        const saved = dataSource.txSavedEntities[0];
        const due = new Date(saved.dueDate);
        // periodStart < now -> dueAnchor=now. dueDate = now + 0 = now.
        const diffMs = due.getTime() - fixedNow.getTime();
        expect(Math.abs(diffMs)).toBeLessThan(1000); // <1s diff
      } finally {
        jest.useRealTimers();
      }
    });

    it('tenant con dueDaysOverride=null: fallback al global dueDays=15', async () => {
      // Caso default: tenant sin override (NULL). Usa el global de
      // billing_settings (mock=15). Comportamiento identico al pre-Opcion-B.
      const fixedNow = new Date('2026-05-15T10:00:00Z');
      jest.useFakeTimers().setSystemTime(fixedNow);
      try {
        const sub = buildMockSub({
          startDate: new Date('2026-05-01'),
          billingPeriod: BillingPeriod.MONTHLY,
          plan: createMockPlan({ monthlyPrice: 10 }),
          tenant: {
            id: fakeUuid(100),
            name: 'Standard Customer',
            dueDaysOverride: null,
          },
        });
        subRepo.findOne.mockResolvedValue(sub);
        invoiceRepo.findOne
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: fakeUuid(700) });

        await service.generateInvoice(sub.id);

        const saved = dataSource.txSavedEntities[0];
        const due = new Date(saved.dueDate);
        // dueDate = now + 15 (global).
        const diffDays =
          (due.getTime() - fixedNow.getTime()) / (1000 * 60 * 60 * 24);
        expect(diffDays).toBeGreaterThanOrEqual(14.5);
        expect(diffDays).toBeLessThanOrEqual(15.5);
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

    // ─── Fase 1 / Tarea 1.2 — Custom thresholds por plan ───────────────

    describe('custom dunning thresholds per plan', () => {
      it('Enterprise plan with grace 30d does NOT suspend at default 14d', async () => {
        // Plan Enterprise con suspend=30 (vs default 14). daysOverdue=20
        // -> bajo defaults estaria stage 14 (suspend). Bajo Enterprise
        // estaria solo stage reminder2=14.
        const { userRepo, emailService } = getDeps();
        const enterprisePlan = {
          code: 'enterprise',
          dunningThresholds: {
            reminder1: 7,
            reminder2: 14,
            suspend: 30,
            cancelWarning: 60,
            cancel: 90,
          },
        };
        const inv = buildOverdueInvoice(20, {
          subscription: {
            id: fakeUuid(800),
            status: 'active',
            plan: enterprisePlan,
          },
        });
        mockDunningCandidates([inv]);
        userRepo.findOne.mockResolvedValue({
          id: fakeUuid(900), email: 'a@b.cl', firstName: 'A',
        });

        await service.processDunning();

        // Bajo plan Enterprise + 20d overdue: cae en reminder2 (14d).
        expect(emailService.sendInvoiceOverdueUrgent).toHaveBeenCalledTimes(1);
        // NO se debe suspender la sub (suspend=30, daysOverdue=20).
        expect(subRepo.update).not.toHaveBeenCalled();
      });

      it('Starter plan with aggressive thresholds suspends at 7d', async () => {
        const { userRepo, emailService } = getDeps();
        const starterPlan = {
          code: 'starter',
          dunningThresholds: {
            reminder1: 1,
            reminder2: 3,
            suspend: 7,
            cancelWarning: 14,
            cancel: 21,
          },
        };
        const inv = buildOverdueInvoice(8, {
          subscription: {
            id: fakeUuid(800),
            status: 'active',
            plan: starterPlan,
          },
        });
        mockDunningCandidates([inv]);
        userRepo.findOne.mockResolvedValue({
          id: fakeUuid(900), email: 'a@b.cl', firstName: 'A',
        });

        await service.processDunning();

        // 8d overdue + suspend=7 -> stage suspend.
        expect(subRepo.update).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ status: 'suspended' }),
        );
        expect(emailService.sendAccountSuspended).toHaveBeenCalledTimes(1);
      });

      it('falls back to defaults if plan thresholds are non-strictly-increasing', async () => {
        const { userRepo, emailService } = getDeps();
        const brokenPlan = {
          code: 'broken',
          dunningThresholds: {
            // suspend (21) < cancelWarning (15): incoherente
            reminder1: 3,
            reminder2: 7,
            suspend: 21,
            cancelWarning: 15,
            cancel: 30,
          },
        };
        const inv = buildOverdueInvoice(14, {
          subscription: {
            id: fakeUuid(800),
            status: 'active',
            plan: brokenPlan,
          },
        });
        mockDunningCandidates([inv]);
        userRepo.findOne.mockResolvedValue({
          id: fakeUuid(900), email: 'a@b.cl', firstName: 'A',
        });

        await service.processDunning();

        // Fallback a defaults (suspend=14) -> 14d overdue cruza el threshold.
        expect(subRepo.update).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ status: 'suspended' }),
        );
      });

      it('plan with partial thresholds merges remaining keys with defaults', async () => {
        const { userRepo, emailService } = getDeps();
        const partialPlan = {
          code: 'partial',
          dunningThresholds: {
            // Solo redefine suspend; el resto debe venir de defaults.
            suspend: 21,
          },
        };
        // 20 dias overdue. Defaults: reminder1=3, reminder2=7. Custom suspend=21.
        // 20 dias cae en reminder2 (>=7) sin alcanzar suspend(21).
        const inv = buildOverdueInvoice(20, {
          subscription: {
            id: fakeUuid(800),
            status: 'active',
            plan: partialPlan,
          },
        });
        mockDunningCandidates([inv]);
        userRepo.findOne.mockResolvedValue({
          id: fakeUuid(900), email: 'a@b.cl', firstName: 'A',
        });

        await service.processDunning();

        expect(emailService.sendInvoiceOverdueUrgent).toHaveBeenCalledTimes(1);
        expect(subRepo.update).not.toHaveBeenCalled();
      });
    });
  });

  // ─── Fase 2 / Tarea 2.2 — issueCreditNote ───────────────────────────

  describe('issueCreditNote', () => {
    const tid = fakeUuid(100);

    beforeEach(() => {
      // El advisory lock para NC numbering usa el mismo dataSource.
      // Ya esta configurado en el outer beforeEach.
    });

    function setupNumberMock() {
      const numQb = createMockQueryBuilder();
      (numQb.getRawOne as jest.Mock).mockResolvedValue(null);
      invoiceRepo.createQueryBuilder.mockReturnValue(numQb);
    }

    function buildPaidInvoice(overrides: Record<string, any> = {}) {
      return {
        id: fakeUuid(700),
        tenantId: tid,
        invoiceNumber: 'EVA-2026-0042',
        type: InvoiceType.INVOICE,
        status: InvoiceStatus.PAID,
        total: 11.9,
        subtotal: 10,
        taxRate: 19,
        currency: 'UF',
        periodStart: new Date('2026-05-01'),
        periodEnd: new Date('2026-06-01'),
        tenant: { id: tid, name: 'Demo' },
        ...overrides,
      };
    }

    it('happy path: emite NC vinculada con numero EVA-NC y status DRAFT', async () => {
      const original = buildPaidInvoice();
      // 1ra findOne: lookup de original.
      // 2da find: NCs previas (vacio).
      invoiceRepo.findOne
        .mockResolvedValueOnce(original) // original
        .mockResolvedValueOnce({ id: fakeUuid(800), invoiceNumber: 'EVA-NC-2026-0001' }); // final reload
      invoiceRepo.find.mockResolvedValueOnce([]); // no NCs previas
      setupNumberMock();

      const result = await service.issueCreditNote(
        original.id,
        { amount: 5.95, reason: 'Refund parcial por error' },
        fakeUuid(200),
      );

      expect(result).toBeDefined();
      expect(dataSource.txSavedEntities[0]).toMatchObject({
        type: InvoiceType.CREDIT_NOTE,
        status: InvoiceStatus.DRAFT,
        originalInvoiceId: original.id,
        invoiceNumber: 'EVA-NC-2026-0001',
        total: 5.95,
        currency: 'UF',
      });
    });

    it('rechaza si invoice origen no existe', async () => {
      invoiceRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.issueCreditNote(fakeUuid(999), { amount: 1, reason: 'test' }, fakeUuid(200)),
      ).rejects.toThrow(/no encontrada/);
    });

    it('rechaza si invoice origen no esta PAID', async () => {
      invoiceRepo.findOne.mockResolvedValueOnce(
        buildPaidInvoice({ status: InvoiceStatus.DRAFT }),
      );
      await expect(
        service.issueCreditNote(fakeUuid(700), { amount: 1, reason: 'test' }, fakeUuid(200)),
      ).rejects.toThrow(/Solo facturas pagadas/);
    });

    it('rechaza si invoice origen es una credit note (no se hace NC sobre NC)', async () => {
      invoiceRepo.findOne.mockResolvedValueOnce(
        buildPaidInvoice({ type: InvoiceType.CREDIT_NOTE, status: InvoiceStatus.PAID }),
      );
      await expect(
        service.issueCreditNote(fakeUuid(700), { amount: 1, reason: 'test' }, fakeUuid(200)),
      ).rejects.toThrow(/nota de credito sobre una nota de credito/i);
    });

    it('rechaza si reason vacio', async () => {
      await expect(
        service.issueCreditNote(fakeUuid(700), { amount: 1, reason: '' }, fakeUuid(200)),
      ).rejects.toThrow(/reason es obligatorio/);
    });

    it('rechaza si amount <= 0', async () => {
      await expect(
        service.issueCreditNote(fakeUuid(700), { amount: 0, reason: 'test' }, fakeUuid(200)),
      ).rejects.toThrow(/amount debe ser > 0/);
      await expect(
        service.issueCreditNote(fakeUuid(700), { amount: -5, reason: 'test' }, fakeUuid(200)),
      ).rejects.toThrow(/amount debe ser > 0/);
    });

    it('rechaza si suma con NCs previas excede el total original (over-credit)', async () => {
      const original = buildPaidInvoice({ total: 11.9 });
      invoiceRepo.findOne.mockResolvedValueOnce(original);
      // NC previa de 8 -> queda 3.9 disponible. Intento 5 -> over-credit.
      invoiceRepo.find.mockResolvedValueOnce([{ id: fakeUuid(801), total: 8 }]);

      await expect(
        service.issueCreditNote(
          original.id,
          { amount: 5, reason: 'segundo refund' },
          fakeUuid(200),
        ),
      ).rejects.toThrow(/excede el saldo no-creditado/);
    });

    it('rechaza si tenantId no coincide (defense-in-depth)', async () => {
      invoiceRepo.findOne.mockResolvedValueOnce(
        buildPaidInvoice({ tenantId: fakeUuid(999) }),
      );
      await expect(
        service.issueCreditNote(
          fakeUuid(700),
          { amount: 1, reason: 'test' },
          fakeUuid(200),
          tid, // expected tenant
        ),
      ).rejects.toThrow(/no pertenece al tenant/);
    });
  });

  // ─── Fase 2 / Tarea 2.4.2 — Aplicacion auto de credit notes ─────────

  describe('generateInvoice — credit note auto-application', () => {
    function buildSubWithPlan(overrides: Record<string, any> = {}) {
      return {
        id: fakeUuid(600),
        tenantId,
        plan: createMockPlan({ monthlyPrice: 10 }),
        tenant: { id: tenantId, name: 'Demo' },
        startDate: new Date('2026-05-01'),
        billingPeriod: BillingPeriod.MONTHLY,
        aiAddonCalls: 0,
        aiAddonPrice: 0,
        ...overrides,
      };
    }

    it('aplica credit note disponible como linea negativa y marca APPLIED', async () => {
      const sub = buildSubWithPlan();
      subRepo.findOne.mockResolvedValue(sub);
      // findOne: continuidad (null), duplicate check (null), final reload.
      invoiceRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: fakeUuid(700) });
      // find: NCs disponibles - una NC de subtotal 4 UF.
      invoiceRepo.find.mockResolvedValueOnce([
        {
          id: fakeUuid(801),
          invoiceNumber: 'EVA-NC-2026-0001',
          subtotal: 4,
          status: InvoiceStatus.DRAFT,
          notes: null,
        },
      ]);

      await service.generateInvoice(sub.id);

      // Plan subtotal = 10, NC = 4 -> netSubtotal = 6, IVA = 1.14, total = 7.14.
      const savedInvoice = dataSource.txSavedEntities[0];
      expect(savedInvoice.subtotal).toBe(6);
      expect(savedInvoice.total).toBeCloseTo(7.14, 2);
    });

    it('NCs mas grandes que el subtotal NO se aplican (quedan disponibles para proxima)', async () => {
      const sub = buildSubWithPlan();
      subRepo.findOne.mockResolvedValue(sub);
      invoiceRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: fakeUuid(700) });
      // NC de subtotal 50 (mas grande que el plan 10) -> NO aplica.
      invoiceRepo.find.mockResolvedValueOnce([
        {
          id: fakeUuid(801),
          invoiceNumber: 'EVA-NC-2026-0001',
          subtotal: 50,
          status: InvoiceStatus.DRAFT,
          notes: null,
        },
      ]);

      await service.generateInvoice(sub.id);

      // Subtotal queda intacto = 10.
      const savedInvoice = dataSource.txSavedEntities[0];
      expect(savedInvoice.subtotal).toBe(10);
    });

    it('FIFO: aplica varias NCs en orden de issueDate hasta cubrir subtotal', async () => {
      const sub = buildSubWithPlan();
      subRepo.findOne.mockResolvedValue(sub);
      invoiceRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: fakeUuid(700) });
      // 3 NCs: 3 + 4 + 5. Plan subtotal 10. Aplican 3 + 4 = 7 (5 ya no cabe).
      invoiceRepo.find.mockResolvedValueOnce([
        { id: fakeUuid(801), invoiceNumber: 'EVA-NC-2026-0001', subtotal: 3, status: 'draft' },
        { id: fakeUuid(802), invoiceNumber: 'EVA-NC-2026-0002', subtotal: 4, status: 'draft' },
        { id: fakeUuid(803), invoiceNumber: 'EVA-NC-2026-0003', subtotal: 5, status: 'draft' },
      ]);

      await service.generateInvoice(sub.id);

      const savedInvoice = dataSource.txSavedEntities[0];
      // 10 - 3 - 4 = 3. (5 no cabe).
      expect(savedInvoice.subtotal).toBe(3);
    });

    it('sin credit notes disponibles: factura igual que pre-T2.4', async () => {
      const sub = buildSubWithPlan();
      subRepo.findOne.mockResolvedValue(sub);
      invoiceRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: fakeUuid(700) });
      invoiceRepo.find.mockResolvedValueOnce([]); // no NCs

      await service.generateInvoice(sub.id);

      const savedInvoice = dataSource.txSavedEntities[0];
      expect(savedInvoice.subtotal).toBe(10);
      expect(savedInvoice.total).toBeCloseTo(11.9, 2);
    });
  });
});
