/**
 * signatures.service.spec.ts — Tests unitarios del SignaturesService.
 *
 * TAREA 2 / G7 (audit baseline). Cubre:
 *  - requestSignature: OTP de 6 dígitos generado, expiración 10 min,
 *    persistencia de OTP en user, envío de email
 *  - verifyAndSign: validación de OTP, expiración, duplicados, hash SHA-256,
 *    auditoría, multi-tenant
 *  - Auto-activación de contrato tras firma
 *  - getSignatures / verifyIntegrity con multi-tenant scoping
 *  - Integración con SignatureAuthorizationService (G1)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as crypto from 'crypto';

import { SignaturesService } from './signatures.service';
import { DocumentSignature } from './entities/document-signature.entity';
import { SignatureAuthorizationService } from './services/signature-authorization.service';
import { User } from '../users/entities/user.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { DevelopmentPlan } from '../development/entities/development-plan.entity';
import { DevelopmentAction } from '../development/entities/development-action.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { EmailService } from '../notifications/email.service';
import { AuditService } from '../audit/audit.service';
import {
  createMockRepository,
  createMockEmailService,
  createMockAuditService,
  createMockUser,
  fakeUuid,
} from '../../../test/test-utils';

describe('SignaturesService', () => {
  let service: SignaturesService;
  let signatureRepo: any;
  let userRepo: any;
  let cycleRepo: any;
  let responseRepo: any;
  let assignmentRepo: any;
  let planRepo: any;
  let actionRepo: any;
  let contractRepo: any;
  let emailService: any;
  let auditService: any;
  let authorizationService: { assertCanSign: jest.Mock };

  const tenantId = fakeUuid(100);
  const userId = fakeUuid(1);
  const otherTenantId = fakeUuid(101);
  const documentId = fakeUuid(50);

  beforeEach(async () => {
    signatureRepo = createMockRepository();
    userRepo = createMockRepository();
    cycleRepo = createMockRepository();
    responseRepo = createMockRepository();
    assignmentRepo = createMockRepository();
    planRepo = createMockRepository();
    actionRepo = createMockRepository();
    contractRepo = createMockRepository();
    emailService = createMockEmailService();
    // sendSignatureOtp no está en createMockEmailService, lo añadimos
    emailService.sendSignatureOtp = jest.fn().mockResolvedValue(undefined);
    auditService = createMockAuditService();
    authorizationService = {
      // Por default permite firmar — los tests específicos sobreescriben
      assertCanSign: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignaturesService,
        { provide: getRepositoryToken(DocumentSignature), useValue: signatureRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(EvaluationCycle), useValue: cycleRepo },
        { provide: getRepositoryToken(EvaluationResponse), useValue: responseRepo },
        { provide: getRepositoryToken(EvaluationAssignment), useValue: assignmentRepo },
        { provide: getRepositoryToken(DevelopmentPlan), useValue: planRepo },
        { provide: getRepositoryToken(DevelopmentAction), useValue: actionRepo },
        { provide: getRepositoryToken(Contract), useValue: contractRepo },
        { provide: EmailService, useValue: emailService },
        { provide: AuditService, useValue: auditService },
        { provide: SignatureAuthorizationService, useValue: authorizationService },
      ],
    }).compile();

    service = module.get<SignaturesService>(SignaturesService);
  });

  // ─── requestSignature ───────────────────────────────────────────────

  describe('requestSignature', () => {
    it('genera OTP de 6 dígitos y lo persiste en user con expiración futura', async () => {
      const user = createMockUser({ id: userId, tenantId, email: 'a@a.com' });
      userRepo.findOne.mockResolvedValue(user);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'Ciclo X' });

      const before = Date.now();
      const result = await service.requestSignature(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId,
      );
      const after = Date.now();

      expect(result).toEqual({
        message: expect.any(String),
        expiryMinutes: 10,
      });
      // user.signatureOtp asignado (6 dígitos)
      const savedUser = userRepo.save.mock.calls[0][0];
      expect(savedUser.signatureOtp).toMatch(/^\d{6}$/);
      // expira ~10 min en el futuro
      const expires = savedUser.signatureOtpExpires.getTime();
      expect(expires).toBeGreaterThanOrEqual(before + 10 * 60 * 1000 - 1000);
      expect(expires).toBeLessThanOrEqual(after + 10 * 60 * 1000 + 1000);
    });

    it('llama a SignatureAuthorizationService.assertCanSign con role del JWT (G1)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await service.requestSignature(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId,
      );

      expect(authorizationService.assertCanSign).toHaveBeenCalledWith(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId,
      );
    });

    it('lanza NotFoundException si el usuario no existe en el tenant', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.requestSignature(tenantId, userId, 'employee', 'evaluation_cycle', documentId),
      ).rejects.toThrow(NotFoundException);
    });

    it('propaga error de assertCanSign sin generar OTP ni mandar email', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      authorizationService.assertCanSign.mockRejectedValue(
        new BadRequestException('Tipo de documento no soportado'),
      );

      await expect(
        service.requestSignature(tenantId, userId, 'employee', 'unknown_type', documentId),
      ).rejects.toThrow(BadRequestException);

      expect(userRepo.save).not.toHaveBeenCalled();
      expect(emailService.sendSignatureOtp).not.toHaveBeenCalled();
    });

    it('user lookup respeta multi-tenant', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await service.requestSignature(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId,
      );

      expect(userRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: userId, tenantId } }),
      );
    });

    it('envía email con código OTP al firmante', async () => {
      const user = createMockUser({ id: userId, tenantId, email: 'firma@evapro.demo', firstName: 'Ana' });
      userRepo.findOne.mockResolvedValue(user);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'Ciclo Q1' });

      await service.requestSignature(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId,
      );

      expect(emailService.sendSignatureOtp).toHaveBeenCalledWith(
        'firma@evapro.demo',
        expect.objectContaining({
          firstName: 'Ana',
          documentName: 'Ciclo Q1',
          code: expect.stringMatching(/^\d{6}$/),
          expiryMinutes: 10,
        }),
      );
    });
  });

  // ─── verifyAndSign ───────────────────────────────────────────────────

  describe('verifyAndSign', () => {
    const validOtp = '123456';
    const futureDate = new Date(Date.now() + 5 * 60 * 1000);
    const pastDate = new Date(Date.now() - 60 * 1000);

    function userWithOtp(overrides: any = {}) {
      return createMockUser({
        id: userId,
        tenantId,
        signatureOtp: validOtp,
        signatureOtpExpires: futureDate,
        ...overrides,
      });
    }

    it('crea firma con hash SHA-256 del contenido del documento', async () => {
      userRepo.findOne.mockResolvedValue(userWithOtp());
      signatureRepo.findOne.mockResolvedValue(null); // sin firma previa
      cycleRepo.findOne.mockResolvedValue({
        id: documentId, name: 'C', type: '360', status: 'active',
        startDate: '2026-01-01', endDate: '2026-06-30', totalEvaluated: 10,
      });

      const saved = await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId,
        validOtp, '127.0.0.1',
      );

      expect(saved).toBeDefined();
      expect(signatureRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          documentType: 'evaluation_cycle',
          documentId,
          signedBy: userId,
          signerIp: '127.0.0.1',
          verificationMethod: 'otp_email',
          status: 'valid',
          documentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      );
      // Verificar que el hash es realmente SHA-256 del contenido
      const docContent = signatureRepo.create.mock.calls[0][0];
      expect(docContent.documentHash).toHaveLength(64); // 32 bytes hex
    });

    it('limpia OTP del usuario después de firmar exitosamente', async () => {
      const user = userWithOtp();
      userRepo.findOne.mockResolvedValue(user);
      signatureRepo.findOne.mockResolvedValue(null);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
      );

      // Una de las llamadas a save debe limpiar OTP
      const cleanCall = userRepo.save.mock.calls.find(
        (c: any) => c[0].signatureOtp === null && c[0].signatureOtpExpires === null,
      );
      expect(cleanCall).toBeDefined();
    });

    it('lanza BadRequestException si el OTP no coincide', async () => {
      userRepo.findOne.mockResolvedValue(userWithOtp());
      signatureRepo.findOne.mockResolvedValue(null);

      await expect(
        service.verifyAndSign(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, '000000'),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el OTP expiró', async () => {
      userRepo.findOne.mockResolvedValue(userWithOtp({ signatureOtpExpires: pastDate }));
      signatureRepo.findOne.mockResolvedValue(null);

      await expect(
        service.verifyAndSign(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp),
      ).rejects.toThrow(/expirado/i);
    });

    it('lanza BadRequestException si el usuario nunca solicitó OTP', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId, signatureOtp: null }));
      signatureRepo.findOne.mockResolvedValue(null);

      await expect(
        service.verifyAndSign(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza firma duplicada (mismo user + mismo documento ya firmado)', async () => {
      userRepo.findOne.mockResolvedValue(userWithOtp());
      signatureRepo.findOne.mockResolvedValue({ id: 'existing-sig' }); // firma previa válida

      await expect(
        service.verifyAndSign(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp),
      ).rejects.toThrow(/ya fue firmado/i);
    });

    it('búsqueda de firma duplicada respeta tenantId (anti cross-tenant)', async () => {
      userRepo.findOne.mockResolvedValue(userWithOtp());
      signatureRepo.findOne.mockResolvedValue(null);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
      );

      expect(signatureRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId, signedBy: userId, status: 'valid' }),
        }),
      );
    });

    it('llama a assertCanSign también en verify (defense in depth, G1)', async () => {
      userRepo.findOne.mockResolvedValue(userWithOtp());
      signatureRepo.findOne.mockResolvedValue(null);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
      );

      expect(authorizationService.assertCanSign).toHaveBeenCalledWith(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId,
      );
    });

    it('genera audit log con tenantId, userId y metadata correctos', async () => {
      userRepo.findOne.mockResolvedValue(userWithOtp());
      signatureRepo.findOne.mockResolvedValue(null);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });
      signatureRepo.save.mockImplementation((s: any) => Promise.resolve({ ...s, id: 'sig-id-1' }));

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp, '10.0.0.1',
      );

      // El service llama auditService.log(tenantId, userId, action, ...) con .catch
      expect(auditService.log).toHaveBeenCalledWith(
        tenantId,
        userId,
        'document.signed',
        'signature',
        'sig-id-1',
        expect.objectContaining({
          documentType: 'evaluation_cycle',
          documentId,
          verificationMethod: 'otp_email',
        }),
        '10.0.0.1',
      );
    });

    it('auto-activa contrato pending_signature → active al firmar', async () => {
      userRepo.findOne.mockResolvedValue(userWithOtp());
      signatureRepo.findOne.mockResolvedValue(null);
      const contract = {
        id: documentId, type: 'employment', title: 'Contrato',
        content: 'Texto', effectiveDate: '2026-01-01', version: 1, tenantId,
        status: 'pending_signature',
      };
      contractRepo.findOne.mockResolvedValue(contract);

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'contract', documentId, validOtp,
      );

      expect(contractRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active' }),
      );
    });

    it('NO cambia estado del contrato si NO está pending_signature', async () => {
      userRepo.findOne.mockResolvedValue(userWithOtp());
      signatureRepo.findOne.mockResolvedValue(null);
      const contract = {
        id: documentId, type: 'nda', title: 'Contrato',
        content: 'Texto', effectiveDate: '2026-01-01', version: 1, tenantId,
        status: 'draft',
      };
      contractRepo.findOne.mockResolvedValue(contract);

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'contract', documentId, validOtp,
      );

      expect(contractRepo.save).not.toHaveBeenCalled();
    });

    it('genera hash determinístico (mismo contenido → mismo hash)', async () => {
      const cycle = {
        id: documentId, name: 'C', type: '360', status: 'active',
        startDate: '2026-01-01', endDate: '2026-06-30', totalEvaluated: 5,
      };
      const expectedHash = crypto.createHash('sha256').update(JSON.stringify({
        id: cycle.id, name: cycle.name, type: cycle.type, status: cycle.status,
        startDate: cycle.startDate, endDate: cycle.endDate, totalEvaluated: cycle.totalEvaluated,
      })).digest('hex');

      userRepo.findOne.mockResolvedValue(userWithOtp());
      signatureRepo.findOne.mockResolvedValue(null);
      cycleRepo.findOne.mockResolvedValue(cycle);

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
      );

      const created = signatureRepo.create.mock.calls[0][0];
      expect(created.documentHash).toBe(expectedHash);
    });
  });

  // ─── verifyIntegrity ─────────────────────────────────────────────────

  describe('verifyIntegrity', () => {
    it('reporta integridad VÁLIDA si el documento no cambió', async () => {
      const cycle = {
        id: documentId, name: 'C', type: '360', status: 'active',
        startDate: '2026-01-01', endDate: '2026-06-30', totalEvaluated: 5,
      };
      const hash = crypto.createHash('sha256').update(JSON.stringify({
        id: cycle.id, name: cycle.name, type: cycle.type, status: cycle.status,
        startDate: cycle.startDate, endDate: cycle.endDate, totalEvaluated: cycle.totalEvaluated,
      })).digest('hex');
      signatureRepo.findOne.mockResolvedValue({
        id: 'sig-1', tenantId, documentType: 'evaluation_cycle', documentId,
        documentName: 'C', documentHash: hash, signedBy: userId,
        signerIp: '127.0.0.1', signedAt: new Date(),
        signer: { firstName: 'A', lastName: 'B' },
      });
      cycleRepo.findOne.mockResolvedValue(cycle);

      const r: any = await service.verifyIntegrity(tenantId, 'sig-1');
      expect(r.integrity).toBe('valid');
      expect(r.originalHash).toBe(r.currentHash);
    });

    it('reporta integridad MODIFICADA si el documento cambió', async () => {
      signatureRepo.findOne.mockResolvedValue({
        id: 'sig-1', tenantId, documentType: 'evaluation_cycle', documentId,
        documentName: 'C', documentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        signedBy: userId, signerIp: null, signedAt: new Date(), signer: null,
      });
      cycleRepo.findOne.mockResolvedValue({
        id: documentId, name: 'C-MODIFICADO', type: '360', status: 'active',
        startDate: '2026-01-01', endDate: '2026-06-30', totalEvaluated: 5,
      });

      const r: any = await service.verifyIntegrity(tenantId, 'sig-1');
      expect(r.integrity).toBe('modified');
    });

    it('reporta unknown si el documento ya no existe', async () => {
      signatureRepo.findOne.mockResolvedValue({
        id: 'sig-1', tenantId, documentType: 'evaluation_cycle', documentId,
        documentName: 'X', documentHash: 'h', signedBy: userId,
        signerIp: null, signedAt: new Date(), signer: null,
      });
      cycleRepo.findOne.mockResolvedValue(null); // doc eliminado

      const r: any = await service.verifyIntegrity(tenantId, 'sig-1');
      expect(r.integrity).toBe('unknown');
    });

    it('lanza NotFoundException si la firma no existe', async () => {
      signatureRepo.findOne.mockResolvedValue(null);

      await expect(service.verifyIntegrity(tenantId, 'sig-x')).rejects.toThrow(NotFoundException);
    });

    it('búsqueda de firma respeta multi-tenant', async () => {
      signatureRepo.findOne.mockResolvedValue(null);

      await expect(
        service.verifyIntegrity(otherTenantId, 'sig-x'),
      ).rejects.toThrow(NotFoundException);

      expect(signatureRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sig-x', tenantId: otherTenantId },
        }),
      );
    });
  });

  // ─── getSignatures / getSignaturesByTenant / getSignaturesByUser ────

  describe('listings', () => {
    it('getSignatures filtra por tenantId, documentType y documentId', async () => {
      signatureRepo.find.mockResolvedValue([]);
      await service.getSignatures(tenantId, 'evaluation_cycle', documentId);
      expect(signatureRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, documentType: 'evaluation_cycle', documentId },
        }),
      );
    });

    it('getSignaturesByTenant filtra solo por tenantId', async () => {
      signatureRepo.find.mockResolvedValue([]);
      await service.getSignaturesByTenant(tenantId);
      expect(signatureRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId } }),
      );
    });

    it('getSignaturesByUser filtra por tenantId Y signedBy', async () => {
      signatureRepo.find.mockResolvedValue([]);
      await service.getSignaturesByUser(tenantId, userId);
      expect(signatureRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, signedBy: userId } }),
      );
    });
  });
});
