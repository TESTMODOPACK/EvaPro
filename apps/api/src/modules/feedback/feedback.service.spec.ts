/**
 * feedback.service.spec.ts — Auditoría feedback PR1-PR3.
 *
 * PR1: Fix A (anonimato), Fix B (updateCheckIn IDOR, cancelCheckIn).
 * PR2: Fix C (competencia real), Fix D (visibility en exports).
 * PR3: Bug 9 (accept on-behalf), Bug 10 (self/inactivo),
 *      Bug 11 (expiry REQUESTED), Bug 12 (groserías por palabra).
 */
// Bug 11 — el cron usa runWithCronLock (util module-level). Lo
// neutralizamos para poder ejercitar la lógica interna en unit test.
jest.mock('../../common/utils/cron-lock', () => ({
  runWithCronLock: (_n: string, _ds: any, _l: any, fn: () => Promise<void>) => fn(),
}));
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { FeedbackService } from './feedback.service';
import { CheckIn, CheckInStatus } from './entities/checkin.entity';
import { QuickFeedback, Sentiment } from './entities/quick-feedback.entity';
import { MeetingLocation } from './entities/meeting-location.entity';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Objective } from '../objectives/entities/objective.entity';
import { Recognition } from '../recognition/entities/recognition.entity';
import { Competency } from '../development/entities/competency.entity';
import { AiInsightsService } from '../ai-insights/ai-insights.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';
import { PushService } from '../notifications/push.service';
import { AuditService } from '../audit/audit.service';
import { TenantCronRunner } from '../../common/rls/tenant-cron-runner';
import {
  createMockRepository,
  createMockDataSource,
  createMockAuditService,
  createMockNotificationsService,
  createMockEmailService,
  fakeUuid,
} from '../../../test/test-utils';

const TID = fakeUuid(100);
const MANAGER_ID = fakeUuid(1);
const EMPLOYEE_ID = fakeUuid(2);
const OUTSIDER_ID = fakeUuid(3);
const ADMIN_ID = fakeUuid(4);
const CI_ID = fakeUuid(500);

function makeCheckIn(overrides: Partial<CheckIn> = {}): CheckIn {
  return {
    id: CI_ID,
    tenantId: TID,
    managerId: MANAGER_ID,
    employeeId: EMPLOYEE_ID,
    scheduledDate: new Date('2099-01-15') as any,
    scheduledTime: '10:00',
    topic: 'Seguimiento trimestral',
    status: CheckInStatus.SCHEDULED,
    actionItems: [],
    agendaTopics: [],
    cancelledAt: null,
    cancelReason: null,
    ...overrides,
  } as CheckIn;
}

function makeFeedback(overrides: Partial<QuickFeedback> = {}): QuickFeedback {
  return {
    id: fakeUuid(700),
    tenantId: TID,
    fromUserId: MANAGER_ID,
    fromUser: { id: MANAGER_ID, firstName: 'Ana', lastName: 'Jefa', email: 'ana@x.cl' } as any,
    toUserId: EMPLOYEE_ID,
    message: 'Buen trabajo en el proyecto X, mantén ese nivel de detalle.',
    sentiment: Sentiment.POSITIVE,
    isAnonymous: false,
    createdAt: new Date(),
    ...overrides,
  } as QuickFeedback;
}

describe('FeedbackService — auditoría PR1', () => {
  let service: FeedbackService;
  let checkInRepo: any;
  let quickFeedbackRepo: any;
  let notifications: any;
  let userRepo: any;
  let tenantRepo: any;
  let competencyRepo: any;

  beforeEach(async () => {
    checkInRepo = createMockRepository();
    quickFeedbackRepo = createMockRepository();
    notifications = createMockNotificationsService();
    userRepo = createMockRepository();
    tenantRepo = createMockRepository();
    competencyRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: getRepositoryToken(CheckIn), useValue: checkInRepo },
        { provide: getRepositoryToken(QuickFeedback), useValue: quickFeedbackRepo },
        { provide: getRepositoryToken(MeetingLocation), useValue: createMockRepository() },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(Objective), useValue: createMockRepository() },
        { provide: getRepositoryToken(Recognition), useValue: createMockRepository() },
        { provide: getRepositoryToken(Competency), useValue: competencyRepo },
        {
          provide: AiInsightsService,
          useValue: { generateAgendaSuggestions: jest.fn() },
        },
        {
          provide: SubscriptionsService,
          useValue: { findByTenantId: jest.fn().mockResolvedValue(null) },
        },
        { provide: NotificationsService, useValue: notifications },
        { provide: EmailService, useValue: createMockEmailService() },
        {
          provide: PushService,
          useValue: { sendToUser: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: AuditService, useValue: createMockAuditService() },
        { provide: DataSource, useValue: createMockDataSource() },
        {
          provide: TenantCronRunner,
          useValue: {
            // Invoca el callback con TID para poder testear la lógica
            // interna de los crons tenant-scoped (Bug 11).
            runForEachTenant: jest.fn(
              async (_name: string, cb: (t: string) => Promise<void>) => {
                await cb(TID);
              },
            ),
          },
        },
      ],
    }).compile();

    service = module.get<FeedbackService>(FeedbackService);
  });

  // ─── Fix A — anonimato real ─────────────────────────────────────────
  describe('findFeedbackReceived (Fix A: anonimato)', () => {
    it('elimina fromUser/fromUserId cuando isAnonymous=true', async () => {
      quickFeedbackRepo.find.mockResolvedValue([
        makeFeedback({ isAnonymous: true }),
      ]);

      const [fb] = await service.findFeedbackReceived(TID, EMPLOYEE_ID);

      expect(fb.isAnonymous).toBe(true);
      expect(fb.fromUserId).toBeNull();
      expect(fb.fromUser).toBeNull();
    });

    it('preserva el emisor cuando NO es anónimo', async () => {
      quickFeedbackRepo.find.mockResolvedValue([
        makeFeedback({ isAnonymous: false }),
      ]);

      const [fb] = await service.findFeedbackReceived(TID, EMPLOYEE_ID);

      expect(fb.fromUserId).toBe(MANAGER_ID);
      expect(fb.fromUser).not.toBeNull();
    });
  });

  describe('exportFeedbackCsv (Fix A: anonimato en export admin)', () => {
    it('no expone el nombre del emisor anónimo en el CSV', async () => {
      checkInRepo.find.mockResolvedValue([]);
      quickFeedbackRepo.find.mockResolvedValue([
        makeFeedback({
          isAnonymous: true,
          fromUser: { firstName: 'Ana', lastName: 'Jefa' } as any,
          toUser: { firstName: 'Beto', lastName: 'Emp' } as any,
        }),
      ]);

      const csv = await service.exportFeedbackCsv(TID);

      expect(csv).toContain('Anónimo');
      expect(csv).not.toContain('Ana Jefa');
    });
  });

  // ─── Fix B — updateCheckIn authz ────────────────────────────────────
  describe('updateCheckIn (Fix B: IDOR)', () => {
    it('rechaza a un usuario que no es dueño ni admin', async () => {
      checkInRepo.findOne.mockResolvedValue(makeCheckIn());

      await expect(
        service.updateCheckIn(TID, CI_ID, OUTSIDER_ID, 'employee', {
          topic: 'Hackeado',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(checkInRepo.save).not.toHaveBeenCalled();
    });

    it('permite al manager dueño editar campos', async () => {
      checkInRepo.findOne.mockResolvedValue(makeCheckIn());

      await service.updateCheckIn(TID, CI_ID, MANAGER_ID, 'manager', {
        topic: 'Nuevo tema',
      });

      expect(checkInRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'Nuevo tema' }),
      );
    });

    it('permite a un tenant_admin que no es participante', async () => {
      checkInRepo.findOne.mockResolvedValue(makeCheckIn());

      await service.updateCheckIn(TID, CI_ID, ADMIN_ID, 'tenant_admin', {
        notes: 'nota admin',
      });

      expect(checkInRepo.save).toHaveBeenCalled();
    });

    it('NO muta status aunque venga en el DTO', async () => {
      checkInRepo.findOne.mockResolvedValue(makeCheckIn());

      await service.updateCheckIn(TID, CI_ID, MANAGER_ID, 'manager', {
        status: 'completed',
      } as any);

      const saved = checkInRepo.save.mock.calls[0][0];
      expect(saved.status).toBe(CheckInStatus.SCHEDULED);
    });
  });

  // ─── Fix B — cancelCheckIn ──────────────────────────────────────────
  describe('cancelCheckIn (Fix B)', () => {
    it('404 si no existe', async () => {
      checkInRepo.findOne.mockResolvedValue(null);
      await expect(
        service.cancelCheckIn(TID, CI_ID, MANAGER_ID, 'manager'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400 si el check-in ya está completado', async () => {
      checkInRepo.findOne.mockResolvedValue(
        makeCheckIn({ status: CheckInStatus.COMPLETED }),
      );
      await expect(
        service.cancelCheckIn(TID, CI_ID, MANAGER_ID, 'manager'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('403 si no es dueño ni admin', async () => {
      checkInRepo.findOne.mockResolvedValue(makeCheckIn());
      await expect(
        service.cancelCheckIn(TID, CI_ID, OUTSIDER_ID, 'employee'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('manager dueño anula: setea metadata + notifica al empleado', async () => {
      checkInRepo.findOne.mockResolvedValue(makeCheckIn());
      checkInRepo.save.mockImplementation((e: any) => Promise.resolve(e));

      const result = await service.cancelCheckIn(
        TID,
        CI_ID,
        MANAGER_ID,
        'manager',
        'Conflicto de agenda',
      );

      expect(result.status).toBe(CheckInStatus.CANCELLED);
      expect(result.cancelledAt).toBeInstanceOf(Date);
      expect(result.cancelReason).toBe('Conflicto de agenda');
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: EMPLOYEE_ID }),
      );
    });

    it('admin externo anula: notifica a manager y empleado', async () => {
      checkInRepo.findOne.mockResolvedValue(makeCheckIn());
      checkInRepo.save.mockImplementation((e: any) => Promise.resolve(e));

      await service.cancelCheckIn(TID, CI_ID, ADMIN_ID, 'tenant_admin');

      const notifiedUserIds = notifications.create.mock.calls.map(
        (c: any[]) => c[0].userId,
      );
      expect(notifiedUserIds).toEqual(
        expect.arrayContaining([MANAGER_ID, EMPLOYEE_ID]),
      );
    });

    it('permite anular un check-in en estado REQUESTED', async () => {
      checkInRepo.findOne.mockResolvedValue(
        makeCheckIn({ status: CheckInStatus.REQUESTED }),
      );
      checkInRepo.save.mockImplementation((e: any) => Promise.resolve(e));

      const result = await service.cancelCheckIn(
        TID,
        CI_ID,
        MANAGER_ID,
        'manager',
      );
      expect(result.status).toBe(CheckInStatus.CANCELLED);
    });
  });

  // ─── Fix C — competencia real (Bugs 4,5,7) ──────────────────────────
  describe('createQuickFeedback (Fix C: competencia)', () => {
    function dto(extra: any = {}) {
      return {
        toUserId: EMPLOYEE_ID,
        message: 'Mensaje suficientemente largo para pasar el mínimo de 20.',
        sentiment: Sentiment.POSITIVE,
        ...extra,
      };
    }

    it('rechaza competencyId que no pertenece al tenant (Bug 7)', async () => {
      tenantRepo.findOne.mockResolvedValue({ id: TID, settings: {} });
      userRepo.findOne.mockResolvedValue({ id: EMPLOYEE_ID });
      competencyRepo.findOne.mockResolvedValue(null); // no existe en tenant

      await expect(
        service.createQuickFeedback(TID, MANAGER_ID, dto({ competencyId: fakeUuid(999) }), 'manager'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(quickFeedbackRepo.save).not.toHaveBeenCalled();
    });

    it('requireCompetency=true sin competencyId → 400 (Bug 4)', async () => {
      tenantRepo.findOne.mockResolvedValue({
        id: TID,
        settings: { feedbackConfig: { requireCompetency: true } },
      });
      userRepo.findOne.mockResolvedValue({ id: EMPLOYEE_ID });

      await expect(
        service.createQuickFeedback(TID, MANAGER_ID, dto(), 'manager'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('competencyId válido (tenant + activo) se persiste (Bug 5)', async () => {
      const COMP = fakeUuid(800);
      tenantRepo.findOne.mockResolvedValue({
        id: TID,
        settings: { feedbackConfig: { requireCompetency: true } },
      });
      userRepo.findOne.mockResolvedValue({ id: EMPLOYEE_ID, firstName: 'B', lastName: 'E' });
      competencyRepo.findOne.mockResolvedValue({ id: COMP });
      quickFeedbackRepo.save.mockImplementation((e: any) => Promise.resolve({ id: 'qf', ...e }));

      await service.createQuickFeedback(TID, MANAGER_ID, dto({ competencyId: COMP }), 'manager');

      expect(competencyRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: COMP, tenantId: TID, isActive: true } }),
      );
      expect(quickFeedbackRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ competencyId: COMP }),
      );
    });
  });

  // ─── Fix D — enforcement de visibility (Bug 6) ──────────────────────
  describe('exportFeedbackCsv (Fix D: visibility)', () => {
    const A = fakeUuid(11); // emisor
    const B = fakeUuid(12); // receptor
    const M = fakeUuid(13); // manager del receptor

    function fb(visibility: any, over: any = {}) {
      return makeFeedback({
        visibility,
        message: `msg-${visibility}`,
        fromUserId: A,
        toUserId: B,
        fromUser: { firstName: 'Emi', lastName: 'Sor' } as any,
        toUser: { firstName: 'Rec', lastName: 'Eptor', managerId: M } as any,
        ...over,
      });
    }

    it('export admin: excluye private, mantiene public y manager_only', async () => {
      checkInRepo.find.mockResolvedValue([]);
      quickFeedbackRepo.find.mockResolvedValue([
        fb('public'),
        fb('private'),
        fb('manager_only'),
      ]);

      const csv = await service.exportFeedbackCsv(TID); // admin (sin managerId)

      expect(csv).toContain('msg-public');
      expect(csv).toContain('msg-manager_only');
      expect(csv).not.toContain('msg-private');
    });

    it('export manager: ve private solo si participa; manager_only si es el jefe del receptor', async () => {
      // getTeamScopeForFeedbackExport hace userRepo.find → reportes del manager
      userRepo.find.mockResolvedValue([{ id: B }]);
      checkInRepo.find.mockResolvedValue([]);
      quickFeedbackRepo.find.mockResolvedValue([
        fb('public'),
        fb('private'), // M no es emisor ni receptor → excluir
        fb('manager_only'), // M es manager del receptor → incluir
      ]);

      const csv = await service.exportFeedbackCsv(TID, M);

      expect(csv).toContain('msg-public');
      expect(csv).toContain('msg-manager_only');
      expect(csv).not.toContain('msg-private');
    });
  });

  // ─── Bug 9 — accept on-behalf por admin ─────────────────────────────
  describe('acceptCheckInRequest (Bug 9)', () => {
    function requested() {
      return makeCheckIn({
        status: CheckInStatus.REQUESTED,
        managerId: MANAGER_ID,
        scheduledDate: new Date('2099-02-01') as any,
      });
    }

    it('un tenant_admin que no es el encargado puede aceptar en su nombre', async () => {
      checkInRepo.findOne.mockResolvedValue(requested());
      checkInRepo.update.mockResolvedValue({ affected: 1 });
      checkInRepo.createQueryBuilder.mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(makeCheckIn({ status: CheckInStatus.SCHEDULED })),
      });

      await expect(
        service.acceptCheckInRequest(TID, CI_ID, ADMIN_ID, 'tenant_admin'),
      ).resolves.toBeDefined();
      expect(checkInRepo.update).toHaveBeenCalled();
    });

    it('un usuario que no es encargado ni admin recibe 403', async () => {
      checkInRepo.findOne.mockResolvedValue(requested());
      await expect(
        service.acceptCheckInRequest(TID, CI_ID, OUTSIDER_ID, 'manager'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ─── Bug 10 — auto-feedback / receptor inactivo ─────────────────────
  describe('createQuickFeedback (Bug 10)', () => {
    const baseDto = {
      message: 'Mensaje suficientemente largo para superar el mínimo.',
      sentiment: Sentiment.POSITIVE,
    };

    it('rechaza enviarse feedback a sí mismo', async () => {
      tenantRepo.findOne.mockResolvedValue({ id: TID, settings: {} });
      await expect(
        service.createQuickFeedback(TID, MANAGER_ID, { ...baseDto, toUserId: MANAGER_ID }, 'manager'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza feedback a un colaborador inactivo', async () => {
      tenantRepo.findOne.mockResolvedValue({ id: TID, settings: {} });
      userRepo.findOne.mockResolvedValue({ id: EMPLOYEE_ID, isActive: false });
      await expect(
        service.createQuickFeedback(TID, MANAGER_ID, { ...baseDto, toUserId: EMPLOYEE_ID }, 'manager'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ─── Bug 12 — groserías por límite de palabra ───────────────────────
  describe('validateFeedbackContent (Bug 12)', () => {
    const send = (message: string) => {
      tenantRepo.findOne.mockResolvedValue({ id: TID, settings: {} });
      userRepo.findOne.mockResolvedValue({ id: EMPLOYEE_ID, isActive: true });
      quickFeedbackRepo.save.mockImplementation((e: any) => Promise.resolve({ id: 'qf', ...e }));
      return service.createQuickFeedback(
        TID,
        MANAGER_ID,
        { toUserId: EMPLOYEE_ID, message, sentiment: Sentiment.POSITIVE },
        'manager',
      );
    };

    it('NO bloquea un falso positivo por substring ("reinutilizable")', async () => {
      await expect(
        send('El componente quedó reinutilizable y muy bien documentado, gran avance.'),
      ).resolves.toBeDefined();
    });

    it('bloquea una grosería real como palabra ("inútil")', async () => {
      await expect(
        send('Sinceramente tu aporte fue inútil y no sirvió para nada en absoluto.'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('bloquea la forma plural ("idiotas")', async () => {
      await expect(
        send('Dejen de comportarse como idiotas durante las reuniones del equipo.'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ─── Bug 11 — expiry de solicitudes REQUESTED ───────────────────────
  describe('autoCompleteStaleCheckIns (Bug 11)', () => {
    it('anula solicitudes REQUESTED con más de 14 días', async () => {
      // 1ª find = SCHEDULED vencidos (vacío); 2ª find = REQUESTED viejos.
      checkInRepo.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: fakeUuid(901), tenantId: TID, managerId: MANAGER_ID, employeeId: EMPLOYEE_ID, topic: 'Solicitud vieja' },
        ]);
      checkInRepo.update.mockResolvedValue({ affected: 1 });

      await service.autoCompleteStaleCheckIns();

      expect(checkInRepo.update).toHaveBeenCalledWith(
        { id: fakeUuid(901) },
        expect.objectContaining({
          status: CheckInStatus.CANCELLED,
          cancelledAt: expect.any(Date),
          cancelReason: expect.stringContaining('expirada'),
        }),
      );
    });
  });
});
