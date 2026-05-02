/**
 * objectives.service.spec.ts — Tests unitarios del ObjectivesService.
 *
 * Cubre la auditoría P0 — Tarea 1 (BUG-1: auto-completion de OKR cuando
 * todos los KRs llegan a 100%):
 *   - completeObjective helper: transición + side-effects + idempotencia
 *   - addProgressUpdate: SMART/KPI/OKR-sin-KR manual completion
 *   - updateKeyResult: auto-completion de OKR cuando KRs llegan a 100%
 *   - Status guard: solo desde ACTIVE (no DRAFT/PENDING/ABANDONED)
 *   - Idempotencia: re-llamadas no re-disparan side-effects
 *
 * NO cubre todavía: aprobación/rechazo, comments, cycles, tree, exports.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ObjectivesService } from './objectives.service';
import {
  Objective,
  ObjectiveStatus,
  ObjectiveType,
} from './entities/objective.entity';
import { ObjectiveUpdate } from './entities/objective-update.entity';
import { ObjectiveComment } from './entities/objective-comment.entity';
import { KeyResult, KRStatus } from './entities/key-result.entity';
import { User } from '../users/entities/user.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { RecognitionService } from '../recognition/recognition.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../notifications/push.service';
import {
  createMockRepository,
  createMockAuditService,
  createMockNotificationsService,
  fakeUuid,
} from '../../../test/test-utils';

const TID = fakeUuid(100);
const OID = fakeUuid(200);
const UID = fakeUuid(1);
const MGR = fakeUuid(2);
const ACTOR = fakeUuid(3);

function makeObj(overrides: Partial<Objective> = {}): Objective {
  return {
    id: OID,
    tenantId: TID,
    userId: UID,
    title: 'Test Objective',
    description: '',
    type: ObjectiveType.OKR,
    progress: 0,
    targetDate: null as any,
    status: ObjectiveStatus.ACTIVE,
    weight: 0,
    parentObjectiveId: null,
    cycleId: null as any,
    rejectionReason: null,
    approvedBy: null,
    approver: null,
    approvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    updates: [],
    keyResults: [],
    tenant: null as any,
    user: null as any,
    parent: null as any,
    children: [],
    ...overrides,
  } as Objective;
}

function makeKR(overrides: Partial<KeyResult> = {}): KeyResult {
  return {
    id: fakeUuid(300),
    tenantId: TID,
    objectiveId: OID,
    description: 'KR test',
    unit: '%',
    baseValue: 0,
    targetValue: 100,
    currentValue: 0,
    status: KRStatus.ACTIVE,
    objective: null as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as KeyResult;
}

describe('ObjectivesService — Tarea 1 (auto-completion)', () => {
  let service: ObjectivesService;
  let objRepo: any;
  let updateRepo: any;
  let krRepo: any;
  let userRepo: any;
  let recognitionService: any;
  let notificationsService: any;
  let emailService: any;
  let auditService: any;

  beforeEach(async () => {
    objRepo = createMockRepository();
    updateRepo = createMockRepository();
    krRepo = createMockRepository();
    userRepo = createMockRepository();
    recognitionService = {
      addPoints: jest.fn().mockResolvedValue(undefined),
      checkAutoBadges: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = createMockNotificationsService();
    emailService = {
      sendObjectiveAssigned: jest.fn().mockResolvedValue(undefined),
      sendObjectiveCompleted: jest.fn().mockResolvedValue(undefined),
    };
    auditService = createMockAuditService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObjectivesService,
        { provide: getRepositoryToken(Objective), useValue: objRepo },
        { provide: getRepositoryToken(ObjectiveUpdate), useValue: updateRepo },
        {
          provide: getRepositoryToken(ObjectiveComment),
          useValue: createMockRepository(),
        },
        { provide: getRepositoryToken(KeyResult), useValue: krRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(EvaluationCycle),
          useValue: createMockRepository(),
        },
        { provide: AuditService, useValue: auditService },
        { provide: EmailService, useValue: emailService },
        { provide: RecognitionService, useValue: recognitionService },
        { provide: NotificationsService, useValue: notificationsService },
        {
          provide: PushService,
          useValue: { sendToUser: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<ObjectivesService>(ObjectivesService);
  });

  // ─── Helper completeObjective (T1.1) ────────────────────────────────

  describe('completeObjective helper', () => {
    it('should transition ACTIVE objective to COMPLETED and fire all side-effects', async () => {
      const obj = makeObj({ status: ObjectiveStatus.ACTIVE, progress: 80 });
      userRepo.findOne
        .mockResolvedValueOnce({
          id: UID,
          firstName: 'John',
          lastName: 'Doe',
          managerId: MGR,
        })
        .mockResolvedValueOnce({
          id: MGR,
          email: 'mgr@test.com',
          firstName: 'Boss',
        });

      const result = await (service as any).completeObjective(obj, ACTOR);

      expect(result.status).toBe(ObjectiveStatus.COMPLETED);
      expect(result.progress).toBe(100);
      expect(objRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ObjectiveStatus.COMPLETED,
          progress: 100,
        }),
      );
      // Audit log
      expect(auditService.log).toHaveBeenCalledWith(
        TID,
        ACTOR,
        'objective.completed',
        'objective',
        OID,
        expect.objectContaining({
          title: 'Test Objective',
          completedBy: ACTOR,
        }),
      );
      // Gamification points
      expect(recognitionService.addPoints).toHaveBeenCalledWith(
        TID,
        UID,
        10,
        expect.any(String),
        expect.stringContaining('Test Objective'),
        OID,
      );
      // Owner notification
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TID,
          userId: UID,
          metadata: expect.objectContaining({ objectiveCompleted: true }),
        }),
      );
      // Auto-badge check
      expect(recognitionService.checkAutoBadges).toHaveBeenCalledWith(TID, UID);
      // Manager email
      expect(emailService.sendObjectiveCompleted).toHaveBeenCalledWith(
        'mgr@test.com',
        expect.objectContaining({
          managerName: 'Boss',
          employeeName: 'John Doe',
          objectiveTitle: 'Test Objective',
        }),
      );
    });

    it('should be idempotent — re-calling on already COMPLETED does NOT re-fire side-effects', async () => {
      const obj = makeObj({ status: ObjectiveStatus.COMPLETED, progress: 100 });

      const result = await (service as any).completeObjective(obj, ACTOR);

      expect(result).toBe(obj); // same reference, no save
      expect(objRepo.save).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
      expect(recognitionService.addPoints).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
      expect(recognitionService.checkAutoBadges).not.toHaveBeenCalled();
      expect(emailService.sendObjectiveCompleted).not.toHaveBeenCalled();
    });

    it('should complete when employee has no manager (no email sent, no error)', async () => {
      const obj = makeObj({ status: ObjectiveStatus.ACTIVE });
      userRepo.findOne.mockResolvedValueOnce({
        id: UID,
        firstName: 'John',
        lastName: 'Doe',
        managerId: null,
      });

      await (service as any).completeObjective(obj, ACTOR);

      expect(objRepo.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
      expect(recognitionService.addPoints).toHaveBeenCalled();
      expect(emailService.sendObjectiveCompleted).not.toHaveBeenCalled();
    });

    it('should complete when manager exists but has no email (no email sent, no error)', async () => {
      const obj = makeObj({ status: ObjectiveStatus.ACTIVE });
      userRepo.findOne
        .mockResolvedValueOnce({
          id: UID,
          firstName: 'John',
          lastName: 'Doe',
          managerId: MGR,
        })
        .mockResolvedValueOnce({ id: MGR, email: null, firstName: 'Boss' });

      await (service as any).completeObjective(obj, ACTOR);

      expect(emailService.sendObjectiveCompleted).not.toHaveBeenCalled();
    });

    it('should not propagate failures from side-effect services', async () => {
      const obj = makeObj({ status: ObjectiveStatus.ACTIVE });
      auditService.log.mockRejectedValue(new Error('audit DB down'));
      recognitionService.addPoints.mockRejectedValue(
        new Error('points DB down'),
      );
      notificationsService.create.mockRejectedValue(new Error('notif DB down'));
      userRepo.findOne.mockRejectedValue(new Error('user DB down'));

      await expect(
        (service as any).completeObjective(obj, ACTOR),
      ).resolves.toBeDefined();
    });
  });

  // ─── addProgressUpdate (T1.1 manual completion) ─────────────────────

  describe('addProgressUpdate — manual completion paths', () => {
    function setupFindByIdToReturn(obj: Objective): void {
      const qb = objRepo.createQueryBuilder();
      qb.getOne.mockResolvedValue(obj);
    }

    it('should auto-complete a SMART objective at 100% via the helper', async () => {
      const obj = makeObj({
        type: ObjectiveType.SMART,
        status: ObjectiveStatus.ACTIVE,
        progress: 70,
      });
      setupFindByIdToReturn(obj);
      krRepo.find.mockResolvedValue([]);
      userRepo.findOne.mockResolvedValueOnce({
        id: UID,
        firstName: 'A',
        lastName: 'B',
        managerId: null,
      });

      await service.addProgressUpdate(TID, ACTOR, OID, {
        progressValue: 100,
        notes: 'done',
      });

      expect(objRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ObjectiveStatus.COMPLETED,
          progress: 100,
        }),
      );
      expect(recognitionService.addPoints).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        TID,
        ACTOR,
        'objective.completed',
        'objective',
        OID,
        expect.any(Object),
      );
    });

    it('should auto-complete a KPI objective at 100% via the helper', async () => {
      const obj = makeObj({
        type: ObjectiveType.KPI,
        status: ObjectiveStatus.ACTIVE,
        progress: 50,
      });
      setupFindByIdToReturn(obj);
      krRepo.find.mockResolvedValue([]);
      userRepo.findOne.mockResolvedValueOnce({
        id: UID,
        firstName: 'A',
        lastName: 'B',
        managerId: null,
      });

      await service.addProgressUpdate(TID, ACTOR, OID, {
        progressValue: 100,
        notes: 'done',
      });

      expect(objRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ObjectiveStatus.COMPLETED,
        }),
      );
    });

    it('should reject completion of OKR without any KRs defined', async () => {
      const obj = makeObj({
        type: ObjectiveType.OKR,
        status: ObjectiveStatus.ACTIVE,
      });
      setupFindByIdToReturn(obj);
      krRepo.find.mockResolvedValue([]); // no KRs at all

      await expect(
        service.addProgressUpdate(TID, ACTOR, OID, {
          progressValue: 100,
          notes: 'done',
        }),
      ).rejects.toThrow(/sin Resultados Clave/);
    });

    it('should reject manual progress on OKR with KRs (must use KR section)', async () => {
      const obj = makeObj({
        type: ObjectiveType.OKR,
        status: ObjectiveStatus.ACTIVE,
      });
      setupFindByIdToReturn(obj);
      krRepo.find.mockResolvedValue([makeKR()]);

      await expect(
        service.addProgressUpdate(TID, ACTOR, OID, {
          progressValue: 80,
          notes: 'partial',
        }),
      ).rejects.toThrow(/se calcula automáticamente al actualizar los KRs/);
    });

    it('should transition DRAFT to ACTIVE when first progress is recorded (<100)', async () => {
      const obj = makeObj({
        type: ObjectiveType.SMART,
        status: ObjectiveStatus.DRAFT,
        progress: 0,
      });
      setupFindByIdToReturn(obj);
      krRepo.find.mockResolvedValue([]);

      await service.addProgressUpdate(TID, ACTOR, OID, {
        progressValue: 30,
        notes: 'kickoff',
      });

      expect(objRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ObjectiveStatus.ACTIVE,
          progress: 30,
        }),
      );
      // Helper should NOT have been called (not completing)
      expect(recognitionService.addPoints).not.toHaveBeenCalled();
    });

    it('should reject progress on already COMPLETED objective', async () => {
      const obj = makeObj({ status: ObjectiveStatus.COMPLETED });
      setupFindByIdToReturn(obj);

      await expect(
        service.addProgressUpdate(TID, ACTOR, OID, {
          progressValue: 50,
          notes: 'late',
        }),
      ).rejects.toThrow(/ya está completado/);
    });

    it('should reject progress on ABANDONED objective', async () => {
      const obj = makeObj({ status: ObjectiveStatus.ABANDONED });
      setupFindByIdToReturn(obj);

      await expect(
        service.addProgressUpdate(TID, ACTOR, OID, {
          progressValue: 50,
          notes: 'late',
        }),
      ).rejects.toThrow(/abandonado/);
    });

    it('should reject empty notes', async () => {
      await expect(
        service.addProgressUpdate(TID, ACTOR, OID, {
          progressValue: 50,
          notes: '' as any,
        }),
      ).rejects.toThrow(/Debe indicar/);
    });
  });

  // ─── recalculateProgressFromKRs / updateKeyResult (T1.2) ────────────

  describe('updateKeyResult — auto-completion via KR (T1.2 BUG-1 fix)', () => {
    it('should auto-complete OKR when last KR reaches 100% and all are completed', async () => {
      const kr1 = makeKR({
        id: fakeUuid(301),
        currentValue: 100,
        status: KRStatus.COMPLETED,
      });
      const krBeingUpdated = makeKR({
        id: fakeUuid(302),
        currentValue: 0,
        status: KRStatus.ACTIVE,
      });

      krRepo.findOne.mockResolvedValue(krBeingUpdated);
      // After save, recalc reads all KRs — both completed now
      const krAfterUpdate = makeKR({
        id: fakeUuid(302),
        currentValue: 100,
        status: KRStatus.COMPLETED,
      });
      krRepo.find.mockResolvedValue([kr1, krAfterUpdate]);
      // The objective lookup inside recalc when conditions met
      objRepo.findOne.mockResolvedValue(
        makeObj({
          status: ObjectiveStatus.ACTIVE,
          progress: 50,
          parentObjectiveId: null,
        }),
      );
      userRepo.findOne.mockResolvedValueOnce({
        id: UID,
        firstName: 'A',
        lastName: 'B',
        managerId: null,
      });

      await service.updateKeyResult(
        TID,
        fakeUuid(302),
        { currentValue: 100 },
        ACTOR,
      );

      // Progress was updated
      expect(objRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: OID, tenantId: TID }),
        expect.objectContaining({ progress: 100 }),
      );
      // Helper completed the objective
      expect(objRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ObjectiveStatus.COMPLETED,
        }),
      );
      expect(recognitionService.addPoints).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        TID,
        ACTOR,
        'objective.completed',
        'objective',
        OID,
        expect.any(Object),
      );
    });

    it('should NOT auto-complete when one KR completes but others remain pending', async () => {
      const krUpdated = makeKR({
        id: fakeUuid(302),
        currentValue: 100,
        status: KRStatus.COMPLETED,
      });
      const krPending = makeKR({
        id: fakeUuid(303),
        currentValue: 30,
        status: KRStatus.ACTIVE,
      });

      krRepo.findOne.mockResolvedValue(
        makeKR({ id: fakeUuid(302), currentValue: 0, status: KRStatus.ACTIVE }),
      );
      krRepo.find.mockResolvedValue([krUpdated, krPending]);

      await service.updateKeyResult(
        TID,
        fakeUuid(302),
        { currentValue: 100 },
        ACTOR,
      );

      // Progress updated to ~65% (avg of 100 and 30)
      expect(objRepo.update).toHaveBeenCalled();
      // BUT no completion side-effects
      expect(recognitionService.addPoints).not.toHaveBeenCalled();
      expect(objRepo.save).not.toHaveBeenCalled();
      // No findOne for objective (the guard `allCompleted && avg>=100` short-circuits)
      expect(objRepo.findOne).not.toHaveBeenCalled();
    });

    it('should NOT auto-complete when objective is in DRAFT (status guard)', async () => {
      const kr = makeKR({ currentValue: 100, status: KRStatus.COMPLETED });

      krRepo.findOne.mockResolvedValue(
        makeKR({ currentValue: 0, status: KRStatus.ACTIVE }),
      );
      krRepo.find.mockResolvedValue([kr]);
      objRepo.findOne.mockResolvedValue(
        makeObj({ status: ObjectiveStatus.DRAFT }),
      );

      await service.updateKeyResult(
        TID,
        fakeUuid(302),
        { currentValue: 100 },
        ACTOR,
      );

      // findOne was called (allCompleted && avg>=100 passed)
      expect(objRepo.findOne).toHaveBeenCalled();
      // But helper short-circuited because status !== ACTIVE
      expect(objRepo.save).not.toHaveBeenCalled();
      expect(recognitionService.addPoints).not.toHaveBeenCalled();
    });

    it('should be idempotent — KR update on already-COMPLETED objective does not re-fire', async () => {
      const kr = makeKR({ currentValue: 100, status: KRStatus.COMPLETED });

      krRepo.findOne.mockResolvedValue(
        makeKR({ currentValue: 100, status: KRStatus.COMPLETED }),
      );
      krRepo.find.mockResolvedValue([kr]);
      objRepo.findOne.mockResolvedValue(
        makeObj({ status: ObjectiveStatus.COMPLETED, progress: 100 }),
      );

      await service.updateKeyResult(
        TID,
        fakeUuid(302),
        { currentValue: 100 },
        ACTOR,
      );

      // findOne was called but the "ACTIVE only" guard prevented helper invocation
      expect(objRepo.findOne).toHaveBeenCalled();
      expect(recognitionService.addPoints).not.toHaveBeenCalled();
    });

    it('should fall back to obj.userId when actorUserId is not provided', async () => {
      const kr = makeKR({ currentValue: 100, status: KRStatus.COMPLETED });

      krRepo.findOne.mockResolvedValue(
        makeKR({ currentValue: 0, status: KRStatus.ACTIVE }),
      );
      krRepo.find.mockResolvedValue([kr]);
      objRepo.findOne.mockResolvedValue(
        makeObj({ status: ObjectiveStatus.ACTIVE }),
      );
      userRepo.findOne.mockResolvedValueOnce({
        id: UID,
        firstName: 'A',
        lastName: 'B',
        managerId: null,
      });

      // No actorUserId — should default to owner (UID)
      await service.updateKeyResult(TID, fakeUuid(302), { currentValue: 100 });

      expect(auditService.log).toHaveBeenCalledWith(
        TID,
        UID,
        'objective.completed',
        'objective',
        OID,
        expect.any(Object),
      );
    });
  });

  // ─── deleteKeyResult (T1.2 cascade auto-completion) ──────────────────

  describe('deleteKeyResult — cascade auto-completion (T1.2)', () => {
    it('should auto-complete OKR when deleting the last incomplete KR leaves all-completed', async () => {
      // Before delete: 2 completed + 1 pending
      // After delete: 2 completed (allCompleted=true, avg=100)
      const remaining = [
        makeKR({
          id: fakeUuid(301),
          currentValue: 100,
          status: KRStatus.COMPLETED,
        }),
        makeKR({
          id: fakeUuid(302),
          currentValue: 100,
          status: KRStatus.COMPLETED,
        }),
      ];

      krRepo.findOne.mockResolvedValue(
        makeKR({ id: fakeUuid(303), status: KRStatus.ACTIVE }),
      );
      krRepo.find.mockResolvedValue(remaining);
      objRepo.findOne.mockResolvedValue(
        makeObj({ status: ObjectiveStatus.ACTIVE }),
      );
      userRepo.findOne.mockResolvedValueOnce({
        id: UID,
        firstName: 'A',
        lastName: 'B',
        managerId: null,
      });

      await service.deleteKeyResult(TID, fakeUuid(303), ACTOR);

      expect(krRepo.remove).toHaveBeenCalled();
      expect(objRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ObjectiveStatus.COMPLETED,
        }),
      );
      expect(recognitionService.addPoints).toHaveBeenCalled();
    });

    it('should not auto-complete when deleting all KRs (krs.length=0 returns early)', async () => {
      krRepo.findOne.mockResolvedValue(
        makeKR({ id: fakeUuid(303), status: KRStatus.ACTIVE }),
      );
      krRepo.find.mockResolvedValue([]); // no KRs left

      await service.deleteKeyResult(TID, fakeUuid(303), ACTOR);

      expect(krRepo.remove).toHaveBeenCalled();
      // recalc returns early, no progress update, no completion
      expect(objRepo.update).not.toHaveBeenCalled();
      expect(objRepo.save).not.toHaveBeenCalled();
      expect(recognitionService.addPoints).not.toHaveBeenCalled();
    });
  });
});
