/**
 * evaluations.service.spec.ts — Tests unitarios del EvaluationsService.
 *
 * Cubre las reglas de negocio criticas:
 * - Crear ciclo: validaciones de tipo, nombre, fechas
 * - Lanzar ciclo: estado draft requerido, sin duplicados activos,
 *   minimo 3 pares para 270/360, template requerido
 * - Cerrar ciclo: solo activo/pausado
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EvaluationsService } from './evaluations.service';
import { EvaluationCycle } from './entities/evaluation-cycle.entity';
import { EvaluationAssignment } from './entities/evaluation-assignment.entity';
import { EvaluationResponse } from './entities/evaluation-response.entity';
import { CycleStage } from './entities/cycle-stage.entity';
import { CycleOrgSnapshot } from './entities/cycle-org-snapshot.entity';
import { CycleEvaluateeWeight } from './entities/cycle-evaluatee-weight.entity';
import { EvaluationObjectiveSnapshot } from './entities/evaluation-objective-snapshot.entity';
import { PeerAssignment } from './entities/peer-assignment.entity';
import { FormTemplate } from '../templates/entities/form-template.entity';
import { FormSubTemplate } from '../templates/entities/form-sub-template.entity';
import { User } from '../users/entities/user.entity';
import { Objective } from '../objectives/entities/objective.entity';
import { KeyResult } from '../objectives/entities/key-result.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { EmailService } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../notifications/push.service';
import {
  createMockRepository,
  createMockDataSource,
  createMockAuditService,
  createMockEmailService,
  createMockNotificationsService,
  createMockSubscriptionsService,
  createMockCycle,
  createMockUser,
  fakeUuid,
} from '../../../test/test-utils';

describe('EvaluationsService', () => {
  let service: EvaluationsService;
  let cycleRepo: any;
  let assignmentRepo: any;
  let peerAssignmentRepo: any;
  let templateRepo: any;
  let userRepo: any;
  let stageRepo: any;
  let objectiveRepo: any;
  let krRepo: any;
  let objSnapshotRepo: any;
  let dataSource: any;

  beforeEach(async () => {
    cycleRepo = createMockRepository();
    assignmentRepo = createMockRepository();
    peerAssignmentRepo = createMockRepository();
    templateRepo = createMockRepository();
    userRepo = createMockRepository();
    stageRepo = createMockRepository();
    objectiveRepo = createMockRepository();
    krRepo = createMockRepository();
    objSnapshotRepo = createMockRepository();
    dataSource = createMockDataSource();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvaluationsService,
        { provide: getRepositoryToken(EvaluationCycle), useValue: cycleRepo },
        { provide: getRepositoryToken(EvaluationAssignment), useValue: assignmentRepo },
        { provide: getRepositoryToken(EvaluationResponse), useValue: createMockRepository() },
        { provide: getRepositoryToken(CycleStage), useValue: stageRepo },
        // Sprint 1 BR-C.1: CycleOrgSnapshot inyectado en evaluations.service
        // para captureOrgSnapshot(). Mock simple para que el testing module
        // resuelva las deps.
        { provide: getRepositoryToken(CycleOrgSnapshot), useValue: createMockRepository() },
        // Sprint 2 BR-A.1: CycleEvaluateeWeight para pesos efectivos por evaluado.
        { provide: getRepositoryToken(CycleEvaluateeWeight), useValue: createMockRepository() },
        // Audit P0 T5.1: EvaluationObjectiveSnapshot para freezar objetivos al cierre/firma.
        { provide: getRepositoryToken(EvaluationObjectiveSnapshot), useValue: objSnapshotRepo },
        { provide: getRepositoryToken(PeerAssignment), useValue: peerAssignmentRepo },
        { provide: getRepositoryToken(FormTemplate), useValue: templateRepo },
        // Pre-fix Fase 3 (Opción A): FormSubTemplate inyectado en
        // EvaluationsService para resolver template del relationType
        // (path Fase 3) o caer al legacy filterTemplateForRelation.
        { provide: getRepositoryToken(FormSubTemplate), useValue: createMockRepository() },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Objective), useValue: objectiveRepo },
        { provide: getRepositoryToken(KeyResult), useValue: krRepo },
        { provide: getRepositoryToken(AuditLog), useValue: createMockRepository() },
        { provide: DataSource, useValue: dataSource },
        { provide: AuditService, useValue: createMockAuditService() },
        { provide: SubscriptionsService, useValue: createMockSubscriptionsService() },
        { provide: EmailService, useValue: createMockEmailService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
        // Mock PushService — agregado en pre-fix Fase 1: el constructor de
        // EvaluationsService lo inyecta para enviar notificaciones push, pero
        // el spec original no lo incluia → tests rompian al compilar el modulo.
        {
          provide: PushService,
          useValue: {
            sendBatch: jest.fn().mockResolvedValue(undefined),
            send: jest.fn().mockResolvedValue(undefined),
            sendNotification: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<EvaluationsService>(EvaluationsService);
  });

  // ─── findCycleById ─────────────────────────────────────────────────

  describe('findCycleById', () => {
    it('should throw NotFoundException if cycle not found', async () => {
      cycleRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findCycleById('nonexistent-id', fakeUuid(100)),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return the cycle if found', async () => {
      const cycle = createMockCycle();
      cycleRepo.findOne.mockResolvedValue(cycle);

      const result = await service.findCycleById(cycle.id, cycle.tenantId);

      expect(result).toEqual(cycle);
      expect(cycleRepo.findOne).toHaveBeenCalledWith({
        where: { id: cycle.id, tenantId: cycle.tenantId },
      });
    });
  });

  // ─── launchCycle ───────────────────────────────────────────────────

  describe('launchCycle', () => {
    it('should throw if cycle is not in draft status', async () => {
      const cycle = createMockCycle({ status: 'active' });
      cycleRepo.findOne.mockResolvedValue(cycle);

      await expect(
        service.launchCycle(cycle.id, cycle.tenantId, fakeUuid(1)),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if another active cycle of same type exists', async () => {
      const cycle = createMockCycle({ status: 'draft', type: '360' });
      cycleRepo.findOne
        .mockResolvedValueOnce(cycle) // findCycleById
        .mockResolvedValueOnce({ id: 'other-active', status: 'active' }); // duplicate check

      await expect(
        service.launchCycle(cycle.id, cycle.tenantId, fakeUuid(1)),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if cycle has no template assigned', async () => {
      const cycle = createMockCycle({ status: 'draft', templateId: null });
      cycleRepo.findOne
        .mockResolvedValueOnce(cycle) // findCycleById
        .mockResolvedValueOnce(null); // no active duplicate

      await expect(
        service.launchCycle(cycle.id, cycle.tenantId, fakeUuid(1)),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if no pre-assignments exist', async () => {
      const cycle = createMockCycle({ status: 'draft' });
      cycleRepo.findOne
        .mockResolvedValueOnce(cycle)
        .mockResolvedValueOnce(null); // no duplicate
      templateRepo.findOne.mockResolvedValue({ id: cycle.templateId }); // template exists
      peerAssignmentRepo.find.mockResolvedValue([]); // no pre-assignments

      await expect(
        service.launchCycle(cycle.id, cycle.tenantId, fakeUuid(1)),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── closeCycle ────────────────────────────────────────────────────

  describe('closeCycle', () => {
    it('should throw if cycle is not active or paused', async () => {
      const cycle = createMockCycle({ status: 'draft' });
      cycleRepo.findOne.mockResolvedValue(cycle);

      await expect(
        service.closeCycle(cycle.id, cycle.tenantId, fakeUuid(1)),
      ).rejects.toThrow(BadRequestException);
    });

    it('should close an active cycle successfully', async () => {
      const cycle = createMockCycle({ status: 'active' });
      cycleRepo.findOne.mockResolvedValue(cycle);
      cycleRepo.save.mockResolvedValue({ ...cycle, status: 'closed' });
      stageRepo.createQueryBuilder.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      });
      assignmentRepo.find.mockResolvedValue([]);

      const result = await service.closeCycle(cycle.id, cycle.tenantId, fakeUuid(1));

      expect(result.status).toBe('closed');
      expect(cycleRepo.save).toHaveBeenCalled();
    });
  });

  // ─── T5.2 Snapshot capture al cerrar ciclo ─────────────────────────

  describe('closeCycle — T5.2 objective snapshot capture (Issue A)', () => {
    function setupClose(cycle: any) {
      cycleRepo.findOne.mockResolvedValue(cycle);
      cycleRepo.save.mockResolvedValue({ ...cycle, status: 'closed' });
      stageRepo.createQueryBuilder.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      });
      assignmentRepo.find.mockResolvedValue([]);
    }

    it('should capture cycle-wide snapshots for objectives linked to the cycle', async () => {
      const cycle = createMockCycle({ status: 'active' });
      setupClose(cycle);

      // 2 objetivos vinculados al ciclo
      objectiveRepo.find.mockResolvedValue([
        {
          id: fakeUuid(50),
          tenantId: cycle.tenantId,
          userId: fakeUuid(10),
          title: 'OKR alpha',
          type: 'OKR',
          status: 'active',
          progress: 60,
          weight: 50,
          targetDate: null,
          cycleId: cycle.id,
        },
        {
          id: fakeUuid(51),
          tenantId: cycle.tenantId,
          userId: fakeUuid(11),
          title: 'KPI beta',
          type: 'KPI',
          status: 'completed',
          progress: 100,
          weight: 50,
          targetDate: null,
          cycleId: cycle.id,
        },
      ]);
      // 1 KR sobre el objetivo alpha
      const krQb = krRepo.createQueryBuilder();
      krQb.getMany.mockResolvedValueOnce([
        {
          id: fakeUuid(60),
          tenantId: cycle.tenantId,
          objectiveId: fakeUuid(50),
          description: 'KR1',
          unit: '%',
          baseValue: 0,
          targetValue: 100,
          currentValue: 60,
          status: 'active',
        },
      ]);

      objSnapshotRepo.create.mockImplementation((dto: any) => dto);
      objSnapshotRepo.save.mockImplementation((rows: any[]) =>
        Promise.resolve(rows),
      );

      await service.closeCycle(cycle.id, cycle.tenantId, fakeUuid(1));

      // El método save del snapshot repo recibió los 2 snapshots con los datos correctos
      expect(objSnapshotRepo.save).toHaveBeenCalledTimes(1);
      const snapshots = objSnapshotRepo.save.mock.calls[0][0];
      expect(snapshots).toHaveLength(2);
      const alpha = snapshots.find((s: any) => s.objectiveTitle === 'OKR alpha');
      expect(alpha).toMatchObject({
        cycleId: cycle.id,
        assignmentId: null,
        objectiveStatus: 'active',
        progress: 60,
        captureSource: 'cycle_close',
      });
      expect(alpha.keyResultsJson).toHaveLength(1);
      expect(alpha.keyResultsJson[0]).toMatchObject({
        description: 'KR1',
        currentValue: 60,
        status: 'active',
      });
      const beta = snapshots.find((s: any) => s.objectiveTitle === 'KPI beta');
      expect(beta.objectiveStatus).toBe('completed');
      expect(beta.keyResultsJson).toEqual([]);
    });

    it('should not call save when there are no objectives in the cycle', async () => {
      const cycle = createMockCycle({ status: 'active' });
      setupClose(cycle);
      objectiveRepo.find.mockResolvedValue([]);

      await service.closeCycle(cycle.id, cycle.tenantId, fakeUuid(1));

      expect(objSnapshotRepo.save).not.toHaveBeenCalled();
    });

    it('should not abort cycle close when snapshot save fails', async () => {
      const cycle = createMockCycle({ status: 'active' });
      setupClose(cycle);
      objectiveRepo.find.mockResolvedValue([
        {
          id: fakeUuid(50),
          tenantId: cycle.tenantId,
          userId: fakeUuid(10),
          title: 'OKR alpha',
          type: 'OKR',
          status: 'active',
          progress: 50,
          weight: 0,
          targetDate: null,
          cycleId: cycle.id,
        },
      ]);
      const krQb = krRepo.createQueryBuilder();
      krQb.getMany.mockResolvedValueOnce([]);
      objSnapshotRepo.create.mockImplementation((dto: any) => dto);
      objSnapshotRepo.save.mockRejectedValue(new Error('DB down'));

      const result = await service.closeCycle(
        cycle.id,
        cycle.tenantId,
        fakeUuid(1),
      );

      // Cycle still closed even if snapshot failed
      expect(result.status).toBe('closed');
    });
  });

  // ─── T5.3 Snapshot capture al firmar ───────────────────────────────

  describe('captureAssignmentObjectiveSnapshot — T5.3 (Issue A)', () => {
    it('should capture per-signature snapshots for evaluatee objectives in the cycle', async () => {
      const cycle = createMockCycle();
      const assignmentId = fakeUuid(900);
      assignmentRepo.findOne.mockResolvedValue({
        id: assignmentId,
        tenantId: cycle.tenantId,
        cycleId: cycle.id,
        evaluateeId: fakeUuid(20),
        cycle,
      });

      objectiveRepo.find.mockResolvedValueOnce([
        {
          id: fakeUuid(70),
          tenantId: cycle.tenantId,
          userId: fakeUuid(20),
          title: 'Goal X',
          type: 'SMART',
          status: 'active',
          progress: 75,
          weight: 100,
          targetDate: null,
          cycleId: cycle.id,
        },
      ]);
      const krQb = krRepo.createQueryBuilder();
      krQb.getMany.mockResolvedValueOnce([]);

      objSnapshotRepo.create.mockImplementation((dto: any) => dto);
      objSnapshotRepo.save.mockImplementation((rows: any[]) =>
        Promise.resolve(rows),
      );

      const count = await service.captureAssignmentObjectiveSnapshot(
        assignmentId,
        fakeUuid(1),
      );

      expect(count).toBe(1);
      const snapshots = objSnapshotRepo.save.mock.calls[0][0];
      expect(snapshots[0]).toMatchObject({
        assignmentId,
        objectiveTitle: 'Goal X',
        progress: 75,
        captureSource: 'signature',
      });
    });

    it('should return 0 when assignment does not exist', async () => {
      assignmentRepo.findOne.mockResolvedValue(null);

      const count = await service.captureAssignmentObjectiveSnapshot(
        fakeUuid(900),
        fakeUuid(1),
      );

      expect(count).toBe(0);
      expect(objSnapshotRepo.save).not.toHaveBeenCalled();
    });

    it('should fall back to objectives created within cycle period when none linked to cycle', async () => {
      const cycle = createMockCycle({
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-03-31'),
      });
      const assignmentId = fakeUuid(900);
      assignmentRepo.findOne.mockResolvedValue({
        id: assignmentId,
        tenantId: cycle.tenantId,
        cycleId: cycle.id,
        evaluateeId: fakeUuid(20),
        cycle,
      });

      // First find (cycle-linked) returns empty
      objectiveRepo.find.mockResolvedValueOnce([]);
      // Fallback QB returns date-range matches
      const objQb = objectiveRepo.createQueryBuilder();
      objQb.getMany.mockResolvedValueOnce([
        {
          id: fakeUuid(71),
          tenantId: cycle.tenantId,
          userId: fakeUuid(20),
          title: 'Date range goal',
          type: 'OKR',
          status: 'active',
          progress: 30,
          weight: 0,
          targetDate: null,
          cycleId: null,
        },
      ]);
      const krQb = krRepo.createQueryBuilder();
      krQb.getMany.mockResolvedValueOnce([]);

      objSnapshotRepo.create.mockImplementation((dto: any) => dto);
      objSnapshotRepo.save.mockImplementation((rows: any[]) =>
        Promise.resolve(rows),
      );

      const count = await service.captureAssignmentObjectiveSnapshot(
        assignmentId,
        fakeUuid(1),
      );

      expect(count).toBe(1);
      const snapshots = objSnapshotRepo.save.mock.calls[0][0];
      expect(snapshots[0].objectiveTitle).toBe('Date range goal');
    });

    it('should not throw when snapshot save fails (best-effort)', async () => {
      const cycle = createMockCycle();
      const assignmentId = fakeUuid(900);
      assignmentRepo.findOne.mockResolvedValue({
        id: assignmentId,
        tenantId: cycle.tenantId,
        cycleId: cycle.id,
        evaluateeId: fakeUuid(20),
        cycle,
      });
      objectiveRepo.find.mockResolvedValueOnce([
        {
          id: fakeUuid(70),
          tenantId: cycle.tenantId,
          userId: fakeUuid(20),
          title: 'X',
          type: 'SMART',
          status: 'active',
          progress: 50,
          weight: 0,
          targetDate: null,
          cycleId: cycle.id,
        },
      ]);
      const krQb = krRepo.createQueryBuilder();
      krQb.getMany.mockResolvedValueOnce([]);
      objSnapshotRepo.create.mockImplementation((dto: any) => dto);
      objSnapshotRepo.save.mockRejectedValue(new Error('boom'));

      await expect(
        service.captureAssignmentObjectiveSnapshot(assignmentId, fakeUuid(1)),
      ).resolves.toBe(0);
    });
  });
});
