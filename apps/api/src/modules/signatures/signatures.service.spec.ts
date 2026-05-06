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
import { CalibrationSession } from '../talent/entities/calibration-session.entity';
import { CalibrationEntry } from '../talent/entities/calibration-entry.entity';
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
  let calibrationRepo: any;
  let calibrationEntryRepo: any;
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
    calibrationRepo = createMockRepository();
    calibrationEntryRepo = createMockRepository();
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
        { provide: getRepositoryToken(CalibrationSession), useValue: calibrationRepo },
        { provide: getRepositoryToken(CalibrationEntry), useValue: calibrationEntryRepo },
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
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, 'recipient',
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
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, 'recipient',
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

    // ─── G2 (TAREA 5): signatureRole=AUTHOR ────────────────────────────

    describe('signatureRole=AUTHOR (G2)', () => {
      it('persiste signatureRole=author cuando se pasa signAs', async () => {
        userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
        signatureRepo.findOne.mockResolvedValue(null);
        otpRepo.findOne.mockResolvedValue(activeToken());
        mockOtpUpdateBuilder(1);
        responseRepo.findOne.mockResolvedValue({
          id: documentId, assignmentId: fakeUuid(70), tenantId,
          answers: { q1: 4 }, overallScore: 4.0, submittedAt: new Date(),
        });

        await service.verifyAndSign(
          tenantId, userId, 'manager', 'evaluation_response', documentId, validOtp,
          undefined, undefined, { signatureRole: 'author' as any },
        );

        expect(signatureRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ signatureRole: 'author' }),
        );
      });

      it('propaga signatureRole al SignatureAuthorizationService', async () => {
        userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
        signatureRepo.findOne.mockResolvedValue(null);
        otpRepo.findOne.mockResolvedValue(activeToken());
        mockOtpUpdateBuilder(1);
        responseRepo.findOne.mockResolvedValue({
          id: documentId, assignmentId: fakeUuid(70), tenantId,
          answers: {}, overallScore: 0, submittedAt: new Date(),
        });

        await service.verifyAndSign(
          tenantId, userId, 'manager', 'evaluation_response', documentId, validOtp,
          undefined, undefined, { signatureRole: 'author' as any },
        );

        expect(authorizationService.assertCanSign).toHaveBeenCalledWith(
          tenantId, userId, 'manager', 'evaluation_response', documentId, 'author',
        );
      });

      it('audit log incluye signatureRole', async () => {
        userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
        signatureRepo.findOne.mockResolvedValue(null);
        otpRepo.findOne.mockResolvedValue(activeToken());
        mockOtpUpdateBuilder(1);
        responseRepo.findOne.mockResolvedValue({
          id: documentId, assignmentId: fakeUuid(70), tenantId,
          answers: {}, overallScore: 0, submittedAt: new Date(),
        });
        signatureRepo.save.mockImplementation((s: any) => Promise.resolve({ ...s, id: 'sig-aut' }));

        await service.verifyAndSign(
          tenantId, userId, 'manager', 'evaluation_response', documentId, validOtp,
          undefined, undefined, { signatureRole: 'author' as any },
        );

        expect(auditService.log).toHaveBeenCalledWith(
          tenantId, userId, 'document.signed', 'signature', 'sig-aut',
          expect.objectContaining({ signatureRole: 'author' }),
          undefined,
        );
      });

      it('sin signAs → default RECIPIENT (compat histórica)', async () => {
        userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
        signatureRepo.findOne.mockResolvedValue(null);
        otpRepo.findOne.mockResolvedValue(activeToken());
        mockOtpUpdateBuilder(1);
        cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

        await service.verifyAndSign(
          tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
        );

        expect(signatureRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ signatureRole: 'recipient' }),
        );
      });
    });

    // ─── G5 (TAREA 7): acknowledgmentType + comment ────────────────────

    describe('acknowledgmentType (G5)', () => {
      it('default = AGREE cuando no se pasa acknowledgment (compat)', async () => {
        userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
        signatureRepo.findOne.mockResolvedValue(null);
        otpRepo.findOne.mockResolvedValue(activeToken());
        mockOtpUpdateBuilder(1);
        cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

        await service.verifyAndSign(
          tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
        );

        expect(signatureRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            acknowledgmentType: 'agree',
            acknowledgmentComment: null,
            signatureRole: 'recipient',
          }),
        );
      });

      it('AGREE con comment ignora el comment (no es required ni se persiste como decline)', async () => {
        userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
        signatureRepo.findOne.mockResolvedValue(null);
        otpRepo.findOne.mockResolvedValue(activeToken());
        mockOtpUpdateBuilder(1);
        cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

        await service.verifyAndSign(
          tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
          undefined, { type: 'agree' as any, comment: 'comentario opcional largo aquí' },
        );

        expect(signatureRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ acknowledgmentType: 'agree' }),
        );
      });

      it('AGREE_WITH_COMMENTS: persiste comment + tipo correcto', async () => {
        userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
        signatureRepo.findOne.mockResolvedValue(null);
        otpRepo.findOne.mockResolvedValue(activeToken());
        mockOtpUpdateBuilder(1);
        cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

        const longComment = 'Estoy de acuerdo pero tengo observaciones sobre la sección 3.';
        await service.verifyAndSign(
          tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
          undefined, { type: 'agree_with_comments' as any, comment: longComment },
        );

        expect(signatureRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            acknowledgmentType: 'agree_with_comments',
            acknowledgmentComment: longComment,
          }),
        );
      });

      it('AGREE_WITH_COMMENTS sin comment → BadRequestException', async () => {
        userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));

        await expect(
          service.verifyAndSign(
            tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
            undefined, { type: 'agree_with_comments' as any },
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('DECLINE con comment: registra rechazo, NO transiciona contrato', async () => {
        userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
        signatureRepo.findOne.mockResolvedValue(null);
        otpRepo.findOne.mockResolvedValue(activeToken({ documentType: 'contract' }));
        mockOtpUpdateBuilder(1);
        const contract = {
          id: documentId, type: 'employment', title: 'C',
          content: 'X', effectiveDate: '2026-01-01', version: 1, tenantId,
          status: 'pending_signature',
        };
        contractRepo.findOne.mockResolvedValue(contract);

        await service.verifyAndSign(
          tenantId, userId, 'tenant_admin', 'contract', documentId, validOtp,
          undefined,
          { type: 'decline' as any, comment: 'No estoy de acuerdo con la cláusula 5' },
        );

        // Firma se crea con type=decline
        expect(signatureRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ acknowledgmentType: 'decline' }),
        );
        // Pero el contrato NO se activa (queda en pending_signature)
        expect(contractRepo.save).not.toHaveBeenCalled();
      });

      it('DECLINE sin comment → BadRequestException', async () => {
        userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));

        await expect(
          service.verifyAndSign(
            tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
            undefined, { type: 'decline' as any, comment: 'no' /* < 10 chars */ },
          ),
        ).rejects.toThrow(/al menos 10 caracteres/i);
      });

      it('comment > 2000 chars → BadRequestException', async () => {
        userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));

        const huge = 'a'.repeat(2001);
        await expect(
          service.verifyAndSign(
            tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
            undefined, { type: 'agree_with_comments' as any, comment: huge },
          ),
        ).rejects.toThrow(/no puede superar los 2000/i);
      });

      it('acknowledgmentType inválido → BadRequestException', async () => {
        userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));

        await expect(
          service.verifyAndSign(
            tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
            undefined, { type: 'whatever' as any, comment: 'foo bar baz qux' },
          ),
        ).rejects.toThrow(/Tipo de reconocimiento inválido/);
      });

      it('audit log incluye acknowledgmentType + hasComment', async () => {
        userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
        signatureRepo.findOne.mockResolvedValue(null);
        otpRepo.findOne.mockResolvedValue(activeToken());
        mockOtpUpdateBuilder(1);
        cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });
        signatureRepo.save.mockImplementation((s: any) => Promise.resolve({ ...s, id: 'sig-1' }));

        await service.verifyAndSign(
          tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
          undefined,
          { type: 'agree_with_comments' as any, comment: 'observación importante aquí' },
        );

        expect(auditService.log).toHaveBeenCalledWith(
          tenantId, userId, 'document.signed', 'signature', 'sig-1',
          expect.objectContaining({
            acknowledgmentType: 'agree_with_comments',
            hasComment: true,
          }),
          undefined,
        );
      });

      it('comment se trimea (whitespace no cuenta para min length)', async () => {
        userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));

        await expect(
          service.verifyAndSign(
            tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
            undefined, { type: 'decline' as any, comment: '         ' /* solo spaces */ },
          ),
        ).rejects.toThrow(BadRequestException);
      });
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

  // ─── G10 (TAREA 11): hash real de calibration_session ──────────────

  describe('calibration_session — hash real (G10)', () => {
    const validOtp = '123456';

    function activeCalibrationToken(codeHash: string) {
      return {
        id: fakeUuid(900), tenantId, userId,
        documentType: 'calibration_session', documentId,
        codeHash, expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0, consumedAt: null, createdAt: new Date(),
      };
    }

    it('hash incluye contenido REAL (sesión + entries), no stub', async () => {
      const codeHash = await bcrypt.hash(validOtp, 4);
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeCalibrationToken(codeHash));
      mockOtpUpdateBuilder(1);
      calibrationRepo.findOne.mockResolvedValue({
        id: documentId, name: 'Calib Q1', status: 'completed',
        departmentId: fakeUuid(7), moderatorId: userId, minQuorum: 3,
        expectedDistribution: { low: 10, midLow: 20, mid: 40, midHigh: 20, high: 10 },
        notes: 'Notas de la sesión', tenantId,
      });
      calibrationEntryRepo.find.mockResolvedValue([
        {
          id: fakeUuid(11), userId: fakeUuid(101),
          originalScore: 3.5, adjustedScore: 4.0,
          originalPotential: 3.0, adjustedPotential: 3.5,
          rationale: 'Mejora consistente', status: 'agreed',
          approvalStatus: 'approved',
        },
      ]);

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'calibration_session', documentId, validOtp,
      );

      const created = signatureRepo.create.mock.calls[0][0];
      // El hash YA NO debe ser el del stub viejo {id, type, tenantId}
      const oldStubHash = require('crypto').createHash('sha256')
        .update(JSON.stringify({ id: documentId, type: 'calibration_session', tenantId }))
        .digest('hex');
      expect(created.documentHash).not.toBe(oldStubHash);
      expect(created.documentHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('hash es determinístico (mismo contenido → mismo hash)', async () => {
      const codeHash = await bcrypt.hash(validOtp, 4);
      const sessionData = {
        id: documentId, name: 'X', status: 'draft', departmentId: null,
        moderatorId: userId, minQuorum: 3, expectedDistribution: null,
        notes: null, tenantId,
      };
      const entries = [
        { id: 'e1', userId: 'u1', originalScore: 3, adjustedScore: null,
          originalPotential: null, adjustedPotential: null,
          rationale: null, status: 'pending', approvalStatus: 'not_required' },
      ];

      // Primera firma
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeCalibrationToken(codeHash));
      mockOtpUpdateBuilder(1);
      calibrationRepo.findOne.mockResolvedValue(sessionData);
      calibrationEntryRepo.find.mockResolvedValue(entries);

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'calibration_session', documentId, validOtp,
      );
      const hash1 = signatureRepo.create.mock.calls[0][0].documentHash;

      // Limpiar y firmar de nuevo con mismo contenido (escenario de re-firma de otro user)
      signatureRepo.create.mockClear();
      const codeHash2 = await bcrypt.hash(validOtp, 4);
      otpRepo.findOne.mockResolvedValue(activeCalibrationToken(codeHash2));
      mockOtpUpdateBuilder(1);
      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'calibration_session', documentId, validOtp,
      );
      const hash2 = signatureRepo.create.mock.calls[0][0].documentHash;

      expect(hash1).toBe(hash2);
    });

    it('hash cambia si UN campo de la sesión cambia', async () => {
      const codeHash = await bcrypt.hash(validOtp, 4);
      const baseEntries = [
        { id: 'e1', userId: 'u1', originalScore: 3, adjustedScore: null,
          originalPotential: null, adjustedPotential: null,
          rationale: null, status: 'pending', approvalStatus: 'not_required' },
      ];

      // Hash 1: notes='A'
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeCalibrationToken(codeHash));
      mockOtpUpdateBuilder(1);
      calibrationRepo.findOne.mockResolvedValue({
        id: documentId, name: 'X', status: 'draft', departmentId: null,
        moderatorId: userId, minQuorum: 3, expectedDistribution: null,
        notes: 'A', tenantId,
      });
      calibrationEntryRepo.find.mockResolvedValue(baseEntries);

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'calibration_session', documentId, validOtp,
      );
      const hash1 = signatureRepo.create.mock.calls[0][0].documentHash;

      // Hash 2: notes='B'
      signatureRepo.create.mockClear();
      const codeHash2 = await bcrypt.hash(validOtp, 4);
      otpRepo.findOne.mockResolvedValue(activeCalibrationToken(codeHash2));
      mockOtpUpdateBuilder(1);
      calibrationRepo.findOne.mockResolvedValue({
        id: documentId, name: 'X', status: 'draft', departmentId: null,
        moderatorId: userId, minQuorum: 3, expectedDistribution: null,
        notes: 'B', tenantId,
      });

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'calibration_session', documentId, validOtp,
      );
      const hash2 = signatureRepo.create.mock.calls[0][0].documentHash;

      expect(hash1).not.toBe(hash2);
    });

    it('hash cambia si una entry de la sesión cambia (adjustedScore)', async () => {
      const codeHash = await bcrypt.hash(validOtp, 4);
      const sessionData = {
        id: documentId, name: 'X', status: 'completed', departmentId: null,
        moderatorId: userId, minQuorum: 3, expectedDistribution: null,
        notes: null, tenantId,
      };

      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeCalibrationToken(codeHash));
      mockOtpUpdateBuilder(1);
      calibrationRepo.findOne.mockResolvedValue(sessionData);

      // Hash 1: adjustedScore=4.0
      calibrationEntryRepo.find.mockResolvedValue([
        { id: 'e1', userId: 'u1', originalScore: 3, adjustedScore: 4.0,
          originalPotential: null, adjustedPotential: null,
          rationale: null, status: 'agreed', approvalStatus: 'not_required' },
      ]);
      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'calibration_session', documentId, validOtp,
      );
      const hash1 = signatureRepo.create.mock.calls[0][0].documentHash;

      // Hash 2: adjustedScore=4.5
      signatureRepo.create.mockClear();
      const codeHash2 = await bcrypt.hash(validOtp, 4);
      otpRepo.findOne.mockResolvedValue(activeCalibrationToken(codeHash2));
      mockOtpUpdateBuilder(1);
      calibrationEntryRepo.find.mockResolvedValue([
        { id: 'e1', userId: 'u1', originalScore: 3, adjustedScore: 4.5,
          originalPotential: null, adjustedPotential: null,
          rationale: null, status: 'agreed', approvalStatus: 'not_required' },
      ]);
      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'calibration_session', documentId, validOtp,
      );
      const hash2 = signatureRepo.create.mock.calls[0][0].documentHash;

      expect(hash1).not.toBe(hash2);
    });

    it('lanza NotFoundException si la sesión no existe en getDocumentContent', async () => {
      const codeHash = await bcrypt.hash(validOtp, 4);
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeCalibrationToken(codeHash));
      mockOtpUpdateBuilder(1);
      calibrationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.verifyAndSign(
          tenantId, userId, 'tenant_admin', 'calibration_session', documentId, validOtp,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('canonicalJson: keys reordenadas dan el mismo hash (orden-invariante)', async () => {
      // Esto valida que canonicalJson normaliza el orden de keys.
      // Caso: si los repos retornan objetos con keys en orden distinto,
      // el hash debe ser idéntico.
      const codeHash = await bcrypt.hash(validOtp, 4);
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeCalibrationToken(codeHash));
      mockOtpUpdateBuilder(1);

      // Mismos campos, distinto orden de keys
      calibrationRepo.findOne.mockResolvedValueOnce({
        notes: 'X', name: 'S', id: documentId, status: 'draft',
        moderatorId: userId, departmentId: null, minQuorum: 3,
        expectedDistribution: null, tenantId,
      });
      calibrationEntryRepo.find.mockResolvedValueOnce([]);
      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'calibration_session', documentId, validOtp,
      );
      const hash1 = signatureRepo.create.mock.calls[0][0].documentHash;

      signatureRepo.create.mockClear();
      const codeHash2 = await bcrypt.hash(validOtp, 4);
      otpRepo.findOne.mockResolvedValue(activeCalibrationToken(codeHash2));
      mockOtpUpdateBuilder(1);
      calibrationRepo.findOne.mockResolvedValueOnce({
        id: documentId, name: 'S', status: 'draft', departmentId: null,
        moderatorId: userId, minQuorum: 3, expectedDistribution: null,
        notes: 'X', tenantId,
      });
      calibrationEntryRepo.find.mockResolvedValueOnce([]);
      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'calibration_session', documentId, validOtp,
      );
      const hash2 = signatureRepo.create.mock.calls[0][0].documentHash;

      expect(hash1).toBe(hash2);
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

  // ─── G6 (TAREA 12): denormalización de signedAt en evaluation_response ──

  describe('denormalize signedAt en evaluation_response (G6)', () => {
    const validOtp = '123456';

    function activeEvalResponseToken(codeHash: string) {
      return {
        id: fakeUuid(900), tenantId, userId,
        documentType: 'evaluation_response', documentId,
        codeHash, expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0, consumedAt: null, createdAt: new Date(),
      };
    }

    it('AGREE como RECIPIENT: actualiza recipientSignedAt en evaluation_response', async () => {
      const codeHash = await bcrypt.hash(validOtp, 4);
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeEvalResponseToken(codeHash));
      mockOtpUpdateBuilder(1);
      responseRepo.findOne.mockResolvedValue({
        id: documentId, assignmentId: fakeUuid(70), tenantId,
        answers: {}, overallScore: 0, submittedAt: new Date(),
      });

      await service.verifyAndSign(
        tenantId, userId, 'employee', 'evaluation_response', documentId, validOtp,
      );

      expect(responseRepo.update).toHaveBeenCalledWith(
        { id: documentId, tenantId },
        expect.objectContaining({ recipientSignedAt: expect.any(Date) }),
      );
    });

    it('AGREE como AUTHOR: actualiza authorSignedAt', async () => {
      const codeHash = await bcrypt.hash(validOtp, 4);
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeEvalResponseToken(codeHash));
      mockOtpUpdateBuilder(1);
      responseRepo.findOne.mockResolvedValue({
        id: documentId, assignmentId: fakeUuid(70), tenantId,
        answers: {}, overallScore: 0, submittedAt: new Date(),
      });

      await service.verifyAndSign(
        tenantId, userId, 'manager', 'evaluation_response', documentId, validOtp,
        undefined, undefined, { signatureRole: 'author' as any },
      );

      expect(responseRepo.update).toHaveBeenCalledWith(
        { id: documentId, tenantId },
        expect.objectContaining({ authorSignedAt: expect.any(Date) }),
      );
    });

    it('AGREE como EMPLOYER_WITNESS: actualiza witnessedAt', async () => {
      const codeHash = await bcrypt.hash(validOtp, 4);
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeEvalResponseToken(codeHash));
      mockOtpUpdateBuilder(1);
      responseRepo.findOne.mockResolvedValue({
        id: documentId, assignmentId: fakeUuid(70), tenantId,
        answers: {}, overallScore: 0, submittedAt: new Date(),
      });

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_response', documentId, validOtp,
        undefined, undefined, { signatureRole: 'employer_witness' as any },
      );

      expect(responseRepo.update).toHaveBeenCalledWith(
        { id: documentId, tenantId },
        expect.objectContaining({ witnessedAt: expect.any(Date) }),
      );
    });

    it('DECLINE: NO actualiza ningún timestamp denormalizado', async () => {
      const codeHash = await bcrypt.hash(validOtp, 4);
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeEvalResponseToken(codeHash));
      mockOtpUpdateBuilder(1);
      responseRepo.findOne.mockResolvedValue({
        id: documentId, assignmentId: fakeUuid(70), tenantId,
        answers: {}, overallScore: 0, submittedAt: new Date(),
      });

      await service.verifyAndSign(
        tenantId, userId, 'employee', 'evaluation_response', documentId, validOtp,
        undefined,
        { type: 'decline' as any, comment: 'No estoy de acuerdo con la calificación' },
      );

      // Ya había una llamada a update (por el flujo del response... wait,
      // el assertCanSign llama responseRepo.findOne, no update)
      // Verificar que UPDATE no fue llamado en absoluto sería ideal
      const updateCalls = responseRepo.update.mock.calls;
      const denormUpdate = updateCalls.find((c: any) =>
        c[1].recipientSignedAt || c[1].authorSignedAt || c[1].witnessedAt,
      );
      expect(denormUpdate).toBeUndefined();
    });

    it('NO se llama update para documentType !== evaluation_response', async () => {
      const codeHash = await bcrypt.hash(validOtp, 4);
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue({
        id: fakeUuid(901), tenantId, userId,
        documentType: 'evaluation_cycle', documentId,
        codeHash, expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0, consumedAt: null, createdAt: new Date(),
      });
      mockOtpUpdateBuilder(1);
      cycleRepo.findOne.mockResolvedValue({ id: documentId, name: 'X' });

      await service.verifyAndSign(
        tenantId, userId, 'tenant_admin', 'evaluation_cycle', documentId, validOtp,
      );

      expect(responseRepo.update).not.toHaveBeenCalled();
    });

    it('falla del update NO bloquea la creación de firma (best-effort)', async () => {
      const codeHash = await bcrypt.hash(validOtp, 4);
      userRepo.findOne.mockResolvedValue(createMockUser({ id: userId, tenantId }));
      signatureRepo.findOne.mockResolvedValue(null);
      otpRepo.findOne.mockResolvedValue(activeEvalResponseToken(codeHash));
      mockOtpUpdateBuilder(1);
      responseRepo.findOne.mockResolvedValue({
        id: documentId, assignmentId: fakeUuid(70), tenantId,
        answers: {}, overallScore: 0, submittedAt: new Date(),
      });
      responseRepo.update.mockRejectedValueOnce(new Error('DB temporarily down'));

      // No debe lanzar — la firma ya fue creada
      await expect(
        service.verifyAndSign(
          tenantId, userId, 'employee', 'evaluation_response', documentId, validOtp,
        ),
      ).resolves.toBeDefined();
    });
  });

  // ─── G3 (TAREA 6): hasSignatureWithRole ────────────────────────────

  describe('hasSignatureWithRole (G3)', () => {
    it('devuelve true cuando existe firma valida con el rol', async () => {
      signatureRepo.count.mockResolvedValue(1);
      const result = await service.hasSignatureWithRole(
        tenantId, 'evaluation_response', documentId, 'employer_witness' as any,
      );
      expect(result).toBe(true);
      expect(signatureRepo.count).toHaveBeenCalledWith({
        where: {
          tenantId, documentType: 'evaluation_response', documentId,
          status: 'valid', signatureRole: 'employer_witness',
        },
      });
    });

    it('devuelve false cuando no existe firma con el rol', async () => {
      signatureRepo.count.mockResolvedValue(0);
      const result = await service.hasSignatureWithRole(
        tenantId, 'evaluation_response', documentId, 'employer_witness' as any,
      );
      expect(result).toBe(false);
    });

    it('respeta multi-tenant', async () => {
      signatureRepo.count.mockResolvedValue(0);
      await service.hasSignatureWithRole(
        otherTenantId, 'evaluation_response', documentId, 'author' as any,
      );
      expect(signatureRepo.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ tenantId: otherTenantId }),
      });
    });

    it('NO cuenta firmas revocadas (solo valid)', async () => {
      signatureRepo.count.mockResolvedValue(0);
      await service.hasSignatureWithRole(
        tenantId, 'evaluation_response', documentId, 'employer_witness' as any,
      );
      expect(signatureRepo.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ status: 'valid' }),
      });
    });
  });

  // ─── G8 (TAREA 9): revokeSignature ──────────────────────────────────

  describe('revokeSignature (G8)', () => {
    const sigId = fakeUuid(800);
    const validReason = 'Firma revocada por solicitud judicial caso 123/2026';

    it('marca firma como revoked con metadata (super_admin)', async () => {
      const sig = {
        id: sigId, tenantId, status: 'valid',
        documentType: 'evaluation_response', documentId,
        signedBy: fakeUuid(2), revokedAt: null, revokedBy: null,
      };
      signatureRepo.findOne.mockResolvedValue(sig);
      signatureRepo.save.mockImplementation((s: any) => Promise.resolve(s));

      const result: any = await service.revokeSignature(
        tenantId, userId, 'super_admin', sigId, validReason, '127.0.0.1',
      );

      expect(result.status).toBe('revoked');
      expect(result.revokedBy).toBe(userId);
      expect(result.revokedAt).toBeInstanceOf(Date);
      expect(result.revocationReason).toBe(validReason);

      expect(auditService.log).toHaveBeenCalledWith(
        tenantId, userId, 'document.signature.revoked', 'signature', sigId,
        expect.objectContaining({ reason: validReason }),
        '127.0.0.1',
      );
    });

    it('rechaza si rol NO es super_admin (defense in depth)', async () => {
      await expect(
        service.revokeSignature(tenantId, userId, 'tenant_admin', sigId, validReason),
      ).rejects.toThrow(/Solo super_admin/);
      // No debe siquiera consultar la firma
      expect(signatureRepo.findOne).not.toHaveBeenCalled();
    });

    it('rechaza reason < 20 caracteres', async () => {
      await expect(
        service.revokeSignature(tenantId, userId, 'super_admin', sigId, 'corto'),
      ).rejects.toThrow(/al menos 20 caracteres/);
    });

    it('rechaza reason > 2000 caracteres', async () => {
      await expect(
        service.revokeSignature(tenantId, userId, 'super_admin', sigId, 'a'.repeat(2001)),
      ).rejects.toThrow(/no puede superar los 2000/);
    });

    it('reason se trimea (whitespace solo no cuenta)', async () => {
      await expect(
        service.revokeSignature(tenantId, userId, 'super_admin', sigId, '   '.repeat(50)),
      ).rejects.toThrow(/al menos 20 caracteres/);
    });

    it('lanza NotFoundException si la firma no existe', async () => {
      signatureRepo.findOne.mockResolvedValue(null);
      await expect(
        service.revokeSignature(tenantId, userId, 'super_admin', sigId, validReason),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza ConflictException si la firma ya está revocada', async () => {
      signatureRepo.findOne.mockResolvedValue({
        id: sigId, tenantId, status: 'revoked',
      });
      await expect(
        service.revokeSignature(tenantId, userId, 'super_admin', sigId, validReason),
      ).rejects.toThrow(/ya fue revocada/);
    });

    it('búsqueda de firma respeta multi-tenant', async () => {
      signatureRepo.findOne.mockResolvedValue(null);
      await expect(
        service.revokeSignature(otherTenantId, userId, 'super_admin', sigId, validReason),
      ).rejects.toThrow(NotFoundException);

      expect(signatureRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: sigId, tenantId: otherTenantId } }),
      );
    });

    // ─── B1 fix: limpieza de campo denormalizado tras revocación ─────

    describe('limpieza denormalizada (B1 fix)', () => {
      it('revocar firma RECIPIENT: pone recipientSignedAt a NULL si no quedan otras', async () => {
        const revokedSig = {
          id: sigId, tenantId, status: 'valid',
          documentType: 'evaluation_response', documentId,
          signedBy: fakeUuid(2), signatureRole: 'recipient',
          revokedAt: null, revokedBy: null,
        };
        signatureRepo.findOne
          .mockResolvedValueOnce(revokedSig as any) // primera llamada: la firma a revocar
          .mockResolvedValueOnce(null); // segunda llamada: no quedan otras firmas válidas
        signatureRepo.save.mockImplementation((s: any) => Promise.resolve(s));

        await service.revokeSignature(
          tenantId, userId, 'super_admin', sigId, validReason,
        );

        expect(responseRepo.update).toHaveBeenCalledWith(
          { id: documentId, tenantId },
          { recipientSignedAt: null },
        );
      });

      it('revocar firma AUTHOR con OTRA firma AUTHOR válida → recipientSignedAt al MAX(remaining)', async () => {
        const revokedSig = {
          id: sigId, tenantId, status: 'valid',
          documentType: 'evaluation_response', documentId,
          signedBy: fakeUuid(2), signatureRole: 'author',
        };
        const remainingSignedAt = new Date('2026-04-30T10:00:00Z');
        signatureRepo.findOne
          .mockResolvedValueOnce(revokedSig as any)
          .mockResolvedValueOnce({ id: 'other-sig', signedAt: remainingSignedAt } as any);
        signatureRepo.save.mockImplementation((s: any) => Promise.resolve(s));

        await service.revokeSignature(
          tenantId, userId, 'super_admin', sigId, validReason,
        );

        expect(responseRepo.update).toHaveBeenCalledWith(
          { id: documentId, tenantId },
          { authorSignedAt: remainingSignedAt },
        );
      });

      it('revocar firma EMPLOYER_WITNESS: pone witnessedAt a NULL', async () => {
        const revokedSig = {
          id: sigId, tenantId, status: 'valid',
          documentType: 'evaluation_response', documentId,
          signedBy: fakeUuid(2), signatureRole: 'employer_witness',
        };
        signatureRepo.findOne
          .mockResolvedValueOnce(revokedSig as any)
          .mockResolvedValueOnce(null);
        signatureRepo.save.mockImplementation((s: any) => Promise.resolve(s));

        await service.revokeSignature(
          tenantId, userId, 'super_admin', sigId, validReason,
        );

        expect(responseRepo.update).toHaveBeenCalledWith(
          { id: documentId, tenantId },
          { witnessedAt: null },
        );
      });

      it('revocar firma de documentType !== evaluation_response: NO toca responseRepo', async () => {
        const revokedSig = {
          id: sigId, tenantId, status: 'valid',
          documentType: 'evaluation_cycle', documentId,
          signedBy: fakeUuid(2), signatureRole: 'recipient',
        };
        signatureRepo.findOne.mockResolvedValueOnce(revokedSig as any);
        signatureRepo.save.mockImplementation((s: any) => Promise.resolve(s));

        await service.revokeSignature(
          tenantId, userId, 'super_admin', sigId, validReason,
        );

        expect(responseRepo.update).not.toHaveBeenCalled();
      });

      it('búsqueda de firmas remanentes filtra status=valid Y mismo signatureRole', async () => {
        const revokedSig = {
          id: sigId, tenantId, status: 'valid',
          documentType: 'evaluation_response', documentId,
          signedBy: fakeUuid(2), signatureRole: 'recipient',
        };
        signatureRepo.findOne
          .mockResolvedValueOnce(revokedSig as any)
          .mockResolvedValueOnce(null);
        signatureRepo.save.mockImplementation((s: any) => Promise.resolve(s));

        await service.revokeSignature(
          tenantId, userId, 'super_admin', sigId, validReason,
        );

        // La 2da llamada a findOne debe filtrar status=valid + signatureRole
        const secondCall = signatureRepo.findOne.mock.calls[1][0];
        expect(secondCall.where).toMatchObject({
          tenantId,
          documentType: 'evaluation_response',
          documentId,
          signatureRole: 'recipient',
          status: 'valid',
        });
        expect(secondCall.order).toEqual({ signedAt: 'DESC' });
      });

      it('fallo del update NO bloquea revocación (best-effort)', async () => {
        const revokedSig = {
          id: sigId, tenantId, status: 'valid',
          documentType: 'evaluation_response', documentId,
          signedBy: fakeUuid(2), signatureRole: 'recipient',
        };
        signatureRepo.findOne
          .mockResolvedValueOnce(revokedSig as any)
          .mockResolvedValueOnce(null);
        signatureRepo.save.mockImplementation((s: any) => Promise.resolve(s));
        responseRepo.update.mockRejectedValueOnce(new Error('DB temporarily down'));

        // No debe lanzar — la firma ya fue revocada
        await expect(
          service.revokeSignature(tenantId, userId, 'super_admin', sigId, validReason),
        ).resolves.toBeDefined();
      });
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
