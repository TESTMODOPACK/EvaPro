/**
 * signature-reminders.service.spec.ts — TAREA 10 / G11.
 *
 * Tests del SignatureRemindersService:
 *  - pickLevel correcto para D+3, D+7, D+15 (con ventana de 1 día)
 *  - Idempotencia: si ya se envió este nivel, no se reenvía
 *  - Multi-tenant: solo procesa el tenantId solicitado
 *  - Escalado D+15: notifica a tenant_admins además del usuario
 *  - Best-effort: fallo de notification no bloquea otros recordatorios
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { SignatureRemindersService } from './signature-reminders.service';
import { SignatureReminderSent } from '../entities/signature-reminder-sent.entity';
import { EvaluationResponse } from '../../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../../evaluations/entities/evaluation-assignment.entity';
import { EvaluationCycle, CycleStatus } from '../../evaluations/entities/evaluation-cycle.entity';
import { User } from '../../users/entities/user.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { TenantCronRunner } from '../../../common/rls/tenant-cron-runner';
import {
  createMockRepository,
  createMockNotificationsService,
  createMockDataSource,
  fakeUuid,
} from '../../../../test/test-utils';

describe('SignatureRemindersService (G11)', () => {
  let service: SignatureRemindersService;
  let reminderRepo: any;
  let responseRepo: any;
  let assignmentRepo: any;
  let cycleRepo: any;
  let userRepo: any;
  let notificationsService: any;
  let dataSource: any;
  let tenantCronRunner: any;

  const tenantId = fakeUuid(100);
  const otherTenantId = fakeUuid(101);
  const cycleId = fakeUuid(200);
  const responseId = fakeUuid(50);
  const evaluateeId = fakeUuid(2);

  beforeEach(async () => {
    reminderRepo = createMockRepository();
    responseRepo = createMockRepository();
    assignmentRepo = createMockRepository();
    cycleRepo = createMockRepository();
    userRepo = createMockRepository();
    notificationsService = createMockNotificationsService();
    dataSource = createMockDataSource();
    // Mock TenantCronRunner.runForEachTenant: invoca callback inmediatamente
    // con un tenantId fake (usamos el mismo que los tests usan).
    tenantCronRunner = {
      runForEachTenant: jest.fn().mockImplementation(async (_label: string, cb: any) => {
        const result = await cb(tenantId);
        return [result];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignatureRemindersService,
        { provide: getRepositoryToken(SignatureReminderSent), useValue: reminderRepo },
        { provide: getRepositoryToken(EvaluationResponse), useValue: responseRepo },
        { provide: getRepositoryToken(EvaluationAssignment), useValue: assignmentRepo },
        { provide: getRepositoryToken(EvaluationCycle), useValue: cycleRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: DataSource, useValue: dataSource },
        { provide: TenantCronRunner, useValue: tenantCronRunner },
      ],
    }).compile();

    service = module.get<SignatureRemindersService>(SignatureRemindersService);
  });

  function setupCycleAndPending(daysSinceEnd: number, now: Date, sentLevels: number[] = []) {
    const cycleEnd = new Date(now.getTime() - daysSinceEnd * 24 * 60 * 60 * 1000);
    cycleRepo.find.mockResolvedValue([
      { id: cycleId, tenantId, status: CycleStatus.CLOSED, endDate: cycleEnd },
    ]);
    // Mock query builder for pendingResponses
    const qb: any = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { er_id: responseId, ea_evaluateeId: evaluateeId },
      ]),
    };
    responseRepo.createQueryBuilder.mockReturnValue(qb);
    // B3 fix: ahora usamos `find` para traer todos los niveles enviados
    reminderRepo.find.mockResolvedValue(
      sentLevels.map((lvl) => ({ reminderLevel: lvl })),
    );
  }

  // ─── pickNextLevel logic via processTenant ────────────────────────

  it('D+3 sin envíos previos: envía nivel 3', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(3, now, []);

    const result = await service.processTenant(tenantId, now);

    expect(result.sent[3]).toBe(1);
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: evaluateeId,
        metadata: expect.objectContaining({ reminderLevel: 3 }),
      }),
    );
    expect(reminderRepo.save).toHaveBeenCalled();
  });

  it('D+7 con L3 ya enviado: envía nivel 7 (firme tone)', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(7, now, [3]);

    const result = await service.processTenant(tenantId, now);

    expect(result.sent[7]).toBe(1);
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/sigue pendiente/i),
        metadata: expect.objectContaining({ reminderLevel: 7 }),
      }),
    );
  });

  it('D+15 con L3+L7 ya enviados: envía nivel 15 + escalado a tenant_admins', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(15, now, [3, 7]);
    userRepo.find.mockResolvedValue([
      { id: fakeUuid(900) }, { id: fakeUuid(901) },
    ]);
    userRepo.findOne.mockResolvedValue({ firstName: 'Ana', lastName: 'Pérez' });

    const result = await service.processTenant(tenantId, now);

    expect(result.sent[15]).toBe(1);
    expect(notificationsService.create).toHaveBeenCalledTimes(3);
    const adminCalls = notificationsService.create.mock.calls.filter(
      (c: any) => c[0].title?.includes('atrasada'),
    );
    expect(adminCalls.length).toBe(2);
    expect(adminCalls[0][0].message).toContain('Ana Pérez');
  });

  // ─── B3 fix: catch-up tras outage del worker ───────────────────────

  it('B3: D+5 sin envíos (worker estuvo down día 3-4): envía L3 (catch-up lowest unsent)', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(5, now, []);

    const result = await service.processTenant(tenantId, now);

    expect(result.sent[3]).toBe(1);
    expect(result.sent[7]).toBe(0);
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ reminderLevel: 3 }),
      }),
    );
  });

  it('B3: D+10 con solo L3 enviado: envía L7 (no salta a L15)', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(10, now, [3]);

    const result = await service.processTenant(tenantId, now);

    expect(result.sent[7]).toBe(1);
    expect(result.sent[15]).toBe(0);
  });

  it('B3: D+25 con L3+L7+L15 ya enviados: NO envía nada', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(25, now, [3, 7, 15]);

    const result = await service.processTenant(tenantId, now);

    expect(result.sent).toEqual({ 3: 0, 7: 0, 15: 0 });
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('B3: D+25 con solo L3+L7 (worker down día 15-25): envía L15 escalado', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(25, now, [3, 7]);
    userRepo.find.mockResolvedValue([{ id: fakeUuid(900) }]);
    userRepo.findOne.mockResolvedValue({ firstName: 'Ana', lastName: 'Pérez' });

    const result = await service.processTenant(tenantId, now);

    expect(result.sent[15]).toBe(1);
  });

  it('B3: cutoff extendido a 30 días (D+29 todavía procesa)', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(29, now, [3, 7]);
    userRepo.find.mockResolvedValue([]);

    const result = await service.processTenant(tenantId, now);

    expect(result.sent[15]).toBe(1);
  });

  it('B3: cutoff a 31 días excluye el ciclo (fuera de ventana)', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(31, now, []);

    const result = await service.processTenant(tenantId, now);

    expect(result.sent).toEqual({ 3: 0, 7: 0, 15: 0 });
  });

  // ─── idempotencia (refactored para nuevo modelo) ───────────────────

  it('idempotencia: si TODOS los niveles aplicables ya se enviaron, no reenvía y registra skipped', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(7, now, [3, 7]);

    const result = await service.processTenant(tenantId, now);

    expect(result.sent).toEqual({ 3: 0, 7: 0, 15: 0 });
    // skipped registra los que ya estaban enviados Y aplicables (3 y 7)
    expect(result.skipped[3]).toBe(1);
    expect(result.skipped[7]).toBe(1);
    expect(notificationsService.create).not.toHaveBeenCalled();
    expect(reminderRepo.save).not.toHaveBeenCalled();
  });

  it('idempotencia: query trae todos los niveles enviados para (doc, user)', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(7, now, []);

    await service.processTenant(tenantId, now);

    expect(reminderRepo.find).toHaveBeenCalledWith({
      where: {
        documentType: 'evaluation_response',
        documentId: responseId,
        userId: evaluateeId,
      },
      select: ['reminderLevel'],
    });
  });

  // ─── multi-tenant ──────────────────────────────────────────────────

  it('solo procesa ciclos del tenant solicitado', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    const cycleEnd = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    cycleRepo.find.mockResolvedValue([
      { id: cycleId, tenantId, status: CycleStatus.CLOSED, endDate: cycleEnd },
    ]);
    const qb: any = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    responseRepo.createQueryBuilder.mockReturnValue(qb);

    await service.processTenant(otherTenantId, now);

    expect(cycleRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: otherTenantId }),
      }),
    );
  });

  // ─── ciclos sin pendientes ─────────────────────────────────────────

  it('si NO hay evaluation_responses pendientes, no envía nada', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    const cycleEnd = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    cycleRepo.find.mockResolvedValue([
      { id: cycleId, tenantId, status: CycleStatus.CLOSED, endDate: cycleEnd },
    ]);
    const qb: any = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    responseRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.processTenant(tenantId, now);

    expect(result.sent).toEqual({ 3: 0, 7: 0, 15: 0 });
  });

  it('si NO hay ciclos cerrados, no procesa nada', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    cycleRepo.find.mockResolvedValue([]);

    const result = await service.processTenant(tenantId, now);

    expect(result.sent).toEqual({ 3: 0, 7: 0, 15: 0 });
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  // ─── best-effort: fallo de notification no bloquea ─────────────────

  it('fallo de un envío no bloquea otros (best-effort)', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    const cycleEnd = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    cycleRepo.find.mockResolvedValue([
      { id: cycleId, tenantId, status: CycleStatus.CLOSED, endDate: cycleEnd },
    ]);
    const qb: any = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { er_id: responseId, ea_evaluateeId: evaluateeId },
        { er_id: fakeUuid(51), ea_evaluateeId: fakeUuid(3) },
      ]),
    };
    responseRepo.createQueryBuilder.mockReturnValue(qb);
    reminderRepo.findOne.mockResolvedValue(null);
    // Primer envío falla, segundo OK
    notificationsService.create
      .mockRejectedValueOnce(new Error('Email service down'))
      .mockResolvedValueOnce(undefined);

    const result = await service.processTenant(tenantId, now);

    // Al menos uno se envió a pesar del fallo
    expect(result.sent[3]).toBe(1);
  });

  // ─── Mejora #5: @Cron runDailyReminders ─────────────────────────────

  describe('runDailyReminders (@Cron Mejora #5)', () => {
    /**
     * Helper: crea un queryRunner mock que simula obtener el advisory lock.
     * `locked=true` permite que el cron entre al body; `locked=false` skip.
     */
    function setupLock(locked: boolean) {
      const runner: any = {
        connect: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('pg_try_advisory_lock')) {
            return Promise.resolve([{ locked }]);
          }
          if (sql.includes('pg_advisory_unlock')) {
            return Promise.resolve([{ pg_advisory_unlock: true }]);
          }
          return Promise.resolve([]);
        }),
      };
      dataSource.createQueryRunner.mockReturnValue(runner);
      return runner;
    }

    it('itera tenants via runForEachTenant con label correcto cuando obtiene el lock', async () => {
      setupLock(true);
      const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      responseRepo.createQueryBuilder.mockReturnValue(qb);

      await service.runDailyReminders();

      expect(tenantCronRunner.runForEachTenant).toHaveBeenCalledWith(
        'signatureRemindersDaily',
        expect.any(Function),
      );
    });

    it('usa advisory lock (queryRunner.query con pg_try_advisory_lock)', async () => {
      const runner = setupLock(true);
      const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      responseRepo.createQueryBuilder.mockReturnValue(qb);

      await service.runDailyReminders();

      // El queryRunner debe haber pedido advisory lock + unlock
      const sqlCalls = runner.query.mock.calls.map((c: any[]) => c[0]);
      expect(sqlCalls.some((s: string) => s.includes('pg_try_advisory_lock'))).toBe(true);
      expect(sqlCalls.some((s: string) => s.includes('pg_advisory_unlock'))).toBe(true);
      expect(runner.release).toHaveBeenCalled();
    });

    it('si el lock falla (otra replica corriendo), skip sin procesar tenants', async () => {
      setupLock(false);

      await expect(service.runDailyReminders()).resolves.toBeUndefined();

      // tenantCronRunner NO debe haberse llamado (skipped por lock)
      expect(tenantCronRunner.runForEachTenant).not.toHaveBeenCalled();
    });
  });
});
