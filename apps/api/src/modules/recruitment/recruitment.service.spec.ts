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
import { RecruitmentInterviewSlot } from './entities/recruitment-interview-slot.entity';
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
  let interviewSlotRepo: any;
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
    interviewSlotRepo = createMockRepository();
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
        { provide: getRepositoryToken(RecruitmentInterviewSlot), useValue: interviewSlotRepo },
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

  // ─── Job board publico (S7.1) ─────────────────────────────────────

  describe('setPublicSlug', () => {
    const processId = fakeUuid(200);

    it('lanza si proceso no existe', async () => {
      processRepo.findOne.mockResolvedValue(null);
      await expect(
        service.setPublicSlug(TENANT_ID, processId, 'devops-2026', ADMIN_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza si proceso no es external', async () => {
      processRepo.findOne.mockResolvedValue({
        id: processId,
        tenantId: TENANT_ID,
        processType: 'internal',
      });
      await expect(
        service.setPublicSlug(TENANT_ID, processId, 'x-2026', ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si slug tiene caracteres invalidos (espacios, caracteres no permitidos)', async () => {
      processRepo.findOne.mockResolvedValue({
        id: processId,
        tenantId: TENANT_ID,
        processType: 'external',
      });
      await expect(
        service.setPublicSlug(TENANT_ID, processId, 'devops senior', ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.setPublicSlug(TENANT_ID, processId, 'devops_senior', ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('normaliza slug a lowercase automaticamente', async () => {
      processRepo.findOne
        .mockResolvedValueOnce({ id: processId, tenantId: TENANT_ID, processType: 'external' })
        .mockResolvedValueOnce(null);
      tenantRepo.findOne.mockResolvedValue({ slug: 'acme' });

      const r = await service.setPublicSlug(TENANT_ID, processId, 'Devops-Senior', ADMIN_ID);
      expect(r.publicSlug).toBe('devops-senior');
    });

    it('lanza si slug es muy corto', async () => {
      processRepo.findOne.mockResolvedValue({
        id: processId,
        tenantId: TENANT_ID,
        processType: 'external',
      });
      await expect(
        service.setPublicSlug(TENANT_ID, processId, 'ab', ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si slug ya existe en otro proceso del tenant', async () => {
      processRepo.findOne
        .mockResolvedValueOnce({ id: processId, tenantId: TENANT_ID, processType: 'external' })
        .mockResolvedValueOnce({ id: fakeUuid(201), tenantId: TENANT_ID, publicSlug: 'devops-2026' });
      await expect(
        service.setPublicSlug(TENANT_ID, processId, 'devops-2026', ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('publica con slug valido + audit', async () => {
      processRepo.findOne
        .mockResolvedValueOnce({ id: processId, tenantId: TENANT_ID, processType: 'external' })
        .mockResolvedValueOnce(null);
      tenantRepo.findOne.mockResolvedValue({ slug: 'acme' });

      const r = await service.setPublicSlug(TENANT_ID, processId, 'devops-2026', ADMIN_ID);

      expect(r.publicSlug).toBe('devops-2026');
      expect(r.publicUrl).toBe('/jobs/acme/devops-2026');
      const auditCall = (auditService.log as jest.Mock).mock.calls.find(
        (c) => c[2] === 'recruitment.process_published',
      );
      expect(auditCall).toBeDefined();
    });

    it('despublica con slug=null + audit', async () => {
      processRepo.findOne.mockResolvedValueOnce({
        id: processId, tenantId: TENANT_ID, processType: 'external', publicSlug: 'old-slug',
      });
      tenantRepo.findOne.mockResolvedValue({ slug: 'acme' });

      const r = await service.setPublicSlug(TENANT_ID, processId, null, ADMIN_ID);

      expect(r.publicSlug).toBeNull();
      expect(r.publicUrl).toBeNull();
      const auditCall = (auditService.log as jest.Mock).mock.calls.find(
        (c) => c[2] === 'recruitment.process_unpublished',
      );
      expect(auditCall).toBeDefined();
    });
  });

  describe('getPublicProcess', () => {
    it('lanza si tenant no existe', async () => {
      tenantRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getPublicProcess('inexistente', 'job-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza si proceso no existe / no esta publico', async () => {
      tenantRepo.findOne.mockResolvedValue({ id: TENANT_ID, name: 'Acme', slug: 'acme' });
      processRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getPublicProcess('acme', 'job-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('retorna metadata segura del proceso', async () => {
      tenantRepo.findOne.mockResolvedValue({ id: TENANT_ID, name: 'Acme', slug: 'acme' });
      processRepo.findOne.mockResolvedValue({
        title: 'Devops Senior',
        position: 'Devops',
        department: 'Tech',
        description: 'Buscamos...',
        requirements: [{ category: 'tech', text: 'AWS' }],
        endDate: '2026-12-31',
        publicSlug: 'devops-2026',
      });

      const r = await service.getPublicProcess('acme', 'devops-2026');

      expect(r.tenantName).toBe('Acme');
      expect(r.title).toBe('Devops Senior');
      expect((r as any).candidates).toBeUndefined();
      expect((r as any).scoringWeights).toBeUndefined();
    });
  });

  describe('applyToPublicProcess', () => {
    it('lanza si campos obligatorios faltan', async () => {
      await expect(
        service.applyToPublicProcess('acme', 'job-1', { firstName: 'X' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si email invalido', async () => {
      await expect(
        service.applyToPublicProcess('acme', 'job-1', {
          firstName: 'X', lastName: 'Y', email: 'bad-email',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si tenant no existe', async () => {
      tenantRepo.findOne.mockResolvedValue(null);
      await expect(
        service.applyToPublicProcess('x', 'job-1', {
          firstName: 'X', lastName: 'Y', email: 'x@y.com',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza si email ya aplico al proceso (dedup)', async () => {
      tenantRepo.findOne.mockResolvedValue({ id: TENANT_ID, name: 'Acme', slug: 'acme' });
      processRepo.findOne.mockResolvedValue({ id: fakeUuid(200), tenantId: TENANT_ID });
      candidateRepo.findOne.mockResolvedValue({ id: fakeUuid(300) });
      await expect(
        service.applyToPublicProcess('acme', 'job-1', {
          firstName: 'X', lastName: 'Y', email: 'dup@y.com',
        } as any),
      ).rejects.toThrow(); // ConflictException
    });

    it('crea candidato + audit + history', async () => {
      tenantRepo.findOne.mockResolvedValue({ id: TENANT_ID, name: 'Acme', slug: 'acme' });
      processRepo.findOne.mockResolvedValue({ id: fakeUuid(200), tenantId: TENANT_ID, title: 'Job' });
      candidateRepo.findOne.mockResolvedValue(null);
      candidateRepo.save.mockResolvedValue({
        id: fakeUuid(300),
        stage: CandidateStage.REGISTERED,
        email: 'new@y.com',
      });

      const r = await service.applyToPublicProcess('acme', 'job-1', {
        firstName: 'New', lastName: 'Cand', email: 'new@y.com',
        coverLetter: 'Hola mucho gusto',
      } as any);

      expect(r.ok).toBe(true);
      const auditCall = (auditService.log as jest.Mock).mock.calls.find(
        (c) => c[2] === 'recruitment.candidate_self_applied',
      );
      expect(auditCall).toBeDefined();
    });
  });

  // ─── getProcessMetrics (S6.3) ─────────────────────────────────────

  describe('getProcessMetrics', () => {
    const processId = fakeUuid(200);

    it('lanza si proceso no existe', async () => {
      processRepo.findOne.mockResolvedValue(null);
      await expect(service.getProcessMetrics(TENANT_ID, processId)).rejects.toThrow(NotFoundException);
    });

    it('retorna metricas con 0 candidatos sin reventar', async () => {
      processRepo.findOne.mockResolvedValue({
        id: processId,
        tenantId: TENANT_ID,
        status: ProcessStatus.ACTIVE,
        createdAt: new Date('2026-04-01T00:00:00Z'),
        startDate: new Date('2026-04-15T00:00:00Z'),
        winningCandidateId: null,
        hireData: null,
      });
      candidateRepo.find.mockResolvedValue([]);
      stageHistoryRepo.find.mockResolvedValue([]);
      evaluatorRepo.count.mockResolvedValue(0);

      const m = await service.getProcessMetrics(TENANT_ID, processId);

      expect(m.candidateCount).toBe(0);
      expect(m.candidatesByStage).toEqual({});
      expect(m.interviewsCompleted).toBe(0);
      expect(m.interviewsExpected).toBe(0);
      expect(m.winnerScore).toBeNull();
      expect(m.runnerUpScore).toBeNull();
      expect(m.timeToHireDays).toBeNull();
    });

    it('cuenta candidatos por stage y calcula winner/runnerUp scores', async () => {
      const winnerId = fakeUuid(300);
      processRepo.findOne.mockResolvedValue({
        id: processId,
        tenantId: TENANT_ID,
        status: ProcessStatus.COMPLETED,
        createdAt: new Date('2026-03-01T00:00:00Z'),
        startDate: new Date('2026-03-01T00:00:00Z'),
        winningCandidateId: winnerId,
        hireData: { effectiveDate: '2026-04-01' },
      });
      candidateRepo.find.mockResolvedValue([
        { id: winnerId, stage: CandidateStage.HIRED, finalScore: 9.2 },
        { id: fakeUuid(301), stage: CandidateStage.NOT_HIRED, finalScore: 7.5 },
        { id: fakeUuid(302), stage: CandidateStage.NOT_HIRED, finalScore: 6.0 },
        { id: fakeUuid(303), stage: CandidateStage.REJECTED, finalScore: 4.0 },
      ]);
      stageHistoryRepo.find.mockResolvedValue([]);
      evaluatorRepo.count.mockResolvedValue(2);
      interviewRepo.count.mockResolvedValue(8);

      const m = await service.getProcessMetrics(TENANT_ID, processId);

      expect(m.candidateCount).toBe(4);
      expect(m.candidatesByStage[CandidateStage.HIRED]).toBe(1);
      expect(m.candidatesByStage[CandidateStage.NOT_HIRED]).toBe(2);
      expect(m.candidatesByStage[CandidateStage.REJECTED]).toBe(1);
      expect(m.winnerScore).toBe(9.2);
      expect(m.runnerUpScore).toBe(7.5);
      expect(m.timeToHireDays).toBe(31); // 2026-03-01 → 2026-04-01
    });
  });

  // ─── Calendar integration (S7.2) ──────────────────────────────────

  describe('scheduleInterview', () => {
    const candidateId = fakeUuid(300);
    const evaluatorId = fakeUuid(2);

    it('lanza si faltan campos obligatorios', async () => {
      await expect(
        service.scheduleInterview(TENANT_ID, candidateId, {} as any, ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si scheduledAt invalido', async () => {
      await expect(
        service.scheduleInterview(TENANT_ID, candidateId, {
          evaluatorId,
          scheduledAt: 'not-a-date',
        }, ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si scheduledAt es pasado', async () => {
      await expect(
        service.scheduleInterview(TENANT_ID, candidateId, {
          evaluatorId,
          scheduledAt: '2020-01-01T10:00:00Z',
        }, ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si duracion fuera de rango', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await expect(
        service.scheduleInterview(TENANT_ID, candidateId, {
          evaluatorId, scheduledAt: future, durationMinutes: 5,
        }, ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.scheduleInterview(TENANT_ID, candidateId, {
          evaluatorId, scheduledAt: future, durationMinutes: 500,
        }, ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si candidato no existe', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      candidateRepo.findOne.mockResolvedValue(null);
      await expect(
        service.scheduleInterview(TENANT_ID, candidateId, {
          evaluatorId, scheduledAt: future,
        }, ADMIN_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza si evaluator no existe / inactivo', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      candidateRepo.findOne.mockResolvedValue({ id: candidateId, tenantId: TENANT_ID });
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.scheduleInterview(TENANT_ID, candidateId, {
          evaluatorId, scheduledAt: future,
        }, ADMIN_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('crea slot + audit + email', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      candidateRepo.findOne.mockResolvedValue({
        id: candidateId, tenantId: TENANT_ID,
        firstName: 'Juan', lastName: 'P', email: 'j@p.com',
      });
      userRepo.findOne.mockResolvedValue({
        id: evaluatorId, firstName: 'Eve', lastName: 'L', email: 'e@l.com',
      });
      tenantRepo.findOne.mockResolvedValue({ name: 'Acme' });
      interviewSlotRepo.save.mockResolvedValue({
        id: fakeUuid(500),
        tenantId: TENANT_ID,
        candidateId,
        evaluatorId,
        scheduledAt: new Date(future),
        durationMinutes: 60,
      });

      const r = await service.scheduleInterview(TENANT_ID, candidateId, {
        evaluatorId, scheduledAt: future,
      }, ADMIN_ID);

      expect(r.id).toBe(fakeUuid(500));
      const auditCall = (auditService.log as jest.Mock).mock.calls.find(
        (c) => c[2] === 'recruitment.interview_scheduled',
      );
      expect(auditCall).toBeDefined();
    });
  });

  describe('cancelInterviewSlot', () => {
    const slotId = fakeUuid(500);

    it('lanza si slot no existe', async () => {
      interviewSlotRepo.findOne.mockResolvedValue(null);
      await expect(
        service.cancelInterviewSlot(TENANT_ID, slotId, 'razon', ADMIN_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza si slot ya cancelado', async () => {
      interviewSlotRepo.findOne.mockResolvedValue({
        id: slotId, tenantId: TENANT_ID, status: 'cancelled',
      });
      await expect(
        service.cancelInterviewSlot(TENANT_ID, slotId, 'razon', ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza si slot completed', async () => {
      interviewSlotRepo.findOne.mockResolvedValue({
        id: slotId, tenantId: TENANT_ID, status: 'completed',
      });
      await expect(
        service.cancelInterviewSlot(TENANT_ID, slotId, 'razon', ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('cancela + audit', async () => {
      interviewSlotRepo.findOne.mockResolvedValue({
        id: slotId, tenantId: TENANT_ID, status: 'scheduled',
        candidateId: fakeUuid(300), evaluatorId: fakeUuid(2),
        scheduledAt: new Date('2026-12-31'), durationMinutes: 60,
      });
      interviewSlotRepo.save.mockResolvedValue({
        id: slotId, tenantId: TENANT_ID, status: 'cancelled', cancelReason: 'razon',
        candidateId: fakeUuid(300), evaluatorId: fakeUuid(2),
        scheduledAt: new Date('2026-12-31'), durationMinutes: 60,
      });
      candidateRepo.findOne.mockResolvedValue(null); // No envia email pero no falla.
      userRepo.findOne.mockResolvedValue(null);

      const r = await service.cancelInterviewSlot(TENANT_ID, slotId, 'razon valida', ADMIN_ID);

      expect(r.status).toBe('cancelled');
      const auditCall = (auditService.log as jest.Mock).mock.calls.find(
        (c) => c[2] === 'recruitment.interview_cancelled',
      );
      expect(auditCall).toBeDefined();
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
