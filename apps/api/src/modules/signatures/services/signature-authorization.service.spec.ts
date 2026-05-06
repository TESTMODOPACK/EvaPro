import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ObjectLiteral, Repository } from 'typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SignatureAuthorizationService } from './signature-authorization.service';
import { EvaluationCycle } from '../../evaluations/entities/evaluation-cycle.entity';
import { EvaluationResponse } from '../../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../../evaluations/entities/evaluation-assignment.entity';
import { DevelopmentPlan } from '../../development/entities/development-plan.entity';
import { Contract } from '../../contracts/entities/contract.entity';
import { CalibrationSession } from '../../talent/entities/calibration-session.entity';

type Mock<T> = { [K in keyof T]: jest.Mock };

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const USER_OWNER = '33333333-3333-3333-3333-333333333333';
const USER_OTHER = '44444444-4444-4444-4444-444444444444';
const DOC_ID = '55555555-5555-5555-5555-555555555555';
const ASSIGNMENT_ID = '66666666-6666-6666-6666-666666666666';

function repoMock<T extends ObjectLiteral>(): Mock<Repository<T>> {
  return {
    findOne: jest.fn(),
  } as any;
}

describe('SignatureAuthorizationService', () => {
  let service: SignatureAuthorizationService;
  let cycleRepo: Mock<Repository<EvaluationCycle>>;
  let responseRepo: Mock<Repository<EvaluationResponse>>;
  let assignmentRepo: Mock<Repository<EvaluationAssignment>>;
  let planRepo: Mock<Repository<DevelopmentPlan>>;
  let contractRepo: Mock<Repository<Contract>>;
  let calibrationRepo: Mock<Repository<CalibrationSession>>;

  beforeEach(async () => {
    cycleRepo = repoMock<EvaluationCycle>();
    responseRepo = repoMock<EvaluationResponse>();
    assignmentRepo = repoMock<EvaluationAssignment>();
    planRepo = repoMock<DevelopmentPlan>();
    contractRepo = repoMock<Contract>();
    calibrationRepo = repoMock<CalibrationSession>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignatureAuthorizationService,
        { provide: getRepositoryToken(EvaluationCycle), useValue: cycleRepo },
        { provide: getRepositoryToken(EvaluationResponse), useValue: responseRepo },
        { provide: getRepositoryToken(EvaluationAssignment), useValue: assignmentRepo },
        { provide: getRepositoryToken(DevelopmentPlan), useValue: planRepo },
        { provide: getRepositoryToken(Contract), useValue: contractRepo },
        { provide: getRepositoryToken(CalibrationSession), useValue: calibrationRepo },
      ],
    }).compile();

    service = module.get<SignatureAuthorizationService>(SignatureAuthorizationService);
  });

  // ─── Validación de parámetros ──────────────────────────────────────

  describe('parámetros incompletos', () => {
    it('lanza BadRequestException si tenantId vacío', async () => {
      await expect(
        service.assertCanSign('', USER_OWNER, 'employee', 'evaluation_response', DOC_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si userId vacío', async () => {
      await expect(
        service.assertCanSign(TENANT_A, '', 'employee', 'evaluation_response', DOC_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si role vacío', async () => {
      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, '', 'evaluation_response', DOC_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si documentType vacío', async () => {
      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'employee', '', DOC_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si documentId vacío', async () => {
      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'employee', 'evaluation_response', ''),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('documentType desconocido', () => {
    it('lanza BadRequestException', async () => {
      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'employee', 'unknown_type', DOC_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── evaluation_response ─────────────────────────────────────────

  describe('evaluation_response', () => {
    it('permite firma cuando userId es el evaluatee', async () => {
      responseRepo.findOne.mockResolvedValue({
        id: DOC_ID, assignmentId: ASSIGNMENT_ID, tenantId: TENANT_A,
      } as any);
      assignmentRepo.findOne.mockResolvedValue({
        id: ASSIGNMENT_ID, evaluateeId: USER_OWNER, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'employee', 'evaluation_response', DOC_ID),
      ).resolves.toBeUndefined();

      // Multi-tenant: query filtra por tenantId
      expect(responseRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: DOC_ID, tenantId: TENANT_A } }),
      );
    });

    it('rechaza con ForbiddenException cuando userId NO es el evaluatee', async () => {
      responseRepo.findOne.mockResolvedValue({
        id: DOC_ID, assignmentId: ASSIGNMENT_ID, tenantId: TENANT_A,
      } as any);
      assignmentRepo.findOne.mockResolvedValue({
        id: ASSIGNMENT_ID, evaluateeId: USER_OTHER, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'employee', 'evaluation_response', DOC_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rechaza con ForbiddenException cuando rol manager pero no es el evaluatee', async () => {
      responseRepo.findOne.mockResolvedValue({
        id: DOC_ID, assignmentId: ASSIGNMENT_ID, tenantId: TENANT_A,
      } as any);
      assignmentRepo.findOne.mockResolvedValue({
        id: ASSIGNMENT_ID, evaluateeId: USER_OTHER, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'manager', 'evaluation_response', DOC_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rechaza con ForbiddenException cuando rol tenant_admin (no se permite suplantar firma de empleado)', async () => {
      responseRepo.findOne.mockResolvedValue({
        id: DOC_ID, assignmentId: ASSIGNMENT_ID, tenantId: TENANT_A,
      } as any);
      assignmentRepo.findOne.mockResolvedValue({
        id: ASSIGNMENT_ID, evaluateeId: USER_OTHER, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'tenant_admin', 'evaluation_response', DOC_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('permite firma a super_admin aunque NO sea el evaluatee (forensic bypass)', async () => {
      responseRepo.findOne.mockResolvedValue({
        id: DOC_ID, assignmentId: ASSIGNMENT_ID, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'super_admin', 'evaluation_response', DOC_ID),
      ).resolves.toBeUndefined();
      // Por ser super_admin, no debe consultar assignment
      expect(assignmentRepo.findOne).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si la respuesta no existe en el tenant', async () => {
      responseRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'employee', 'evaluation_response', DOC_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('cross-tenant: documento existente en otro tenant retorna NotFound', async () => {
      // findOne con where { id, tenantId: TENANT_A } → null porque doc está en TENANT_B
      responseRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'employee', 'evaluation_response', DOC_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si la asignación no existe', async () => {
      responseRepo.findOne.mockResolvedValue({
        id: DOC_ID, assignmentId: ASSIGNMENT_ID, tenantId: TENANT_A,
      } as any);
      assignmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'employee', 'evaluation_response', DOC_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── development_plan ──────────────────────────────────────────────

  describe('development_plan', () => {
    it('permite firma cuando userId es plan.userId', async () => {
      planRepo.findOne.mockResolvedValue({
        id: DOC_ID, userId: USER_OWNER, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'employee', 'development_plan', DOC_ID),
      ).resolves.toBeUndefined();
    });

    it('permite firma a tenant_admin aunque NO sea el dueño', async () => {
      planRepo.findOne.mockResolvedValue({
        id: DOC_ID, userId: USER_OTHER, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'tenant_admin', 'development_plan', DOC_ID),
      ).resolves.toBeUndefined();
    });

    it('permite firma a super_admin', async () => {
      planRepo.findOne.mockResolvedValue({
        id: DOC_ID, userId: USER_OTHER, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'super_admin', 'development_plan', DOC_ID),
      ).resolves.toBeUndefined();
    });

    it('rechaza a employee que NO es dueño del plan', async () => {
      planRepo.findOne.mockResolvedValue({
        id: DOC_ID, userId: USER_OTHER, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'employee', 'development_plan', DOC_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rechaza a manager que NO es dueño del plan', async () => {
      planRepo.findOne.mockResolvedValue({
        id: DOC_ID, userId: USER_OTHER, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'manager', 'development_plan', DOC_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lanza NotFoundException si el plan no existe', async () => {
      planRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'employee', 'development_plan', DOC_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── contract ──────────────────────────────────────────────────────

  describe('contract', () => {
    it('permite firma a tenant_admin', async () => {
      contractRepo.findOne.mockResolvedValue({ id: DOC_ID, tenantId: TENANT_A } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'tenant_admin', 'contract', DOC_ID),
      ).resolves.toBeUndefined();
    });

    it('permite firma a super_admin', async () => {
      contractRepo.findOne.mockResolvedValue({ id: DOC_ID, tenantId: TENANT_A } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'super_admin', 'contract', DOC_ID),
      ).resolves.toBeUndefined();
    });

    it('rechaza a employee', async () => {
      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'employee', 'contract', DOC_ID),
      ).rejects.toThrow(ForbiddenException);
      // No debe llegar a consultar el contrato (rechazo antes por rol)
      expect(contractRepo.findOne).not.toHaveBeenCalled();
    });

    it('rechaza a manager', async () => {
      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'manager', 'contract', DOC_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lanza NotFoundException si el contrato no existe', async () => {
      contractRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'tenant_admin', 'contract', DOC_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── calibration_session ───────────────────────────────────────────

  describe('calibration_session', () => {
    it('permite firma cuando userId es session.moderatorId', async () => {
      calibrationRepo.findOne.mockResolvedValue({
        id: DOC_ID, moderatorId: USER_OWNER, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'manager', 'calibration_session', DOC_ID),
      ).resolves.toBeUndefined();
    });

    it('permite firma a tenant_admin aunque NO sea el moderador', async () => {
      calibrationRepo.findOne.mockResolvedValue({
        id: DOC_ID, moderatorId: USER_OTHER, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'tenant_admin', 'calibration_session', DOC_ID),
      ).resolves.toBeUndefined();
    });

    it('rechaza a manager que NO es el moderador', async () => {
      calibrationRepo.findOne.mockResolvedValue({
        id: DOC_ID, moderatorId: USER_OTHER, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'manager', 'calibration_session', DOC_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rechaza a employee', async () => {
      calibrationRepo.findOne.mockResolvedValue({
        id: DOC_ID, moderatorId: USER_OTHER, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'employee', 'calibration_session', DOC_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lanza NotFoundException si la sesión no existe', async () => {
      calibrationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'manager', 'calibration_session', DOC_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── evaluation_cycle ──────────────────────────────────────────────

  describe('evaluation_cycle', () => {
    it('permite firma a tenant_admin', async () => {
      cycleRepo.findOne.mockResolvedValue({ id: DOC_ID, tenantId: TENANT_A } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'tenant_admin', 'evaluation_cycle', DOC_ID),
      ).resolves.toBeUndefined();
    });

    it('permite firma a super_admin', async () => {
      cycleRepo.findOne.mockResolvedValue({ id: DOC_ID, tenantId: TENANT_A } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'super_admin', 'evaluation_cycle', DOC_ID),
      ).resolves.toBeUndefined();
    });

    it('rechaza a manager', async () => {
      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'manager', 'evaluation_cycle', DOC_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rechaza a employee', async () => {
      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'employee', 'evaluation_cycle', DOC_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lanza NotFoundException si el ciclo no existe', async () => {
      cycleRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'tenant_admin', 'evaluation_cycle', DOC_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Cross-tenant defense ──────────────────────────────────────────

  describe('cross-tenant', () => {
    it('user de TENANT_A no puede firmar documento de TENANT_B', async () => {
      // El servicio recibe tenantId del JWT (TENANT_A) pero el doc vive en TENANT_B
      // findOne con where { id, tenantId: TENANT_A } retorna null
      planRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'tenant_admin', 'development_plan', DOC_ID),
      ).rejects.toThrow(NotFoundException);

      // Verificar explícitamente que el filtro de tenant fue aplicado
      expect(planRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_A }),
        }),
      );
    });
  });

  // ─── external role ─────────────────────────────────────────────────

  describe('rol external', () => {
    it('rechaza a external al firmar evaluation_response que no le pertenece como evaluatee', async () => {
      responseRepo.findOne.mockResolvedValue({
        id: DOC_ID, assignmentId: ASSIGNMENT_ID, tenantId: TENANT_A,
      } as any);
      assignmentRepo.findOne.mockResolvedValue({
        id: ASSIGNMENT_ID, evaluateeId: USER_OTHER, tenantId: TENANT_A,
      } as any);

      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'external', 'evaluation_response', DOC_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rechaza a external en contract', async () => {
      await expect(
        service.assertCanSign(TENANT_A, USER_OWNER, 'external', 'contract', DOC_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
