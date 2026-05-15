/**
 * feedback.service.spec.ts — Auditoría feedback PR1.
 *
 * Cubre los fixes críticos de la auditoría:
 *  - Fix A: anonimato real (stripAnonymousSender en findFeedbackReceived).
 *  - Fix B: autorización de updateCheckIn (IDOR) + no muta `status`.
 *  - Fix B: cancelCheckIn (guards de estado, authz, metadata, audit, notif).
 */
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

  beforeEach(async () => {
    checkInRepo = createMockRepository();
    quickFeedbackRepo = createMockRepository();
    notifications = createMockNotificationsService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: getRepositoryToken(CheckIn), useValue: checkInRepo },
        { provide: getRepositoryToken(QuickFeedback), useValue: quickFeedbackRepo },
        { provide: getRepositoryToken(MeetingLocation), useValue: createMockRepository() },
        { provide: getRepositoryToken(User), useValue: createMockRepository() },
        { provide: getRepositoryToken(Tenant), useValue: createMockRepository() },
        { provide: getRepositoryToken(Objective), useValue: createMockRepository() },
        { provide: getRepositoryToken(Recognition), useValue: createMockRepository() },
        { provide: getRepositoryToken(Competency), useValue: createMockRepository() },
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
          useValue: { runForEachTenant: jest.fn().mockResolvedValue([]) },
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
});
