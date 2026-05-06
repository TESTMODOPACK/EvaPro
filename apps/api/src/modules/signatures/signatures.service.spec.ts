/**
 * signatures.service.spec.ts — Tests unitarios del SignaturesService.
 *
 * Cubre:
 *  G7 baseline:
 *    - requestSignature: OTP de 6 dígitos, expiración 10 min, email,
 *      multi-tenant scoping, integración con SignatureAuthorizationService
 *    - verifyAndSign: validación de OTP, hash SHA-256 del documento,
 *      auditoría, duplicates, auto-activación de contrato
 *    - verifyIntegrity / listings con multi-tenant
 *  G9 (TAREA 3):
 *    - OTP persiste en signature_otp_tokens (NO en user)
 *    - codeHash es bcrypt (no plaintext)
 *    - Rate limiting: max 3 tokens activos del user en última hora
 *    - Attempts cap: max 5 intentos por token
 *    - Token consumido no se reutiliza
 *    - Atomic update de attempts (anti race condition)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

import { SignaturesService } from './signatures.service';
import { DocumentSignature } from './entities/document-signature.entity';
import { SignatureOtpToken } from './entities/signature-otp-token.entity';
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
  let otpRepo: any;
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

  // helpers para mock del query builder de UPDATE atómico
  function mockOtpUpdateBuilder(affected: number) {
    const exec = jest.fn().mockResolvedValue({ affected });
    const where = jest.fn().mockReturnValue({ execute: exec });
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    otpRepo.createQueryBuilder.mockReturnValue({ update });
    return { exec, where, set, update };
  }

  beforeEach(async () => {
    signatureRepo = createMockRepository();
    otpRepo = createMockRepository();
    userRepo = createMockRepository();
    cycleRepo = createMockRepository();
    responseRepo = createMockRepository();
    assignmentRepo = createMockRepository();
    planRepo = createMockRepository();
    actionRepo = createMockRepository();
    contractRepo = createMockRepository();
    emailService = createMockEmailService();
    emailService.sendSignatureOtp = jest.fn().mockResolvedValue(undefined);
    auditService = createMockAuditService();
    authorizationService = {
      assertCanSign: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignaturesService,
        { provide: getRepositoryToken(DocumentSignature), useValue: signatureRepo },
        { provide: getRepositoryToken(SignatureOtpToken), useValue: otpRepo },
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
    it('persiste codeHash con bcrypt (NO plaintext) y expiresAt 10 min en otpRepo (G9)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId, email: 'a@a.com' }));
      otpRepo.count.mockResolvedValue(0);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'Ciclo X' });

      const before = Date.now();
      const result = await service.requestSignature(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId,
      );
      const after = Date.now();

      expect(result).toEqual({ message: expect.any(String), expiryMinutes: 10 });

      // El OTP plaintext NO se persiste en DB; lo que se guarda es codeHash bcrypt
      const tokenSaved = otpRepo.save.mock.calls[0][0];
      expect(tokenSaved.codeHash).toMatch(/^\$2[aby]\$/); // bcrypt prefix
      expect(tokenSaved.codeHash).not.toMatch(/^\d{6}$/); // NO es plaintext
      // expira ~10 min en el futuro
      const expiresMs = tokenSaved.expiresAt.getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 10 * 60 * 1000 - 1000);
      expect(expiresMs).toBeLessThanOrEqual(after + 10 * 60 * 1000 + 1000);
      // Token vinculado a (tenant, user, documento)
      expect(tokenSaved).toMatchObject({
        tenantId, userId, documentType: 'evaluation_cycle', documentId,
      });
    });

    it('NO escribe OTP en user.signatureOtp (deprecated en G9)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      otpRepo.count.mockResolvedValue(0);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await service.requestSignature(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId);

      // userRepo.save no se llama desde requestSignature ya
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('rate limit: rechaza si user ya tiene 3 tokens activos en última hora (G9)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      otpRepo.count.mockResolvedValue(3); // ya en el cap

      await expect(
        service.requestSignature(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId),
      ).rejects.toThrow(HttpException);

      expect(otpRepo.save).not.toHaveBeenCalled();
      expect(emailService.sendSignatureOtp).not.toHaveBeenCalled();
    });

    it('rate limit: permite si user tiene 2 tokens activos (G9)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId, email: 'a@a.com' }));
      otpRepo.count.mockResolvedValue(2);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await expect(
        service.requestSignature(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId),
      ).resolves.toBeDefined();

      expect(otpRepo.save).toHaveBeenCalled();
    });

    it('rate limit: count consulta consumedAt IS NULL + expiresAt > NOW + última hora', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      otpRepo.count.mockResolvedValue(0);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await service.requestSignature(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId);

      // Verificar que el where del count incluye los criterios de "activo + última hora"
      const callArgs = otpRepo.count.mock.calls[0][0];
      expect(callArgs.where.userId).toBe(userId);
      expect(callArgs.where.consumedAt).toBeDefined(); // IsNull operator
      expect(callArgs.where.expiresAt).toBeDefined(); // MoreThan(now)
      expect(callArgs.where.createdAt).toBeDefined(); // MoreThan(oneHourAgo)
    });

    it('llama a SignatureAuthorizationService.assertCanSign con role del JWT (G1)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      otpRepo.count.mockResolvedValue(0);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await service.requestSignature(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId);

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

      expect(otpRepo.save).not.toHaveBeenCalled();
      expect(emailService.sendSignatureOtp).not.toHaveBeenCalled();
    });

    it('envía email con OTP plaintext de 6 dígitos al firmante', async () => {
      const user = createMockUser({ id: userId, tenantId, email: 'firma@evapro.demo', firstName: 'Ana' });
      userRepo.findOne.mockResolvedValue(user);
      otpRepo.count.mockResolvedValue(0);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'Ciclo Q1' });

      await service.requestSignature(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId);

      const emailArgs = emailService.sendSignatureOtp.mock.calls[0];
      expect(emailArgs[0]).toBe('firma@evapro.demo');
      expect(emailArgs[1]).toMatchObject({
        firstName: 'Ana',
        documentName: 'Ciclo Q1',
        code: expect.stringMatching(/^\d{6}$/), // plaintext en email
        expiryMinutes: 10,
      });
    });
  });

  // ─── verifyAndSign ───────────────────────────────────────────────────

  describe('verifyAndSign', () => {
    const validOtp = '123456';
    let validCodeHash: string;

    beforeAll(async () => {
      validCodeHash = await bcrypt.hash(validOtp, 4); // rounds bajos para test rápido
    });

    function activeToken(overrides: any = {}) {
      return {
        id: fakeUuid(900),
        tenantId, userId,
        documentType: 'evaluation_cycle',
        documentId,
        codeHash: validCodeHash,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
        consumedAt: null,
        createdAt: new Date(),
        ...overrides,
      };
    }

    it('crea firma con hash SHA-256 cuando OTP coincide y token está activo', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeToken());
      mockOtpUpdateBuilder(1);
      cycleRepo.findOne.mockResolvedValue({
        id: documentId, name: 'C', type: '360', status: 'active',
        startDate: '2026-01-01', endDate: '2026-06-30', totalEvaluated: 10,
      });

      const saved = await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp, '127.0.0.1',
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
    });

    it('marca el token como consumed_at tras éxito (no reusable, G9)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      const token = activeToken();
      otpRepo.findOne.mockResolvedValue(token);
      mockOtpUpdateBuilder(1);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
      );

      expect(otpRepo.update).toHaveBeenCalledWith(
        token.id,
        expect.objectContaining({ consumedAt: expect.any(Date) }),
      );
    });

    it('NO toca user.signatureOtp (deprecated en G9)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeToken());
      mockOtpUpdateBuilder(1);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
      );

      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('rechaza con BadRequestException si no hay token activo para (user, doc)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(null); // sin token

      await expect(
        service.verifyAndSign(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp),
      ).rejects.toThrow(/inválido o expirado/i);
    });

    it('rechaza si OTP plaintext no coincide con codeHash (bcrypt mismatch)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeToken());
      mockOtpUpdateBuilder(1);

      await expect(
        service.verifyAndSign(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, '000000'),
      ).rejects.toThrow(/inválido o expirado/i);

      // Audit del intento debe quedar via incremento de attempts
      const builder = otpRepo.createQueryBuilder.mock.results[0].value;
      expect(builder.update).toHaveBeenCalled();
    });

    it('rechaza si attempts >= 5 (token bloqueado, G9)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeToken({ attempts: 5 }));

      await expect(
        service.verifyAndSign(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp),
      ).rejects.toThrow(/agotado los intentos/i);
    });

    it('mensaje genérico no revela si fue inválido o expirado (timing-safe)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(null); // expirado/inexistente

      try {
        await service.verifyAndSign(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp);
        fail('should throw');
      } catch (e: any) {
        // Mensaje no revela si fue "inválido" vs "expirado" — los une en uno
        expect(e.message).toMatch(/inválido o expirado/i);
      }
    });

    it('atomic update incrementa attempts con WHERE attempts < MAX (anti race)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeToken());
      const builder = mockOtpUpdateBuilder(1);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
      );

      expect(builder.where).toHaveBeenCalledWith(
        expect.stringMatching(/attempts < :max/),
        expect.objectContaining({ max: 5 }),
      );
    });

    it('si el atomic update no afectó filas (race condition), rechaza', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeToken({ attempts: 4 }));
      mockOtpUpdateBuilder(0); // otra request lo bloqueó

      await expect(
        service.verifyAndSign(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp),
      ).rejects.toThrow(/agotado los intentos/i);
    });

    it('rechaza firma duplicada (mismo user + mismo documento ya firmado)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue({ id: 'existing-sig' });

      await expect(
        service.verifyAndSign(tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp),
      ).rejects.toThrow(/ya fue firmado/i);

      expect(otpRepo.findOne).not.toHaveBeenCalled();
    });

    it('búsqueda de token respeta multi-tenant + user + doc', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeToken());
      mockOtpUpdateBuilder(1);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
      );

      const callArgs = otpRepo.findOne.mock.calls[0][0];
      expect(callArgs.where).toMatchObject({
        tenantId, userId,
        documentType: 'evaluation_cycle',
        documentId,
      });
      // Y orden por createdAt DESC para tomar el más reciente
      expect(callArgs.order).toEqual({ createdAt: 'DESC' });
    });

    it('llama a assertCanSign también en verify (defense in depth, G1)', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeToken());
      mockOtpUpdateBuilder(1);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
      );

      expect(authorizationService.assertCanSign).toHaveBeenCalledWith(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId,
      );
    });

    it('genera audit log con tenantId, userId y metadata', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeToken());
      mockOtpUpdateBuilder(1);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });
      signatureRepo.save.mockImplementation((s: any) => Promise.resolve({ ...s, id: 'sig-id-1' }));

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp, '10.0.0.1',
      );

      expect(auditService.log).toHaveBeenCalledWith(
        tenantId, userId, 'document.signed', 'signature', 'sig-id-1',
        expect.objectContaining({
          documentType: 'evaluation_cycle', documentId, verificationMethod: 'otp_email',
        }),
        '10.0.0.1',
      );
    });

    it('auto-activa contrato pending_signature → active al firmar', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeToken({ documentType: 'contract' }));
      mockOtpUpdateBuilder(1);
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
        documentName: 'C', documentHash: 'a'.repeat(64),
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
      cycleRepo.findOne.mockResolvedValue(null);

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
