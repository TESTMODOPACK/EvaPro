/**
 * signatures.controller.spec.ts — Tests del SignaturesController.
 *
 * TAREA 2 / G7 (audit baseline). Cubre:
 *  - Cada endpoint propaga tenantId, userId y role del JWT al service
 *  - getClientIp se usa para signerIp (no header directo)
 *  - Verificación de los @Roles() decorators (especialmente que external
 *    NO esté autorizado en ningún endpoint de firmas)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { SignaturesController } from './signatures.controller';
import { SignaturesService } from './signatures.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { fakeUuid } from '../../../test/test-utils';

describe('SignaturesController', () => {
  let controller: SignaturesController;
  let service: any;
  const reflector = new Reflector();

  const tenantId = fakeUuid(100);
  const userId = fakeUuid(1);
  const documentId = fakeUuid(50);

  beforeEach(async () => {
    service = {
      requestSignature: jest.fn().mockResolvedValue({ message: 'ok', expiryMinutes: 10 }),
      verifyAndSign: jest.fn().mockResolvedValue({ id: 'sig-1' }),
      getSignaturesByUser: jest.fn().mockResolvedValue([]),
      getSignaturesByTeam: jest.fn().mockResolvedValue([]),
      verifyIntegrity: jest.fn().mockResolvedValue({ integrity: 'valid' }),
      getSignatures: jest.fn().mockResolvedValue([]),
      getSignaturesByTenant: jest.fn().mockResolvedValue([]),
      revokeSignature: jest.fn().mockResolvedValue({ id: 'sig-1', status: 'revoked' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SignaturesController],
      providers: [{ provide: SignaturesService, useValue: service }],
    }).compile();

    controller = module.get<SignaturesController>(SignaturesController);
  });

  // ─── Propagación de role del JWT al service (G1) ────────────────────

  describe('requestSignature', () => {
    it('propaga tenantId, userId y role del JWT', async () => {
      const req: any = { user: { tenantId, userId, role: 'manager' } };
      await controller.requestSignature(req, { documentType: 'evaluation_response', documentId });
      expect(service.requestSignature).toHaveBeenCalledWith(
        tenantId, userId, 'manager', 'evaluation_response', documentId,
      );
    });
  });

  describe('verifyAndSign', () => {
    it('propaga role del JWT y obtiene IP via getClientIp', async () => {
      const req: any = {
        user: { tenantId, userId, role: 'employee' },
        ip: '192.168.1.50',
        headers: {},
        socket: { remoteAddress: '192.168.1.50' },
      };
      await controller.verifyAndSign(req, {
        documentType: 'evaluation_response',
        documentId,
        code: '123456',
      });
      // 8 args: tenantId, userId, role, docType, docId, code, ip, ackOptions?
      expect(service.verifyAndSign).toHaveBeenCalledWith(
        tenantId, userId, 'employee', 'evaluation_response', documentId, '123456',
        expect.any(String),
        undefined, // sin acknowledgment → default 'agree' en el service
      );
      const ipArg = service.verifyAndSign.mock.calls[0][6];
      expect(ipArg).toBeTruthy();
    });

    it('propaga acknowledgmentType + comment cuando se envían (G5)', async () => {
      const req: any = {
        user: { tenantId, userId, role: 'employee' },
        ip: '192.168.1.50', headers: {}, socket: { remoteAddress: '192.168.1.50' },
      };
      await controller.verifyAndSign(req, {
        documentType: 'evaluation_response',
        documentId, code: '123456',
        acknowledgmentType: 'decline',
        acknowledgmentComment: 'No estoy de acuerdo con la calificación',
      });
      const call = service.verifyAndSign.mock.calls[0];
      expect(call[7]).toEqual({
        type: 'decline',
        comment: 'No estoy de acuerdo con la calificación',
      });
    });
  });

  describe('listMine', () => {
    it('llama getSignaturesByUser con tenantId y userId del JWT', async () => {
      const req: any = { user: { tenantId, userId, role: 'employee' } };
      await controller.listMine(req);
      expect(service.getSignaturesByUser).toHaveBeenCalledWith(tenantId, userId);
    });
  });

  describe('listTeam', () => {
    it('manager: pasa su userId como managerId', async () => {
      const req: any = { user: { tenantId, userId, role: 'manager' } };
      await controller.listTeam(req);
      expect(service.getSignaturesByTeam).toHaveBeenCalledWith(tenantId, userId);
    });

    it('tenant_admin: pasa managerId=undefined (ve todo el tenant)', async () => {
      const req: any = { user: { tenantId, userId, role: 'tenant_admin' } };
      await controller.listTeam(req);
      expect(service.getSignaturesByTeam).toHaveBeenCalledWith(tenantId, undefined);
    });

    it('super_admin: pasa managerId=undefined', async () => {
      const req: any = { user: { tenantId, userId, role: 'super_admin' } };
      await controller.listTeam(req);
      expect(service.getSignaturesByTeam).toHaveBeenCalledWith(tenantId, undefined);
    });
  });

  describe('verifyIntegrity', () => {
    it('llama service.verifyIntegrity con tenantId del JWT y signatureId', async () => {
      const req: any = { user: { tenantId, userId, role: 'manager' } };
      await controller.verifyIntegrity('sig-uuid', req);
      expect(service.verifyIntegrity).toHaveBeenCalledWith(tenantId, 'sig-uuid');
    });
  });

  describe('getSignatures', () => {
    it('llama service.getSignatures con tenantId del JWT', async () => {
      const req: any = { user: { tenantId, userId, role: 'employee' } };
      await controller.getSignatures('evaluation_response', documentId, req);
      expect(service.getSignatures).toHaveBeenCalledWith(tenantId, 'evaluation_response', documentId);
    });
  });

  describe('listAll', () => {
    it('llama service.getSignaturesByTenant', async () => {
      const req: any = { user: { tenantId, userId, role: 'tenant_admin' } };
      await controller.listAll(req);
      expect(service.getSignaturesByTenant).toHaveBeenCalledWith(tenantId);
    });
  });

  // ─── Verificación de @Roles() metadata (defensa de RolesGuard) ──────

  describe('@Roles() metadata', () => {
    function rolesOf(method: keyof SignaturesController): string[] {
      return reflector.get<string[]>(ROLES_KEY, controller[method]) || [];
    }

    it('requestSignature permite super_admin/tenant_admin/manager/employee/external (G4)', () => {
      const roles = rolesOf('requestSignature');
      expect(roles).toEqual(expect.arrayContaining([
        'super_admin', 'tenant_admin', 'manager', 'employee', 'external',
      ]));
    });

    it('verifyAndSign permite super_admin/tenant_admin/manager/employee/external (G4)', () => {
      const roles = rolesOf('verifyAndSign');
      expect(roles).toEqual(expect.arrayContaining([
        'super_admin', 'tenant_admin', 'manager', 'employee', 'external',
      ]));
    });

    it('listMine permite super_admin/tenant_admin/manager/employee/external (G4)', () => {
      const roles = rolesOf('listMine');
      expect(roles).toContain('external');
    });

    it('listTeam exige super_admin/tenant_admin/manager (NO employee, NO external)', () => {
      const roles = rolesOf('listTeam');
      expect(roles).toEqual(expect.arrayContaining(['super_admin', 'tenant_admin', 'manager']));
      expect(roles).not.toContain('employee');
      expect(roles).not.toContain('external');
    });

    it('verifyIntegrity solo super_admin/tenant_admin/manager (NO employee, NO external)', () => {
      const roles = rolesOf('verifyIntegrity');
      expect(roles).toEqual(expect.arrayContaining(['super_admin', 'tenant_admin', 'manager']));
      expect(roles).not.toContain('employee');
      expect(roles).not.toContain('external');
    });

    it('listAll solo super_admin/tenant_admin (NO manager, NO employee, NO external)', () => {
      const roles = rolesOf('listAll');
      expect(roles).toEqual(expect.arrayContaining(['super_admin', 'tenant_admin']));
      expect(roles).not.toContain('manager');
      expect(roles).not.toContain('employee');
      expect(roles).not.toContain('external');
    });

    it('revokeSignature SOLO super_admin (G8)', () => {
      const roles = rolesOf('revokeSignature');
      expect(roles).toEqual(['super_admin']);
    });
  });

  describe('revokeSignature (G8)', () => {
    it('propaga tenantId, userId, role, signatureId, reason e IP', async () => {
      const req: any = {
        user: { tenantId, userId, role: 'super_admin' },
        ip: '10.0.0.1', headers: {}, socket: { remoteAddress: '10.0.0.1' },
      };
      await controller.revokeSignature(
        'sig-uuid', { reason: 'Razón válida con suficiente longitud' }, req,
      );
      expect(service.revokeSignature).toHaveBeenCalledWith(
        tenantId, userId, 'super_admin', 'sig-uuid',
        'Razón válida con suficiente longitud',
        expect.any(String),
      );
    });
  });
});
