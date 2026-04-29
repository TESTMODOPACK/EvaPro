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
  let dataSource: any;

  beforeEach(async () => {
    cycleRepo = createMockRepository();
    assignmentRepo = createMockRepository();
    peerAssignmentRepo = createMockRepository();
    templateRepo = createMockRepository();
    userRepo = createMockRepository();
    stageRepo = createMockRepository();
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
        { provide: getRepositoryToken(PeerAssignment), useValue: peerAssignmentRepo },
        { provide: getRepositoryToken(FormTemplate), useValue: templateRepo },
        // Pre-fix Fase 3 (Opción A): FormSubTemplate inyectado en
        // EvaluationsService para resolver template del relationType
        // (path Fase 3) o caer al legacy filterTemplateForRelation.
        { provide: getRepositoryToken(FormSubTemplate), useValue: createMockRepository() },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Objective), useValue: createMockRepository() },
        { provide: getRepositoryToken(KeyResult), useValue: createMockRepository() },
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
});
