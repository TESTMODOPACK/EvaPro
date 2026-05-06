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

import { SignatureRemindersService } from './signature-reminders.service';
import { SignatureReminderSent } from '../entities/signature-reminder-sent.entity';
import { EvaluationResponse } from '../../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../../evaluations/entities/evaluation-assignment.entity';
import { EvaluationCycle, CycleStatus } from '../../evaluations/entities/evaluation-cycle.entity';
import { User } from '../../users/entities/user.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  createMockRepository,
  createMockNotificationsService,
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignatureRemindersService,
        { provide: getRepositoryToken(SignatureReminderSent), useValue: reminderRepo },
        { provide: getRepositoryToken(EvaluationResponse), useValue: responseRepo },
        { provide: getRepositoryToken(EvaluationAssignment), useValue: assignmentRepo },
        { provide: getRepositoryToken(EvaluationCycle), useValue: cycleRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<SignatureRemindersService>(SignatureRemindersService);
  });

  function setupCycleAndPending(daysSinceEnd: number, now: Date) {
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
  }

  // ─── pickLevel logic via processTenant ────────────────────────────

  it('D+3 envía recordatorio nivel 3', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(3, now);
    reminderRepo.findOne.mockResolvedValue(null);

    const result = await service.processTenant(tenantId, now);

    expect(result.sent[3]).toBe(1);
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: evaluateeId,
        title: expect.stringMatching(/firma/i),
        metadata: expect.objectContaining({ reminderLevel: 3 }),
      }),
    );
    expect(reminderRepo.save).toHaveBeenCalled();
  });

  it('D+7 envía nivel 7 (firme tone)', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(7, now);
    reminderRepo.findOne.mockResolvedValue(null);

    const result = await service.processTenant(tenantId, now);

    expect(result.sent[7]).toBe(1);
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/sigue pendiente/i),
        metadata: expect.objectContaining({ reminderLevel: 7 }),
      }),
    );
  });

  it('D+15 envía nivel 15 + escalado a tenant_admins', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(15, now);
    reminderRepo.findOne.mockResolvedValue(null);
    userRepo.find.mockResolvedValue([
      { id: fakeUuid(900) }, { id: fakeUuid(901) },
    ]);
    userRepo.findOne.mockResolvedValue({ firstName: 'Ana', lastName: 'Pérez' });

    const result = await service.processTenant(tenantId, now);

    expect(result.sent[15]).toBe(1);
    // 1 al evaluatee + 2 a tenant_admins = 3 calls
    expect(notificationsService.create).toHaveBeenCalledTimes(3);
    // Una de las llamadas a tenant_admin debe incluir nombre del evaluatee
    const adminCalls = notificationsService.create.mock.calls.filter(
      (c: any) => c[0].title?.includes('atrasada'),
    );
    expect(adminCalls.length).toBe(2);
    expect(adminCalls[0][0].message).toContain('Ana Pérez');
  });

  it('D+5 (entre 3 y 7) NO envía recordatorio (fuera de ventana)', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(5, now);

    const result = await service.processTenant(tenantId, now);

    expect(result.sent).toEqual({ 3: 0, 7: 0, 15: 0 });
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  // ─── idempotencia ──────────────────────────────────────────────────

  it('si ya se envió ESE nivel para ese (doc, user), NO reenvía', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(3, now);
    reminderRepo.findOne.mockResolvedValue({ id: 'already-sent' });

    const result = await service.processTenant(tenantId, now);

    expect(result.sent[3]).toBe(0);
    expect(result.skipped[3]).toBe(1);
    expect(notificationsService.create).not.toHaveBeenCalled();
    expect(reminderRepo.save).not.toHaveBeenCalled();
  });

  it('idempotencia se chequea con (documentType, documentId, userId, reminderLevel)', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    setupCycleAndPending(7, now);
    reminderRepo.findOne.mockResolvedValue(null);

    await service.processTenant(tenantId, now);

    expect(reminderRepo.findOne).toHaveBeenCalledWith({
      where: {
        documentType: 'evaluation_response',
        documentId: responseId,
        userId: evaluateeId,
        reminderLevel: 7,
      },
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
});
