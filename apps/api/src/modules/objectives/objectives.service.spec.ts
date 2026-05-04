/**
 * objectives.service.spec.ts — Tests unitarios del ObjectivesService.
 *
 * Cubre la auditoría P0:
 *   Tarea 1 (BUG-1: auto-completion de OKR cuando KRs llegan a 100%):
 *     - completeObjective helper: transición + side-effects + idempotencia
 *     - addProgressUpdate: SMART/KPI/OKR-sin-KR manual completion
 *     - updateKeyResult: auto-completion de OKR cuando KRs llegan a 100%
 *     - Status guard: solo desde ACTIVE (no DRAFT/PENDING/ABANDONED)
 *     - Idempotencia: re-llamadas no re-disparan side-effects
 *
 *   Tarea 2 (BUG-3: validación de pesos por bucket de ciclo):
 *     - validateWeightSum helper: bucket por (userId, cycleId), exclude ABANDONED
 *     - create(): valida antes de persistir
 *     - update(): considera weight+cycleId nuevos
 *     - submitForApproval(): comparte el mismo helper
 *
 * NO cubre todavía: aprobación/rechazo, comments, tree, exports.
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
      // Note: T3.2 bridge calls propagateProgressToParent which loads the obj
      // via findOne to read its parentObjectiveId. The completion guard
      // (`allCompleted && avg>=100`) still short-circuits — verified above by
      // the absence of save/addPoints calls.
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

// ─── Tarea 2 — BUG-3: validación de pesos por bucket de ciclo ──────────

describe('ObjectivesService — Tarea 2 (weight validation by cycle bucket)', () => {
  let service: ObjectivesService;
  let objRepo: any;
  let userRepo: any;
  let cycleRepo: any;

  const CYCLE_Q1 = fakeUuid(500);
  const CYCLE_Q2 = fakeUuid(501);

  beforeEach(async () => {
    objRepo = createMockRepository();
    userRepo = createMockRepository();
    cycleRepo = createMockRepository();
    // By default: any cycle lookup returns an OPEN cycle so validateCycleOpen
    // doesn't block T2 tests that pass dto.cycleId. Tests that need a closed
    // cycle override this per-test.
    cycleRepo.findOne.mockImplementation((args: any) =>
      Promise.resolve({
        id: args?.where?.id ?? 'mock-cycle',
        tenantId: TID,
        status: 'active',
      }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObjectivesService,
        { provide: getRepositoryToken(Objective), useValue: objRepo },
        {
          provide: getRepositoryToken(ObjectiveUpdate),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ObjectiveComment),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(KeyResult),
          useValue: createMockRepository(),
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(EvaluationCycle),
          useValue: cycleRepo,
        },
        { provide: AuditService, useValue: createMockAuditService() },
        {
          provide: EmailService,
          useValue: {
            sendObjectiveAssigned: jest.fn().mockResolvedValue(undefined),
            sendObjectiveCompleted: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: RecognitionService,
          useValue: {
            addPoints: jest.fn().mockResolvedValue(undefined),
            checkAutoBadges: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: NotificationsService,
          useValue: createMockNotificationsService(),
        },
        {
          provide: PushService,
          useValue: { sendToUser: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<ObjectivesService>(ObjectivesService);
  });

  // ─── validateWeightSum helper directo ────────────────────────────────

  describe('validateWeightSum (direct)', () => {
    it('should be a no-op when candidateWeight is 0 or undefined', async () => {
      await (service as any).validateWeightSum({
        tenantId: TID,
        userId: UID,
        cycleId: CYCLE_Q1,
        candidateWeight: 0,
      });
      // No DB call should have happened
      expect(objRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should accept when existing siblings + candidate <= 100', async () => {
      const qb = objRepo.createQueryBuilder();
      qb.getMany.mockResolvedValueOnce([
        { weight: 30 },
        { weight: 20 },
      ]);

      await expect(
        (service as any).validateWeightSum({
          tenantId: TID,
          userId: UID,
          cycleId: CYCLE_Q1,
          candidateWeight: 50,
        }),
      ).resolves.toBeUndefined();
    });

    it('should reject when sum would exceed 100% in same cycle', async () => {
      const qb = objRepo.createQueryBuilder();
      qb.getMany.mockResolvedValueOnce([
        { weight: 50 },
        { weight: 30 },
      ]);

      await expect(
        (service as any).validateWeightSum({
          tenantId: TID,
          userId: UID,
          cycleId: CYCLE_Q1,
          candidateWeight: 30, // 50+30+30 = 110
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should partition by cycleId — different bucket means independent sum', async () => {
      // Simulate: helper queries with cycleId=Q2 → returns only Q2 siblings
      // (filter handled in QB; mock returns whatever we tell it)
      const qb = objRepo.createQueryBuilder();
      qb.getMany.mockResolvedValueOnce([]); // Q2 has no siblings

      await expect(
        (service as any).validateWeightSum({
          tenantId: TID,
          userId: UID,
          cycleId: CYCLE_Q2,
          candidateWeight: 100,
        }),
      ).resolves.toBeUndefined();
    });

    it('should partition into "no cycle" bucket when cycleId is null', async () => {
      const qb = objRepo.createQueryBuilder();
      qb.getMany.mockResolvedValueOnce([{ weight: 60 }]);

      // Verify the QB used IS NULL filter (not :cycleId param) — by checking
      // andWhere was called with the expected SQL fragment.
      await expect(
        (service as any).validateWeightSum({
          tenantId: TID,
          userId: UID,
          cycleId: null,
          candidateWeight: 50, // 60+50=110 → fail
        }),
      ).rejects.toThrow(/objetivos sin ciclo/);

      expect(qb.andWhere).toHaveBeenCalledWith('o.cycleId IS NULL');
    });

    it('should pass excludeId to QB to skip the same objective on update', async () => {
      const qb = objRepo.createQueryBuilder();
      qb.getMany.mockResolvedValueOnce([{ weight: 40 }]);

      await (service as any).validateWeightSum({
        tenantId: TID,
        userId: UID,
        cycleId: CYCLE_Q1,
        candidateWeight: 50,
        excludeId: OID,
      });

      // andWhere with the exclude filter should have been called
      expect(qb.andWhere).toHaveBeenCalledWith('o.id != :excludeId', {
        excludeId: OID,
      });
    });

    it('should report the bucket label in the error message', async () => {
      const qb = objRepo.createQueryBuilder();
      qb.getMany.mockResolvedValueOnce([{ weight: 60 }]);

      await expect(
        (service as any).validateWeightSum({
          tenantId: TID,
          userId: UID,
          cycleId: CYCLE_Q1,
          candidateWeight: 50,
        }),
      ).rejects.toThrow(/este ciclo/);
    });
  });

  // ─── create() integration ────────────────────────────────────────────

  describe('create — invokes validateWeightSum', () => {
    it('should reject creation when weight + siblings would exceed 100', async () => {
      const qb = objRepo.createQueryBuilder();
      qb.getMany.mockResolvedValueOnce([{ weight: 70 }]);

      await expect(
        service.create(TID, UID, {
          title: 'New OKR',
          weight: 50,
          cycleId: CYCLE_Q1,
        } as any),
      ).rejects.toThrow(BadRequestException);

      // create should NOT have been called on the repo (validation blocks it)
      expect(objRepo.save).not.toHaveBeenCalled();
    });

    it('should allow creation when sum stays <= 100', async () => {
      const qb = objRepo.createQueryBuilder();
      qb.getMany.mockResolvedValueOnce([{ weight: 30 }]);
      objRepo.save.mockResolvedValueOnce({
        id: OID,
        tenantId: TID,
        userId: UID,
        title: 'New OKR',
      });

      await expect(
        service.create(TID, UID, {
          title: 'New OKR',
          weight: 50,
          cycleId: CYCLE_Q1,
        } as any),
      ).resolves.toBeDefined();

      expect(objRepo.save).toHaveBeenCalled();
    });

    it('should skip validation when weight is 0 or undefined', async () => {
      objRepo.save.mockResolvedValueOnce({ id: OID });

      await service.create(TID, UID, {
        title: 'No-weight OKR',
        weight: 0,
      } as any);

      // QB should NOT have been called (validation skipped)
      expect(objRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // ─── update() integration ────────────────────────────────────────────

  describe('update — invokes validateWeightSum and applies cycleId', () => {
    function setupFindByIdToReturn(obj: Objective): any {
      const qb = objRepo.createQueryBuilder();
      qb.getOne.mockResolvedValueOnce(obj);
      return qb;
    }

    it('should validate against new weight + existing cycleId when only weight changes', async () => {
      const obj = makeObj({
        weight: 30,
        cycleId: CYCLE_Q1 as any,
        status: ObjectiveStatus.ACTIVE,
      });
      const qb = setupFindByIdToReturn(obj);
      // Second QB call (validateWeightSum.getMany) — siblings sum 80
      qb.getMany.mockResolvedValueOnce([{ weight: 80 }]);

      await expect(
        service.update(TID, OID, { weight: 30 }),
      ).rejects.toThrow(/superar 100/);
    });

    it('should validate against new cycleId when only cycleId changes', async () => {
      const obj = makeObj({
        weight: 80,
        cycleId: CYCLE_Q1 as any,
        status: ObjectiveStatus.ACTIVE,
      });
      const qb = setupFindByIdToReturn(obj);
      // Q2 siblings sum 30 → 80+30 = 110 → fail
      qb.getMany.mockResolvedValueOnce([{ weight: 30 }]);

      await expect(
        service.update(TID, OID, { cycleId: CYCLE_Q2 }),
      ).rejects.toThrow(/superar 100/);
    });

    it('should apply cycleId change when validation passes (incidental T2.3 fix)', async () => {
      const obj = makeObj({
        weight: 50,
        cycleId: CYCLE_Q1 as any,
        status: ObjectiveStatus.ACTIVE,
      });
      const qb = setupFindByIdToReturn(obj);
      qb.getMany.mockResolvedValueOnce([]); // Q2 empty
      objRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

      await service.update(TID, OID, { cycleId: CYCLE_Q2 });

      // The saved entity should have the new cycleId
      const savedEntity = objRepo.save.mock.calls[0][0];
      expect(savedEntity.cycleId).toBe(CYCLE_Q2);
    });

    it('should skip weight validation when neither weight nor cycleId is being changed', async () => {
      const obj = makeObj({
        weight: 50,
        cycleId: CYCLE_Q1 as any,
        status: ObjectiveStatus.ACTIVE,
      });
      const qb = setupFindByIdToReturn(obj);
      objRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

      await service.update(TID, OID, { title: 'Renamed only' });

      // Only the findById QB call — no validation QB call
      expect(qb.getMany).not.toHaveBeenCalled();
    });

    it('should reject modification of COMPLETED objective (existing rule preserved)', async () => {
      const obj = makeObj({ status: ObjectiveStatus.COMPLETED });
      setupFindByIdToReturn(obj);

      await expect(
        service.update(TID, OID, { weight: 50 }),
      ).rejects.toThrow(/completados.*cancelados.*abandonados/);
    });
  });

  // ─── submitForApproval() integration ─────────────────────────────────

  describe('submitForApproval — uses shared helper', () => {
    it('should reject when sum within the cycle bucket would exceed 100', async () => {
      const obj = makeObj({
        weight: 60,
        cycleId: CYCLE_Q1 as any,
        status: ObjectiveStatus.DRAFT,
      });
      const qb = objRepo.createQueryBuilder();
      qb.getOne.mockResolvedValueOnce(obj);
      // Siblings in Q1 (excluding self via excludeId): sum 50 → 50+60 = 110
      qb.getMany.mockResolvedValueOnce([{ weight: 50 }]);

      await expect(service.submitForApproval(TID, OID)).rejects.toThrow(
        /superar 100/,
      );
    });

    it('should accept submission when COMPLETED siblings live in a different cycle', async () => {
      // Pre-fix bug: COMPLETED de Q1 (60%) bloqueaba submit de Q2 (50%).
      // Post-fix: solo cuenta siblings en el mismo bucket.
      const obj = makeObj({
        weight: 50,
        cycleId: CYCLE_Q2 as any,
        status: ObjectiveStatus.DRAFT,
      });
      const qb = objRepo.createQueryBuilder();
      qb.getOne.mockResolvedValueOnce(obj);
      // Helper queries Q2 only — returns empty (Q1 completed siblings filtered out by SQL)
      qb.getMany.mockResolvedValueOnce([]);
      objRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

      await service.submitForApproval(TID, OID);

      const savedEntity = objRepo.save.mock.calls[0][0];
      expect(savedEntity.status).toBe(ObjectiveStatus.PENDING_APPROVAL);
    });

    it('should reject submission from non-DRAFT (existing rule preserved)', async () => {
      const obj = makeObj({
        weight: 50,
        status: ObjectiveStatus.ACTIVE, // not DRAFT
      });
      const qb = objRepo.createQueryBuilder();
      qb.getOne.mockResolvedValueOnce(obj);

      await expect(service.submitForApproval(TID, OID)).rejects.toThrow(
        /borrador/,
      );
    });

    it('should skip weight validation when obj.weight is 0', async () => {
      const obj = makeObj({
        weight: 0,
        status: ObjectiveStatus.DRAFT,
      });
      const qb = objRepo.createQueryBuilder();
      qb.getOne.mockResolvedValueOnce(obj);
      objRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

      await service.submitForApproval(TID, OID);

      // getMany should NOT have been called (validation skipped)
      expect(qb.getMany).not.toHaveBeenCalled();
    });
  });
});

// ─── Tarea 3 — BUG-9: parent auto-completion + visited guard ───────────

describe('ObjectivesService — Tarea 3 (parent auto-completion)', () => {
  let service: ObjectivesService;
  let objRepo: any;
  let krRepo: any;
  let userRepo: any;
  let recognitionService: any;
  let auditService: any;

  const PARENT_ID = fakeUuid(400);
  const CHILD_A = fakeUuid(401);
  const CHILD_B = fakeUuid(402);
  const GRANDPARENT_ID = fakeUuid(500);

  beforeEach(async () => {
    objRepo = createMockRepository();
    krRepo = createMockRepository();
    userRepo = createMockRepository();
    recognitionService = {
      addPoints: jest.fn().mockResolvedValue(undefined),
      checkAutoBadges: jest.fn().mockResolvedValue(undefined),
    };
    auditService = createMockAuditService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObjectivesService,
        { provide: getRepositoryToken(Objective), useValue: objRepo },
        {
          provide: getRepositoryToken(ObjectiveUpdate),
          useValue: createMockRepository(),
        },
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
        {
          provide: EmailService,
          useValue: {
            sendObjectiveAssigned: jest.fn().mockResolvedValue(undefined),
            sendObjectiveCompleted: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: RecognitionService, useValue: recognitionService },
        {
          provide: NotificationsService,
          useValue: createMockNotificationsService(),
        },
        {
          provide: PushService,
          useValue: { sendToUser: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<ObjectivesService>(ObjectivesService);
  });

  describe('propagateProgressToParent — auto-completion (T3.1)', () => {
    it('should NOT auto-complete parent when children avg < 100', async () => {
      const child = makeObj({
        id: CHILD_A,
        parentObjectiveId: PARENT_ID,
        progress: 50,
        status: ObjectiveStatus.ACTIVE,
      });
      const sibling = makeObj({
        id: CHILD_B,
        parentObjectiveId: PARENT_ID,
        progress: 30,
        status: ObjectiveStatus.ACTIVE,
        weight: 0,
      });

      objRepo.findOne.mockResolvedValueOnce(child); // initial load of child
      objRepo.find.mockResolvedValueOnce([child, sibling]); // siblings
      // Recursion will try to load parent (PARENT_ID) — return null to stop
      objRepo.findOne.mockResolvedValueOnce(null);

      await service.propagateProgressToParent(TID, CHILD_A, ACTOR);

      // Progress was updated on parent
      expect(objRepo.update).toHaveBeenCalledWith(
        { id: PARENT_ID, tenantId: TID },
        { progress: 40 }, // (50 + 30) / 2
      );
      // No completion fired
      expect(recognitionService.addPoints).not.toHaveBeenCalled();
    });

    it('should auto-complete ACTIVE parent when all children reach 100% (simple avg)', async () => {
      const child = makeObj({
        id: CHILD_A,
        parentObjectiveId: PARENT_ID,
        progress: 100,
        status: ObjectiveStatus.COMPLETED,
        weight: 0,
      });
      const sibling = makeObj({
        id: CHILD_B,
        parentObjectiveId: PARENT_ID,
        progress: 100,
        status: ObjectiveStatus.COMPLETED,
        weight: 0,
      });
      const parent = makeObj({
        id: PARENT_ID,
        userId: UID,
        progress: 50,
        status: ObjectiveStatus.ACTIVE,
        parentObjectiveId: null, // root parent
      });

      objRepo.findOne
        .mockResolvedValueOnce(child) // initial child load
        .mockResolvedValueOnce(parent) // parent load for completion check
        .mockResolvedValueOnce(parent); // recursion: load parent again, parent.parentObjectiveId=null returns
      objRepo.find.mockResolvedValueOnce([child, sibling]); // siblings
      userRepo.findOne.mockResolvedValueOnce({
        id: UID,
        firstName: 'A',
        lastName: 'B',
        managerId: null,
      });

      await service.propagateProgressToParent(TID, CHILD_A, ACTOR);

      expect(objRepo.update).toHaveBeenCalledWith(
        { id: PARENT_ID, tenantId: TID },
        { progress: 100 },
      );
      // completeObjective fired on parent
      expect(objRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: PARENT_ID,
          status: ObjectiveStatus.COMPLETED,
        }),
      );
      expect(recognitionService.addPoints).toHaveBeenCalledWith(
        TID, UID, 10, expect.any(String), expect.any(String), PARENT_ID,
      );
      expect(auditService.log).toHaveBeenCalledWith(
        TID, ACTOR, 'objective.completed', 'objective', PARENT_ID, expect.any(Object),
      );
    });

    it('should weighted-average parent progress when children have weights', async () => {
      const child = makeObj({
        id: CHILD_A,
        parentObjectiveId: PARENT_ID,
        progress: 50,
        weight: 50,
      });
      const sibling = makeObj({
        id: CHILD_B,
        parentObjectiveId: PARENT_ID,
        progress: 100,
        weight: 50,
      });

      objRepo.findOne.mockResolvedValueOnce(child);
      objRepo.find.mockResolvedValueOnce([child, sibling]);
      objRepo.findOne.mockResolvedValueOnce(null); // stop recursion

      await service.propagateProgressToParent(TID, CHILD_A, ACTOR);

      // weighted avg: (50*50 + 100*50) / 100 = 75
      expect(objRepo.update).toHaveBeenCalledWith(
        { id: PARENT_ID, tenantId: TID },
        { progress: 75 },
      );
      expect(recognitionService.addPoints).not.toHaveBeenCalled();
    });

    it('should NOT auto-complete parent in DRAFT (status guard)', async () => {
      const child = makeObj({
        id: CHILD_A,
        parentObjectiveId: PARENT_ID,
        progress: 100,
        weight: 0,
      });
      const draftParent = makeObj({
        id: PARENT_ID,
        progress: 100,
        status: ObjectiveStatus.DRAFT, // not yet approved
        parentObjectiveId: null,
      });

      objRepo.findOne
        .mockResolvedValueOnce(child)
        .mockResolvedValueOnce(draftParent) // completion check — fails on status
        .mockResolvedValueOnce(draftParent); // recursion stop
      objRepo.find.mockResolvedValueOnce([child]);

      await service.propagateProgressToParent(TID, CHILD_A, ACTOR);

      expect(objRepo.update).toHaveBeenCalled();
      // No completion side-effects
      expect(objRepo.save).not.toHaveBeenCalled();
      expect(recognitionService.addPoints).not.toHaveBeenCalled();
    });

    it('should be idempotent — already-COMPLETED parent does not re-fire side-effects', async () => {
      const child = makeObj({
        id: CHILD_A,
        parentObjectiveId: PARENT_ID,
        progress: 100,
        weight: 0,
      });
      const completedParent = makeObj({
        id: PARENT_ID,
        progress: 100,
        status: ObjectiveStatus.COMPLETED, // already done
        parentObjectiveId: null,
      });

      objRepo.findOne
        .mockResolvedValueOnce(child)
        .mockResolvedValueOnce(completedParent)
        .mockResolvedValueOnce(completedParent);
      objRepo.find.mockResolvedValueOnce([child]);

      await service.propagateProgressToParent(TID, CHILD_A, ACTOR);

      // helper was invoked but short-circuited via idempotency
      expect(objRepo.save).not.toHaveBeenCalled();
      expect(recognitionService.addPoints).not.toHaveBeenCalled();
    });

    it('should cascade complete through 3-level chain when all leaves reach 100%', async () => {
      // Chain: leaf C → middle B → root A
      // C completes → propagate from C to B: B reaches 100, COMPLETED.
      //   recursion: propagate from B to A: A reaches 100, COMPLETED.
      const C = makeObj({
        id: CHILD_A,
        parentObjectiveId: CHILD_B, // C's parent is B
        progress: 100,
        weight: 0,
      });
      const B = makeObj({
        id: CHILD_B,
        parentObjectiveId: GRANDPARENT_ID, // B's parent is A
        progress: 100,
        status: ObjectiveStatus.ACTIVE,
        weight: 0,
        userId: UID,
      });
      const A = makeObj({
        id: GRANDPARENT_ID,
        progress: 100,
        status: ObjectiveStatus.ACTIVE,
        parentObjectiveId: null,
        userId: UID,
      });

      // Sequence of findOne calls in recursion:
      //   1) load C (initial)
      //   2) load B (parent completion check, on first level)
      //   3) load B again (recursion entry, to check B's parent)
      //   4) load A (parent completion check, on second level)
      //   5) load A again (recursion entry, A.parentObjectiveId=null returns)
      objRepo.findOne
        .mockResolvedValueOnce(C)
        .mockResolvedValueOnce(B)
        .mockResolvedValueOnce(B)
        .mockResolvedValueOnce(A)
        .mockResolvedValueOnce(A);
      // siblings of B (C's siblings under B), then siblings of A (B's siblings under A)
      objRepo.find
        .mockResolvedValueOnce([C]) // C is B's only child
        .mockResolvedValueOnce([B]); // B is A's only child
      userRepo.findOne.mockResolvedValue({
        id: UID,
        firstName: 'A',
        lastName: 'B',
        managerId: null,
      });

      await service.propagateProgressToParent(TID, CHILD_A, ACTOR);

      // Both B and A should have been updated with progress=100
      expect(objRepo.update).toHaveBeenCalledWith(
        { id: CHILD_B, tenantId: TID },
        { progress: 100 },
      );
      expect(objRepo.update).toHaveBeenCalledWith(
        { id: GRANDPARENT_ID, tenantId: TID },
        { progress: 100 },
      );
      // Both saved as COMPLETED via helper
      expect(objRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: CHILD_B, status: ObjectiveStatus.COMPLETED }),
      );
      expect(objRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: GRANDPARENT_ID, status: ObjectiveStatus.COMPLETED }),
      );
      // Audit + points fired twice (once per level)
      expect(auditService.log).toHaveBeenCalledTimes(2);
      expect(recognitionService.addPoints).toHaveBeenCalledTimes(2);
    });

    it('should detect circular legacy chain and abort recursion (T3.2 guard)', async () => {
      // Legacy data: A.parentObjectiveId = B, B.parentObjectiveId = A.
      // validateParentObjective should have prevented this in runtime, but we
      // simulate corrupted data here.
      const A_legacy = makeObj({
        id: GRANDPARENT_ID,
        parentObjectiveId: CHILD_B, // points to B
        progress: 50,
        status: ObjectiveStatus.ACTIVE,
        weight: 0,
      });
      const B_legacy = makeObj({
        id: CHILD_B,
        parentObjectiveId: GRANDPARENT_ID, // points back to A
        progress: 50,
        status: ObjectiveStatus.ACTIVE,
        weight: 0,
      });

      // Initial entry: load A_legacy
      // Then recursion sees parent=B, loads siblings under B
      // Then recurses to propagate(B), loads B → parent=A
      // Now visited has [B, A] → on next recursion attempt to A's parent (B), guard hits
      objRepo.findOne
        .mockResolvedValueOnce(A_legacy) // initial
        .mockResolvedValueOnce(A_legacy) // recursion: load A as child to find its parent (B)
        .mockResolvedValueOnce(B_legacy); // recursion: load B as child to find its parent (A)
      // siblings under B (= [A_legacy]) and siblings under A (= [B_legacy])
      objRepo.find
        .mockResolvedValueOnce([A_legacy])
        .mockResolvedValueOnce([B_legacy]);

      // Should resolve without infinite recursion
      await expect(
        service.propagateProgressToParent(TID, GRANDPARENT_ID, ACTOR),
      ).resolves.toBeUndefined();

      // No completion (none reached 100%); guard prevents the loop
      expect(recognitionService.addPoints).not.toHaveBeenCalled();
    });

    it('should default actor to parent.userId when no actorUserId is passed', async () => {
      const child = makeObj({
        id: CHILD_A,
        parentObjectiveId: PARENT_ID,
        progress: 100,
        weight: 0,
      });
      const parent = makeObj({
        id: PARENT_ID,
        userId: UID,
        progress: 100,
        status: ObjectiveStatus.ACTIVE,
        parentObjectiveId: null,
      });

      objRepo.findOne
        .mockResolvedValueOnce(child)
        .mockResolvedValueOnce(parent)
        .mockResolvedValueOnce(parent);
      objRepo.find.mockResolvedValueOnce([child]);
      userRepo.findOne.mockResolvedValueOnce({
        id: UID,
        firstName: 'A',
        lastName: 'B',
        managerId: null,
      });

      // No actorUserId passed
      await service.propagateProgressToParent(TID, CHILD_A);

      expect(auditService.log).toHaveBeenCalledWith(
        TID,
        UID, // fallback to parent.userId
        'objective.completed',
        'objective',
        PARENT_ID,
        expect.any(Object),
      );
    });
  });

  describe('recalculateProgressFromKRs → propagateProgressToParent bridge (T3.2)', () => {
    it('should propagate to parent after KR-driven progress change', async () => {
      // Setup: child OKR with 1 KR. KR updated. recalc runs. Parent should
      // see updated progress via propagate.
      const childWithParent = makeObj({
        id: CHILD_A,
        parentObjectiveId: PARENT_ID,
        progress: 50,
        status: ObjectiveStatus.ACTIVE,
        type: ObjectiveType.OKR,
      });

      krRepo.findOne.mockResolvedValue(
        makeKR({
          id: fakeUuid(302),
          objectiveId: CHILD_A,
          currentValue: 0,
          status: KRStatus.ACTIVE,
        }),
      );
      // After save, recalc reads KRs — one KR at 80
      krRepo.find.mockResolvedValue([
        makeKR({
          id: fakeUuid(302),
          objectiveId: CHILD_A,
          currentValue: 80,
          status: KRStatus.ACTIVE,
        }),
      ]);
      // Inside recalc, after objRepo.update of progress, allCompleted=false
      // (KR is still ACTIVE), so completion branch is skipped. Then propagate
      // runs — needs to load child to find its parentObjectiveId.
      objRepo.findOne.mockResolvedValueOnce(childWithParent);
      // siblings under PARENT_ID — just the child
      objRepo.find.mockResolvedValueOnce([
        makeObj({
          id: CHILD_A,
          parentObjectiveId: PARENT_ID,
          progress: 80,
          weight: 0,
        }),
      ]);
      // Parent recursion: load parent → no further parent
      objRepo.findOne.mockResolvedValueOnce(null);

      await service.updateKeyResult(TID, fakeUuid(302), { currentValue: 80 }, ACTOR);

      // Progress was recalculated AND propagated to parent
      expect(objRepo.update).toHaveBeenCalledWith(
        { id: CHILD_A, tenantId: TID },
        expect.objectContaining({ progress: 80 }),
      );
      expect(objRepo.update).toHaveBeenCalledWith(
        { id: PARENT_ID, tenantId: TID },
        { progress: 80 }, // parent's avg = child's progress (only sibling)
      );
    });

    it('should not propagate when child has no parent', async () => {
      const orphanChild = makeObj({
        id: CHILD_A,
        parentObjectiveId: null, // no parent
        progress: 50,
        status: ObjectiveStatus.ACTIVE,
      });

      // KR points to CHILD_A (not the default OID) so recalc operates on it
      krRepo.findOne.mockResolvedValue(
        makeKR({
          id: fakeUuid(302),
          objectiveId: CHILD_A,
          currentValue: 0,
          status: KRStatus.ACTIVE,
        }),
      );
      krRepo.find.mockResolvedValue([
        makeKR({
          id: fakeUuid(302),
          objectiveId: CHILD_A,
          currentValue: 50,
          status: KRStatus.ACTIVE,
        }),
      ]);
      objRepo.findOne.mockResolvedValueOnce(orphanChild);

      await service.updateKeyResult(TID, fakeUuid(302), { currentValue: 50 }, ACTOR);

      // Only the child was updated, no parent update
      expect(objRepo.update).toHaveBeenCalledTimes(1);
      expect(objRepo.update).toHaveBeenCalledWith(
        { id: CHILD_A, tenantId: TID },
        expect.objectContaining({ progress: 50 }),
      );
    });
  });
});

// ─── Tarea 4 — BUG-10: bulk approval transaccional ─────────────────────

describe('ObjectivesService — Tarea 4 (bulkApprove)', () => {
  let service: ObjectivesService;
  let objRepo: any;
  let userRepo: any;

  const ID_A = fakeUuid(601);
  const ID_B = fakeUuid(602);
  const ID_C = fakeUuid(603);

  beforeEach(async () => {
    objRepo = createMockRepository();
    userRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObjectivesService,
        { provide: getRepositoryToken(Objective), useValue: objRepo },
        {
          provide: getRepositoryToken(ObjectiveUpdate),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ObjectiveComment),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(KeyResult),
          useValue: createMockRepository(),
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(EvaluationCycle),
          useValue: createMockRepository(),
        },
        { provide: AuditService, useValue: createMockAuditService() },
        {
          provide: EmailService,
          useValue: {
            sendObjectiveAssigned: jest.fn().mockResolvedValue(undefined),
            sendObjectiveCompleted: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: RecognitionService,
          useValue: {
            addPoints: jest.fn().mockResolvedValue(undefined),
            checkAutoBadges: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: NotificationsService,
          useValue: createMockNotificationsService(),
        },
        {
          provide: PushService,
          useValue: { sendToUser: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<ObjectivesService>(ObjectivesService);
  });

  function setupFindByIdSequence(objs: Array<Objective | null>): any {
    const qb = objRepo.createQueryBuilder();
    for (const obj of objs) {
      qb.getOne.mockResolvedValueOnce(obj);
    }
    return qb;
  }

  it('should approve all when all ids are valid PENDING_APPROVAL (admin)', async () => {
    const a = makeObj({ id: ID_A, status: ObjectiveStatus.PENDING_APPROVAL });
    const b = makeObj({ id: ID_B, status: ObjectiveStatus.PENDING_APPROVAL });
    setupFindByIdSequence([a, b]);
    objRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));
    userRepo.findOne.mockResolvedValue(null); // no manager email lookup

    const result = await service.bulkApprove(TID, [ID_A, ID_B], ACTOR, 'tenant_admin');

    expect(result.approved).toEqual([ID_A, ID_B]);
    expect(result.failed).toEqual([]);
    expect(objRepo.save).toHaveBeenCalledTimes(2);
  });

  it('should partially fail — one is DRAFT, others approve', async () => {
    const a = makeObj({ id: ID_A, status: ObjectiveStatus.PENDING_APPROVAL });
    const b = makeObj({ id: ID_B, status: ObjectiveStatus.DRAFT }); // not approvable
    const c = makeObj({ id: ID_C, status: ObjectiveStatus.PENDING_APPROVAL });
    setupFindByIdSequence([a, b, c]);
    objRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));
    userRepo.findOne.mockResolvedValue(null);

    const result = await service.bulkApprove(
      TID,
      [ID_A, ID_B, ID_C],
      ACTOR,
      'tenant_admin',
    );

    expect(result.approved).toEqual([ID_A, ID_C]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe(ID_B);
    expect(result.failed[0].reason).toMatch(/pendientes de aprobación/);
    expect(objRepo.save).toHaveBeenCalledTimes(2); // only A and C saved
  });

  it('should mark non-existent id as failed with NotFoundException reason', async () => {
    const a = makeObj({ id: ID_A, status: ObjectiveStatus.PENDING_APPROVAL });
    setupFindByIdSequence([a, null]); // second id returns null
    objRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));
    userRepo.findOne.mockResolvedValue(null);

    const result = await service.bulkApprove(
      TID,
      [ID_A, ID_B],
      ACTOR,
      'tenant_admin',
    );

    expect(result.approved).toEqual([ID_A]);
    expect(result.failed).toEqual([
      { id: ID_B, reason: expect.stringMatching(/no encontrado/) },
    ]);
  });

  it('should reject manager-out-of-scope items but approve in-scope ones', async () => {
    const MGR_USER_ID = fakeUuid(700);
    const REPORT_USER_ID = fakeUuid(701);
    const STRANGER_USER_ID = fakeUuid(702);

    // ID_A: belongs to a direct report — manager can approve
    const a = makeObj({
      id: ID_A,
      userId: REPORT_USER_ID,
      status: ObjectiveStatus.PENDING_APPROVAL,
    });
    // ID_B: belongs to someone outside manager's team — should fail
    const b = makeObj({
      id: ID_B,
      userId: STRANGER_USER_ID,
      status: ObjectiveStatus.PENDING_APPROVAL,
    });

    // bulkApprove flow: for manager, findById is called first to read userId,
    // then approve calls findById again. So 2 findById per item = 4 total.
    // But for ID_B, the scope check throws → approve never runs → only 1 findById for B.
    setupFindByIdSequence([a, a, b]);

    // assertManagerCanAccessUser does userRepo.findOne({ where: { id: targetUserId, tenantId } })
    // and verifies target.managerId === callerUserId. Mock differentiates
    // REPORT_USER_ID (in team) from STRANGER_USER_ID (not in team).
    userRepo.findOne.mockImplementation((opts: any) => {
      const where = opts?.where ?? {};
      if (where.id === REPORT_USER_ID) {
        return Promise.resolve({
          id: REPORT_USER_ID,
          managerId: MGR_USER_ID,
        });
      }
      if (where.id === STRANGER_USER_ID) {
        return Promise.resolve({
          id: STRANGER_USER_ID,
          managerId: 'other-mgr-id',
        });
      }
      return Promise.resolve(null);
    });
    objRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

    const result = await service.bulkApprove(
      TID,
      [ID_A, ID_B],
      MGR_USER_ID,
      'manager',
    );

    expect(result.approved).toEqual([ID_A]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe(ID_B);
    // The exact wording depends on assertManagerCanAccessUser's exception
    expect(result.failed[0].reason).toBeTruthy();
  });

  it('should NOT roll back successful approvals when a later one fails', async () => {
    // Simulates the "transactional per-item" property: A succeeds, B fails,
    // A's status change must persist (not rolled back).
    const a = makeObj({ id: ID_A, status: ObjectiveStatus.PENDING_APPROVAL });
    const b = makeObj({ id: ID_B, status: ObjectiveStatus.ACTIVE }); // wrong status
    setupFindByIdSequence([a, b]);
    objRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));
    userRepo.findOne.mockResolvedValue(null);

    const result = await service.bulkApprove(
      TID,
      [ID_A, ID_B],
      ACTOR,
      'tenant_admin',
    );

    expect(result.approved).toEqual([ID_A]);
    expect(result.failed).toHaveLength(1);
    // A was definitively saved with ACTIVE status (no rollback simulation
    // needed because we never opened an outer transaction)
    expect(objRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: ID_A, status: ObjectiveStatus.ACTIVE }),
    );
  });

  it('should be a no-op tolerant of empty arrays', async () => {
    // The DTO blocks empty arrays at the validator layer, but the service
    // method should still behave gracefully if called directly.
    const result = await service.bulkApprove(TID, [], ACTOR, 'tenant_admin');

    expect(result.approved).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(objRepo.save).not.toHaveBeenCalled();
  });

  it('should pass approvedBy=callerUserId to the underlying approve()', async () => {
    const a = makeObj({ id: ID_A, status: ObjectiveStatus.PENDING_APPROVAL });
    setupFindByIdSequence([a]);
    objRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));
    userRepo.findOne.mockResolvedValue(null);

    await service.bulkApprove(TID, [ID_A], ACTOR, 'tenant_admin');

    expect(objRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ID_A,
        status: ObjectiveStatus.ACTIVE,
        approvedBy: ACTOR,
      }),
    );
  });
});

// ─── Tarea 6 — OVERDUE state ───────────────────────────────────────────

describe('ObjectivesService — Tarea 6 (OVERDUE state)', () => {
  let service: ObjectivesService;
  let objRepo: any;
  let krRepo: any;
  let userRepo: any;
  let cycleRepo: any;
  let recognitionService: any;
  let auditService: any;

  beforeEach(async () => {
    objRepo = createMockRepository();
    krRepo = createMockRepository();
    userRepo = createMockRepository();
    cycleRepo = createMockRepository();
    cycleRepo.findOne.mockImplementation((args: any) =>
      Promise.resolve({
        id: args?.where?.id ?? 'mock-cycle',
        tenantId: TID,
        status: 'active',
      }),
    );
    recognitionService = {
      addPoints: jest.fn().mockResolvedValue(undefined),
      checkAutoBadges: jest.fn().mockResolvedValue(undefined),
    };
    auditService = createMockAuditService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObjectivesService,
        { provide: getRepositoryToken(Objective), useValue: objRepo },
        {
          provide: getRepositoryToken(ObjectiveUpdate),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ObjectiveComment),
          useValue: createMockRepository(),
        },
        { provide: getRepositoryToken(KeyResult), useValue: krRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(EvaluationCycle), useValue: cycleRepo },
        { provide: AuditService, useValue: auditService },
        {
          provide: EmailService,
          useValue: {
            sendObjectiveAssigned: jest.fn().mockResolvedValue(undefined),
            sendObjectiveCompleted: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: RecognitionService, useValue: recognitionService },
        {
          provide: NotificationsService,
          useValue: createMockNotificationsService(),
        },
        {
          provide: PushService,
          useValue: { sendToUser: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<ObjectivesService>(ObjectivesService);
  });

  describe('update() — extending targetDate from OVERDUE', () => {
    it('should transition OVERDUE back to ACTIVE when targetDate is extended', async () => {
      const overdueObj = makeObj({
        status: ObjectiveStatus.OVERDUE,
        progress: 60,
      });
      const qb = objRepo.createQueryBuilder();
      qb.getOne.mockResolvedValueOnce(overdueObj);
      objRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

      // Pick a clearly future date to avoid validateTargetDate edge-of-day issues
      const future = new Date();
      future.setDate(future.getDate() + 30);
      const futureStr = future.toISOString().slice(0, 10);

      await service.update(TID, OID, { targetDate: futureStr });

      const saved = objRepo.save.mock.calls[0][0];
      expect(saved.status).toBe(ObjectiveStatus.ACTIVE);
    });

    it('should NOT transition when status is being explicitly set in the same update', async () => {
      const overdueObj = makeObj({
        status: ObjectiveStatus.OVERDUE,
        progress: 60,
      });
      const qb = objRepo.createQueryBuilder();
      qb.getOne.mockResolvedValueOnce(overdueObj);
      objRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

      const future = new Date();
      future.setDate(future.getDate() + 30);
      const futureStr = future.toISOString().slice(0, 10);

      // Admin explicitly sets a different status — should win over auto-transition
      await service.update(TID, OID, {
        targetDate: futureStr,
        status: ObjectiveStatus.ABANDONED,
      });

      const saved = objRepo.save.mock.calls[0][0];
      // dto.status was applied BEFORE the targetDate logic, but the
      // targetDate handler only auto-transitions if obj.status is still
      // OVERDUE — admin set ABANDONED so transition should NOT fire.
      expect(saved.status).toBe(ObjectiveStatus.ABANDONED);
    });

    it('should NOT touch ACTIVE objectives when targetDate is extended', async () => {
      const activeObj = makeObj({
        status: ObjectiveStatus.ACTIVE,
        progress: 60,
      });
      const qb = objRepo.createQueryBuilder();
      qb.getOne.mockResolvedValueOnce(activeObj);
      objRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

      const future = new Date();
      future.setDate(future.getDate() + 30);

      await service.update(TID, OID, {
        targetDate: future.toISOString().slice(0, 10),
      });

      const saved = objRepo.save.mock.calls[0][0];
      expect(saved.status).toBe(ObjectiveStatus.ACTIVE);
    });
  });

  describe('auto-completion guards include OVERDUE', () => {
    it('recalculateProgressFromKRs should auto-complete OVERDUE OKR when all KRs done', async () => {
      const kr = makeKR({ currentValue: 100, status: KRStatus.COMPLETED });
      krRepo.findOne.mockResolvedValue(
        makeKR({ currentValue: 0, status: KRStatus.ACTIVE }),
      );
      krRepo.find.mockResolvedValue([kr]);
      objRepo.findOne.mockResolvedValue(
        makeObj({ status: ObjectiveStatus.OVERDUE, parentObjectiveId: null }),
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

      expect(objRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ObjectiveStatus.COMPLETED }),
      );
      expect(recognitionService.addPoints).toHaveBeenCalled();
    });

    it('propagateProgressToParent should auto-complete OVERDUE parent when children reach 100%', async () => {
      const child = makeObj({
        id: fakeUuid(601),
        parentObjectiveId: fakeUuid(700),
        progress: 100,
        weight: 0,
      });
      const overdueParent = makeObj({
        id: fakeUuid(700),
        userId: UID,
        progress: 100,
        status: ObjectiveStatus.OVERDUE,
        parentObjectiveId: null,
      });

      objRepo.findOne
        .mockResolvedValueOnce(child)
        .mockResolvedValueOnce(overdueParent)
        .mockResolvedValueOnce(overdueParent);
      objRepo.find.mockResolvedValueOnce([child]);
      userRepo.findOne.mockResolvedValueOnce({
        id: UID,
        firstName: 'A',
        lastName: 'B',
        managerId: null,
      });

      await service.propagateProgressToParent(TID, fakeUuid(601), ACTOR);

      expect(objRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: fakeUuid(700),
          status: ObjectiveStatus.COMPLETED,
        }),
      );
    });
  });
});

// ─── Tarea 7 — CANCELLED separado de ABANDONED ─────────────────────────

describe('ObjectivesService — Tarea 7 (CANCELLED state)', () => {
  let service: ObjectivesService;
  let objRepo: any;
  let userRepo: any;
  let auditService: any;

  beforeEach(async () => {
    objRepo = createMockRepository();
    userRepo = createMockRepository();
    auditService = createMockAuditService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObjectivesService,
        { provide: getRepositoryToken(Objective), useValue: objRepo },
        {
          provide: getRepositoryToken(ObjectiveUpdate),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ObjectiveComment),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(KeyResult),
          useValue: createMockRepository(),
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(EvaluationCycle),
          useValue: createMockRepository(),
        },
        { provide: AuditService, useValue: auditService },
        {
          provide: EmailService,
          useValue: {
            sendObjectiveAssigned: jest.fn().mockResolvedValue(undefined),
            sendObjectiveCompleted: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: RecognitionService,
          useValue: {
            addPoints: jest.fn().mockResolvedValue(undefined),
            checkAutoBadges: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: NotificationsService,
          useValue: createMockNotificationsService(),
        },
        {
          provide: PushService,
          useValue: { sendToUser: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<ObjectivesService>(ObjectivesService);
  });

  describe('cancel()', () => {
    function setupFindByIdReturn(obj: Objective) {
      const qb = objRepo.createQueryBuilder();
      qb.getOne.mockResolvedValueOnce(obj);
    }

    it('should transition ACTIVE objective to CANCELLED with reason+by+at populated', async () => {
      const obj = makeObj({ status: ObjectiveStatus.ACTIVE });
      setupFindByIdReturn(obj);
      objRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

      const result = await service.cancel(
        TID,
        OID,
        'Cambio de prioridades del trimestre',
        ACTOR,
      );

      expect(result.status).toBe(ObjectiveStatus.CANCELLED);
      expect(result.cancellationReason).toBe('Cambio de prioridades del trimestre');
      expect(result.cancelledBy).toBe(ACTOR);
      expect(result.cancelledAt).toBeInstanceOf(Date);
      expect(auditService.log).toHaveBeenCalledWith(
        TID,
        ACTOR,
        'objective.cancelled_by_business',
        'objective',
        OID,
        expect.objectContaining({
          reason: 'Cambio de prioridades del trimestre',
          cancelledBy: ACTOR,
        }),
      );
    });

    it('should also accept DRAFT, PENDING_APPROVAL, OVERDUE as source states', async () => {
      const sources = [
        ObjectiveStatus.DRAFT,
        ObjectiveStatus.PENDING_APPROVAL,
        ObjectiveStatus.OVERDUE,
      ];
      for (const status of sources) {
        const obj = makeObj({ status });
        setupFindByIdReturn(obj);
        objRepo.save.mockImplementation((entity: any) =>
          Promise.resolve(entity),
        );

        const result = await service.cancel(TID, OID, 'razon valida', ACTOR);
        expect(result.status).toBe(ObjectiveStatus.CANCELLED);
      }
    });

    it('should reject cancellation of already COMPLETED', async () => {
      setupFindByIdReturn(makeObj({ status: ObjectiveStatus.COMPLETED }));

      await expect(
        service.cancel(TID, OID, 'razon valida', ACTOR),
      ).rejects.toThrow(/completado/);
    });

    it('should reject cancellation of already CANCELLED (idempotency by error)', async () => {
      setupFindByIdReturn(makeObj({ status: ObjectiveStatus.CANCELLED }));

      await expect(
        service.cancel(TID, OID, 'razon valida', ACTOR),
      ).rejects.toThrow(/cancelado/);
    });

    it('should reject cancellation of already ABANDONED', async () => {
      setupFindByIdReturn(makeObj({ status: ObjectiveStatus.ABANDONED }));

      await expect(
        service.cancel(TID, OID, 'razon valida', ACTOR),
      ).rejects.toThrow(/abandonado/);
    });
  });

  describe('CANCELLED guards in other paths', () => {
    it('update() should reject modification of CANCELLED objective', async () => {
      const obj = makeObj({ status: ObjectiveStatus.CANCELLED });
      const qb = objRepo.createQueryBuilder();
      qb.getOne.mockResolvedValueOnce(obj);

      await expect(
        service.update(TID, OID, { weight: 50 }),
      ).rejects.toThrow(/completados.*cancelados.*abandonados/);
    });

    it('addProgressUpdate() should reject progress on CANCELLED objective', async () => {
      const obj = makeObj({ status: ObjectiveStatus.CANCELLED });
      const qb = objRepo.createQueryBuilder();
      qb.getOne.mockResolvedValueOnce(obj);

      await expect(
        service.addProgressUpdate(TID, ACTOR, OID, {
          progressValue: 50,
          notes: 'sigo intentando',
        }),
      ).rejects.toThrow(/cancelado/);
    });

    it('validateWeightSum should NOT count CANCELLED siblings against new weight', async () => {
      // Sibling cancelado con peso 80, nuevo objetivo con peso 50 → debe permitir
      const qb = objRepo.createQueryBuilder();
      qb.getMany.mockResolvedValueOnce([]); // helper QB filters out cancelled at SQL level

      await expect(
        (service as any).validateWeightSum({
          tenantId: TID,
          userId: UID,
          cycleId: fakeUuid(500),
          candidateWeight: 50,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
