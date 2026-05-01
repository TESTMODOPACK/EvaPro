/**
 * recruitment.service.spec.ts — Tests unitarios del RecruitmentService.
 *
 * S5.3 — cobertura de las reglas criticas construidas en S1-S4 + S5.1
 * + S6.1:
 *   - createProcess: validacion + audit
 *   - updateProcess: transiciones de status + archivado de CV (S4.2) +
 *     restauracion en reopen + audit
 *   - addExternal/Internal Candidate: validacion + history (S6.1)
 *   - updateCandidateStage: bloqueo a hired + bloqueo desde hired
 *   - hireCandidate: validaciones + cascada minima
 *   - revertHire: validaciones
 *   - resendWelcomeEmail: solo external+hired
 *
 * Mock strategy: usamos test-utils.createMockRepository + DataSource
 * mockTransaction. No tocamos BD real; los mocks devuelven valores
 * suficientes para la rama bajo test.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RecruitmentService } from './recruitment.service';
import { RecruitmentProcess, ProcessStatus } from './entities/recruitment-process.entity';
import { RecruitmentCandidate, CandidateStage } from './entities/recruitment-candidate.entity';
import { RecruitmentEvaluator } from './entities/recruitment-evaluator.entity';
import { RecruitmentInterview } from './entities/recruitment-interview.entity';
import { RecruitmentCandidateStageHistory } from './entities/recruitment-candidate-stage-history.entity';
import { User } from '../users/entities/user.entity';
import { UserMovement } from '../users/entities/user-movement.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { Department } from '../tenants/entities/department.entity';
import { Position } from '../tenants/entities/position.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { AiInsightsService } from '../ai-insights/ai-insights.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { TenantCronRunner } from '../../common/rls/tenant-cron-runner';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';
import {
  createMockRepository,
  createMockDataSource,
  createMockAuditService,
  createMockEmailService,
  createMockNotificationsService,
  fakeUuid,
} from '../../../test/test-utils';

describe('RecruitmentService', () => {
  let service: RecruitmentService;
  let processRepo: any;
  let candidateRepo: any;
  let evaluatorRepo: any;
  let interviewRepo: any;
  let stageHistoryRepo: any;
  let userRepo: any;
  let tenantRepo: any;
  let auditService: any;
  let emailService: any;
  let notificationsService: any;
  let dataSource: any;
  let usersService: any;

  const TENANT_ID = fakeUuid(100);
  const ADMIN_ID = fakeUuid(1);

  beforeEach(async () => {
    processRepo = createMockRepository();
    candidateRepo = createMockRepository();
    evaluatorRepo = createMockRepository();
    interviewRepo = createMockRepository();
    stageHistoryRepo = createMockRepository();
    userRepo = createMockRepository();
    tenantRepo = createMockRepository();
    auditService = createMockAuditService();
    emailService = createMockEmailService();
    // Adjust EmailService mock to include sendInvitation (used in S5.1).
    emailService.sendInvitation = jest.fn().mockResolvedValue(undefined);
    notificationsService = createMockNotificationsService();
    dataSource = createMockDataSource();

    usersService = {
      transferUser: jest.fn(),
      emitTransferredEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecruitmentService,
        { provide: getRepositoryToken(RecruitmentProcess), useValue: processRepo },
        { provide: getRepositoryToken(RecruitmentCandidate), useValue: candidateRepo },
        { provide: getRepositoryToken(RecruitmentEvaluator), useValue: evaluatorRepo },
        { provide: getRepositoryToken(RecruitmentInterview), useValue: interviewRepo },
        { provide: getRepositoryToken(RecruitmentCandidateStageHistory), useValue: stageHistoryRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserMovement), useValue: createMockRepository() },
        { provide: getRepositoryToken(EvaluationAssignment), useValue: createMockRepository() },
        { provide: getRepositoryToken(EvaluationResponse), useValue: createMockRepository() },
        { provide: getRepositoryToken(TalentAssessment), useValue: createMockRepository() },
        { provide: getRepositoryToken(Department), useValue: createMockRepository() },
        { provide: getRepositoryToken(Position), useValue: createMockRepository() },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: AiInsightsService, useValue: { analyzeCvForRecruitment: jest.fn() } },
        { provide: AuditService, useValue: auditService },
        { provide: DataSource, useValue: dataSource },
        { provide: TenantCronRunner, useValue: { runForEachTenant: jest.fn() } },
        { provide: UsersService, useValue: usersService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EmailService, useValue: emailService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<RecruitmentService>(RecruitmentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── createProcess ─────────────────────────────────────────────────

  describe('createProcess', () => {
    it('lanza si processType es invalido', async () => {
      await expect(
        service.createProcess(TENANT_ID, ADMIN_ID, { processType: 'foo', title: 'X', position: 'Y' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si falta titulo o cargo', async () => {
      await expect(
        service.createProcess(TENANT_ID, ADMIN_ID, { processType: 'external', title: '', position: 'Y' }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createProcess(TENANT_ID, ADMIN_ID, { processType: 'external', title: 'X', position: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('crea proceso con defaults y audit log', async () => {
      const mockProcess = { id: fakeUuid(200), tenantId: TENANT_ID, title: 'Devops Senior' };
      processRepo.save.mockResolvedValue(mockProcess);
      processRepo.findOne.mockResolvedValue(mockProcess);
      candidateRepo.find.mockResolvedValue([]);
      evaluatorRepo.find.mockResolvedValue([]);
      // getProcess() al final hace createQueryBuilder.getOne() para hidratar.
      // Configuramos el mock del QB para devolver el proceso hidratado.
      const procQbMock = processRepo.createQueryBuilder();
      procQbMock.getOne.mockResolvedValue(mockProcess);
      const candQbMock = candidateRepo.createQueryBuilder();
      candQbMock.getMany.mockResolvedValue([]);
      const evalQbMock = evaluatorRepo.createQueryBuilder();
      evalQbMock.getMany.mockResolvedValue([]);

      await service.createProcess(TENANT_ID, ADMIN_ID, {
        processType: 'external',
        title: 'Devops Senior',
        position: 'Devops',
      });

      expect(processRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          processType: 'external',
          title: 'Devops Senior',
          createdBy: ADMIN_ID,
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        TENANT_ID, ADMIN_ID,
        'recruitment.process_created',
        'recruitment_process',
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  // ─── updateProcess ─────────────────────────────────────────────────

  describe('updateProcess', () => {
    const processId = fakeUuid(200);

    it('lanza si proceso no existe', async () => {
      processRepo.findOne.mockResolvedValue(null);
      await expect(service.updateProcess(TENANT_ID, processId, { title: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('lanza si admin intenta cambiar startDate con proceso ACTIVE', async () => {
      processRepo.findOne.mockResolvedValue({
        id: processId,
        tenantId: TENANT_ID,
        status: ProcessStatus.ACTIVE,
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      });
      await expect(
        service.updateProcess(TENANT_ID, processId, { startDate: '2026-02-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('archiva CVs al cerrar proceso (status: active → closed)', async () => {
      processRepo.findOne.mockResolvedValue({
        id: processId,
        tenantId: TENANT_ID,
        status: ProcessStatus.ACTIVE,
        scoringWeights: {},
        requirements: [],
      });
      processRepo.save.mockResolvedValue({
        id: processId,
        tenantId: TENANT_ID,
        status: ProcessStatus.CLOSED,
        scoringWeights: {},
        requirements: [],
      });
      const qbMock = candidateRepo.createQueryBuilder();
      qbMock.execute.mockResolvedValue({ affected: 3 });

      await service.updateProcess(TENANT_ID, processId, { status: 'closed' });

      // El query de archivado debe haberse ejecutado.
      expect(qbMock.execute).toHaveBeenCalled();
      // Audit log de archivado.
      const archiveAuditCall = (auditService.log as jest.Mock).mock.calls.find(
        (c) => c[2] === 'recruitment.cvs_archived',
      );
      expect(archiveAuditCall).toBeDefined();
      expect(archiveAuditCall[5]).toMatchObject({ count: 3, reason: 'closed' });
    });

    it('NO archiva CVs si el status no cambia', async () => {
      processRepo.findOne.mockResolvedValue({
        id: processId,
        tenantId: TENANT_ID,
        status: ProcessStatus.ACTIVE,
        scoringWeights: {},
        requirements: [],
      });
      processRepo.save.mockResolvedValue({
        id: processId,
        tenantId: TENANT_ID,
        status: ProcessStatus.ACTIVE,
        scoringWeights: {},
        requirements: [],
      });
      const qbMock = candidateRepo.createQueryBuilder();
      qbMock.execute.mockResolvedValue({ affected: 0 });

      await service.updateProcess(TENANT_ID, processId, { title: 'Nuevo titulo' });

      const archiveAuditCall = (auditService.log as jest.Mock).mock.calls.find(
        (c) => c[2] === 'recruitment.cvs_archived',
      );
      expect(archiveAuditCall).toBeUndefined();
    });

    it('audita cambios de scoringWeights cuando cambian', async () => {
      processRepo.findOne.mockResolvedValue({
        id: processId,
        tenantId: TENANT_ID,
        status: ProcessStatus.DRAFT,
        scoringWeights: { interview: 50 },
        requirements: [],
      });
      processRepo.save.mockResolvedValue({
        id: processId,
        tenantId: TENANT_ID,
        status: ProcessStatus.DRAFT,
        scoringWeights: { interview: 60 },
        requirements: [],
      });

      await service.updateProcess(TENANT_ID, processId, {
        scoringWeights: { interview: 60 },
      }, ADMIN_ID);

      const auditCall = (auditService.log as jest.Mock).mock.calls.find(
        (c) => c[2] === 'recruitment.scoring_weights_updated',
      );
      expect(auditCall).toBeDefined();
      expect(auditCall[1]).toBe(ADMIN_ID);
    });
  });

  // ─── addExternalCandidate / addInternalCandidate ──────────────────

  describe('addExternalCandidate', () => {
    it('lanza si proceso es internal', async () => {
      processRepo.findOne.mockResolvedValue({
        id: fakeUuid(200),
        tenantId: TENANT_ID,
        processType: 'internal',
      });
      await expect(
        service.addExternalCandidate(TENANT_ID, fakeUuid(200), {
          firstName: 'X', lastName: 'Y', email: 'x@y.com',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('valida campos obligatorios', async () => {
      processRepo.findOne.mockResolvedValue({
        id: fakeUuid(200),
        tenantId: TENANT_ID,
        processType: 'external',
      });
      await expect(
        service.addExternalCandidate(TENANT_ID, fakeUuid(200), { firstName: 'X' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('crea candidato + audit log + history inicial', async () => {
      processRepo.findOne.mockResolvedValue({
        id: fakeUuid(200),
        tenantId: TENANT_ID,
        processType: 'external',
        title: 'Devops Sr',
      });
      candidateRepo.findOne.mockResolvedValue(null);
      candidateRepo.save.mockResolvedValue({
        id: fakeUuid(300),
        tenantId: TENANT_ID,
        stage: CandidateStage.REGISTERED,
        firstName: 'Juan',
        lastName: 'Perez',
        email: 'juan@x.com',
      });

      await service.addExternalCandidate(TENANT_ID, fakeUuid(200), {
        firstName: 'Juan', lastName: 'Perez', email: 'juan@x.com',
      }, ADMIN_ID);

      // Audit
      const auditCall = (auditService.log as jest.Mock).mock.calls.find(
        (c) => c[2] === 'recruitment.candidate_added',
      );
      expect(auditCall).toBeDefined();
      // History inicial
      expect(stageHistoryRepo.save).toHaveBeenCalled();
    });
  });

  describe('addInternalCandidate', () => {
    it('lanza si proceso es external', async () => {
      processRepo.findOne.mockResolvedValue({
        id: fakeUuid(200),
        tenantId: TENANT_ID,
        processType: 'external',
      });
      await expect(
        service.addInternalCandidate(TENANT_ID, fakeUuid(200), fakeUuid(1)),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si user no existe en el tenant', async () => {
      processRepo.findOne.mockResolvedValue({
        id: fakeUuid(200),
        tenantId: TENANT_ID,
        processType: 'internal',
      });
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.addInternalCandidate(TENANT_ID, fakeUuid(200), fakeUuid(1)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateCandidateStage ─────────────────────────────────────────

  describe('updateCandidateStage', () => {
    const candidateId = fakeUuid(300);

    it('bloquea cambio a hired (force usar hireCandidate)', async () => {
      await expect(
        service.updateCandidateStage(TENANT_ID, candidateId, 'hired'),
      ).rejects.toThrow(BadRequestException);
    });

    it('bloquea cambio DESDE hired (force usar revertHire)', async () => {
      candidateRepo.findOne.mockResolvedValue({
        id: candidateId,
        tenantId: TENANT_ID,
        stage: CandidateStage.HIRED,
        processId: fakeUuid(200),
      });
      await expect(
        service.updateCandidateStage(TENANT_ID, candidateId, 'approved'),
      ).rejects.toThrow(BadRequestException);
    });

    it('cambia stage normal y registra history + audit', async () => {
      candidateRepo.findOne.mockResolvedValue({
        id: candidateId,
        tenantId: TENANT_ID,
        stage: CandidateStage.SCORED,
        processId: fakeUuid(200),
      });
      candidateRepo.save.mockResolvedValue({
        id: candidateId,
        tenantId: TENANT_ID,
        stage: CandidateStage.APPROVED,
        processId: fakeUuid(200),
      });

      await service.updateCandidateStage(TENANT_ID, candidateId, 'approved', ADMIN_ID);

      const auditCall = (auditService.log as jest.Mock).mock.calls.find(
        (c) => c[2] === 'recruitment.candidate_stage_changed',
      );
      expect(auditCall).toBeDefined();
      expect(stageHistoryRepo.save).toHaveBeenCalled();
    });

    it('NO registra audit ni history si stage no cambia', async () => {
      candidateRepo.findOne.mockResolvedValue({
        id: candidateId,
        tenantId: TENANT_ID,
        stage: CandidateStage.APPROVED,
        processId: fakeUuid(200),
      });
      candidateRepo.save.mockResolvedValue({
        id: candidateId,
        tenantId: TENANT_ID,
        stage: CandidateStage.APPROVED,
        processId: fakeUuid(200),
      });

      await service.updateCandidateStage(TENANT_ID, candidateId, 'approved', ADMIN_ID);

      const auditCall = (auditService.log as jest.Mock).mock.calls.find(
        (c) => c[2] === 'recruitment.candidate_stage_changed',
      );
      expect(auditCall).toBeUndefined();
      expect(stageHistoryRepo.save).not.toHaveBeenCalled();
    });
  });

  // ─── revertHire ───────────────────────────────────────────────────

  describe('revertHire', () => {
    const candidateId = fakeUuid(300);

    it('lanza si candidato no esta en stage hired', async () => {
      candidateRepo.findOne.mockResolvedValue({
        id: candidateId,
        tenantId: TENANT_ID,
        stage: CandidateStage.APPROVED,
      });
      await expect(
        service.revertHire(TENANT_ID, candidateId, ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si candidato no existe', async () => {
      candidateRepo.findOne.mockResolvedValue(null);
      await expect(
        service.revertHire(TENANT_ID, candidateId, ADMIN_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Bulk operations (S6.2) ───────────────────────────────────────

  describe('bulkUpdateStage', () => {
    it('lanza si lista vacia', async () => {
      await expect(
        service.bulkUpdateStage(TENANT_ID, [], 'approved', ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si > 200 candidatos', async () => {
      const ids = Array(201).fill(0).map((_, i) => fakeUuid(1000 + i));
      await expect(
        service.bulkUpdateStage(TENANT_ID, ids, 'approved', ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si stage destino es hired', async () => {
      await expect(
        service.bulkUpdateStage(TENANT_ID, [fakeUuid(300)], 'hired', ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si stage es invalido', async () => {
      await expect(
        service.bulkUpdateStage(TENANT_ID, [fakeUuid(300)], 'invalid_stage', ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('actualiza eligibles, marca skipped + blocked', async () => {
      const id1 = fakeUuid(300), id2 = fakeUuid(301), id3 = fakeUuid(302), id4 = fakeUuid(303);
      // Solo retornamos id1, id2, id3 (id4 no existe en BD).
      // id3 esta en HIRED — debe ser blocked.
      candidateRepo.find.mockResolvedValue([
        { id: id1, tenantId: TENANT_ID, stage: CandidateStage.SCORED, processId: fakeUuid(200) },
        { id: id2, tenantId: TENANT_ID, stage: CandidateStage.INTERVIEWING, processId: fakeUuid(200) },
        { id: id3, tenantId: TENANT_ID, stage: CandidateStage.HIRED, processId: fakeUuid(200) },
      ]);
      const qb = candidateRepo.createQueryBuilder();
      qb.execute.mockResolvedValue({ affected: 2 });

      const result = await service.bulkUpdateStage(TENANT_ID, [id1, id2, id3, id4], 'approved', ADMIN_ID);

      expect(result.affected).toBe(2);
      expect(result.skipped).toEqual([id4]);
      expect(result.blocked).toEqual([id3]);
    });
  });

  describe('bulkDeleteCandidates', () => {
    it('lanza si lista vacia', async () => {
      await expect(
        service.bulkDeleteCandidates(TENANT_ID, [], ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si > 100 candidatos', async () => {
      const ids = Array(101).fill(0).map((_, i) => fakeUuid(2000 + i));
      await expect(
        service.bulkDeleteCandidates(TENANT_ID, ids, ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si alguno esta hired', async () => {
      const id1 = fakeUuid(300), id2 = fakeUuid(301);
      candidateRepo.find.mockResolvedValue([
        { id: id1, tenantId: TENANT_ID, stage: CandidateStage.HIRED },
        { id: id2, tenantId: TENANT_ID, stage: CandidateStage.SCORED },
      ]);
      await expect(
        service.bulkDeleteCandidates(TENANT_ID, [id1, id2], ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('borra candidatos eligibles + audit por cada uno', async () => {
      const id1 = fakeUuid(300), id2 = fakeUuid(301);
      candidateRepo.find.mockResolvedValue([
        { id: id1, tenantId: TENANT_ID, stage: CandidateStage.SCORED, processId: fakeUuid(200), firstName: 'Juan', lastName: 'P', email: 'j@p.com', candidateType: 'external' },
        { id: id2, tenantId: TENANT_ID, stage: CandidateStage.REJECTED, processId: fakeUuid(200), firstName: 'Maria', lastName: 'L', email: 'm@l.com', candidateType: 'external' },
      ]);
      const qb = candidateRepo.createQueryBuilder();
      qb.execute.mockResolvedValue({ affected: 2 });

      const result = await service.bulkDeleteCandidates(TENANT_ID, [id1, id2], ADMIN_ID);

      expect(result.deleted).toBe(2);
      const auditCalls = (auditService.log as jest.Mock).mock.calls.filter(
        (c) => c[2] === 'recruitment.candidate_deleted',
      );
      expect(auditCalls).toHaveLength(2);
    });
  });

  // ─── getArchivedCv (S5.2) ─────────────────────────────────────────

  describe('getArchivedCv', () => {
    const candidateId = fakeUuid(300);

    it('lanza si reason es < 20 chars', async () => {
      await expect(
        service.getArchivedCv(TENANT_ID, candidateId, 'corto', ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si reason es vacio', async () => {
      await expect(
        service.getArchivedCv(TENANT_ID, candidateId, '', ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si candidato no existe', async () => {
      const qb = candidateRepo.createQueryBuilder();
      qb.getRawAndEntities.mockResolvedValue({ entities: [], raw: [] });
      await expect(
        service.getArchivedCv(
          TENANT_ID, candidateId,
          'requerimiento legal del candidato',
          ADMIN_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza si CV no esta archivado', async () => {
      const qb = candidateRepo.createQueryBuilder();
      qb.getRawAndEntities.mockResolvedValue({
        entities: [{ id: candidateId, tenantId: TENANT_ID, cvArchivedAt: null }],
        raw: [{ c_cv_url_archived: null }],
      });
      await expect(
        service.getArchivedCv(
          TENANT_ID, candidateId,
          'requerimiento legal del candidato',
          ADMIN_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('retorna CV + audit log con reason', async () => {
      const archivedAt = new Date('2026-04-01T00:00:00Z');
      const qb = candidateRepo.createQueryBuilder();
      qb.getRawAndEntities.mockResolvedValue({
        entities: [{ id: candidateId, tenantId: TENANT_ID, cvArchivedAt: archivedAt }],
        raw: [{ c_cv_url_archived: 'data:application/pdf;base64,abc...' }],
      });

      const result = await service.getArchivedCv(
        TENANT_ID, candidateId,
        'requerimiento legal del candidato',
        ADMIN_ID,
      );

      expect(result.cvUrl).toBe('data:application/pdf;base64,abc...');
      expect(result.archivedAt).toBe(archivedAt);
      const auditCall = (auditService.log as jest.Mock).mock.calls.find(
        (c) => c[2] === 'recruitment.archived_cv_accessed',
      );
      expect(auditCall).toBeDefined();
      expect(auditCall[5].reason).toBe('requerimiento legal del candidato');
    });
  });

  // ─── resendWelcomeEmail (S5.1) ────────────────────────────────────

  describe('resendWelcomeEmail', () => {
    const candidateId = fakeUuid(300);

    it('lanza si candidato no es external', async () => {
      candidateRepo.findOne.mockResolvedValue({
        id: candidateId,
        tenantId: TENANT_ID,
        candidateType: 'internal',
        stage: CandidateStage.HIRED,
        email: 'x@y.com',
      });
      await expect(
        service.resendWelcomeEmail(TENANT_ID, candidateId, ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si candidato no esta hired', async () => {
      candidateRepo.findOne.mockResolvedValue({
        id: candidateId,
        tenantId: TENANT_ID,
        candidateType: 'external',
        stage: CandidateStage.APPROVED,
        email: 'x@y.com',
      });
      await expect(
        service.resendWelcomeEmail(TENANT_ID, candidateId, ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si candidato no tiene email', async () => {
      candidateRepo.findOne.mockResolvedValue({
        id: candidateId,
        tenantId: TENANT_ID,
        candidateType: 'external',
        stage: CandidateStage.HIRED,
        email: null,
      });
      await expect(
        service.resendWelcomeEmail(TENANT_ID, candidateId, ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si user account no existe', async () => {
      candidateRepo.findOne.mockResolvedValue({
        id: candidateId,
        tenantId: TENANT_ID,
        candidateType: 'external',
        stage: CandidateStage.HIRED,
        email: 'x@y.com',
        firstName: 'Juan',
        processId: fakeUuid(200),
      });
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.resendWelcomeEmail(TENANT_ID, candidateId, ADMIN_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('rota password y envia email', async () => {
      candidateRepo.findOne.mockResolvedValue({
        id: candidateId,
        tenantId: TENANT_ID,
        candidateType: 'external',
        stage: CandidateStage.HIRED,
        email: 'x@y.com',
        firstName: 'Juan',
        processId: fakeUuid(200),
      });
      userRepo.findOne.mockResolvedValue({
        id: fakeUuid(1),
        firstName: 'Juan',
        email: 'x@y.com',
      });
      tenantRepo.findOne.mockResolvedValue({ id: TENANT_ID, name: 'Acme Corp' });

      const result = await service.resendWelcomeEmail(TENANT_ID, candidateId, ADMIN_ID);

      expect(result.emailSent).toBe(true);
      expect(userRepo.update).toHaveBeenCalledWith(
        { id: fakeUuid(1), tenantId: TENANT_ID },
        expect.objectContaining({ mustChangePassword: true }),
      );
      expect(emailService.sendInvitation).toHaveBeenCalledWith(
        'x@y.com',
        expect.objectContaining({
          firstName: 'Juan',
          orgName: 'Acme Corp',
          tempPassword: expect.any(String),
        }),
      );
      const auditCall = (auditService.log as jest.Mock).mock.calls.find(
        (c) => c[2] === 'recruitment.welcome_email_resent',
      );
      expect(auditCall).toBeDefined();
    });

    it('lanza si email falla pero password ya rolo', async () => {
      candidateRepo.findOne.mockResolvedValue({
        id: candidateId,
        tenantId: TENANT_ID,
        candidateType: 'external',
        stage: CandidateStage.HIRED,
        email: 'x@y.com',
        firstName: 'Juan',
        processId: fakeUuid(200),
      });
      userRepo.findOne.mockResolvedValue({ id: fakeUuid(1), firstName: 'Juan', email: 'x@y.com' });
      tenantRepo.findOne.mockResolvedValue({ id: TENANT_ID, name: 'Acme' });
      emailService.sendInvitation.mockRejectedValue(new Error('Resend down'));

      await expect(
        service.resendWelcomeEmail(TENANT_ID, candidateId, ADMIN_ID),
      ).rejects.toThrow(BadRequestException);

      // Password DEBE haber sido rotado antes del fallo del email.
      expect(userRepo.update).toHaveBeenCalled();
      // Audit del fallo registrado.
      const failAudit = (auditService.log as jest.Mock).mock.calls.find(
        (c) => c[2] === 'recruitment.welcome_email_resend_failed',
      );
      expect(failAudit).toBeDefined();
    });
  });
});
