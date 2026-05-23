/**
 * talent.service.spec.ts — Aislación cross-tenant de calibración
 * (B3-36/37/38, Grupo 1 Fase 4).
 *
 * CalibrationEntry no tiene tenant_id: el tenant autoritativo vive en la
 * sesión padre. Estos tests fijan que updateEntry / approveCalibration
 * Change / getDistributionAnalysis rechazan accesos cross-tenant
 * (NotFoundException, sin leak de existencia) y que super_admin
 * (tenantId undefined) sigue siendo cross-tenant.
 */
import { NotFoundException } from '@nestjs/common';
import { TalentService } from './talent.service';

describe('TalentService — aislación cross-tenant calibración', () => {
  const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const ENTRY_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const SESSION_ID = 'ssssssss-ssss-ssss-ssss-ssssssssssss';

  let entryRepo: any;
  let sessionRepo: any;
  let auditService: any;
  let service: TalentService;

  const makeEntry = (overrides: any = {}) => ({
    id: ENTRY_ID,
    sessionId: SESSION_ID,
    originalScore: 3,
    adjustedScore: null,
    originalPotential: null,
    adjustedPotential: null,
    changeLog: [],
    status: 'pending',
    approvalStatus: 'pending_approval',
    session: { id: SESSION_ID, tenantId: TENANT_B },
    ...overrides,
  });

  beforeEach(() => {
    entryRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
    };
    sessionRepo = { findOne: jest.fn() };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    service = new TalentService(
      {} as any, // assessmentRepo
      sessionRepo as any,
      entryRepo as any,
      {} as any, // assignmentRepo
      {} as any, // responseRepo
      {} as any, // userRepo
      {} as any, // departmentRepo
      {} as any, // cycleRepo
      auditService as any,
    );
  });

  describe('updateEntry (B3-36)', () => {
    it('tenant distinto al de la sesión → NotFoundException (no leak)', async () => {
      entryRepo.findOne.mockResolvedValue(makeEntry());
      await expect(
        service.updateEntry(ENTRY_ID, {}, 'user-a', TENANT_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(entryRepo.save).not.toHaveBeenCalled();
    });

    it('tenant correcto → procede', async () => {
      entryRepo.findOne.mockResolvedValue(
        makeEntry({ session: { id: SESSION_ID, tenantId: TENANT_A } }),
      );
      const res = await service.updateEntry(ENTRY_ID, {}, 'user-a', TENANT_A);
      expect(res).toBeDefined();
      expect(entryRepo.save).toHaveBeenCalled();
    });

    it('super_admin (tenantId undefined) → cross-tenant permitido', async () => {
      entryRepo.findOne.mockResolvedValue(makeEntry());
      const res = await service.updateEntry(ENTRY_ID, {}, 'sa', undefined);
      expect(res).toBeDefined();
      expect(entryRepo.save).toHaveBeenCalled();
    });

    it('carga la entry CON la relación session', async () => {
      entryRepo.findOne.mockResolvedValue(
        makeEntry({ session: { id: SESSION_ID, tenantId: TENANT_A } }),
      );
      await service.updateEntry(ENTRY_ID, {}, 'user-a', TENANT_A);
      expect(entryRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ relations: ['session'] }),
      );
    });
  });

  describe('approveCalibrationChange (B3-37)', () => {
    it('tenant distinto → NotFoundException', async () => {
      entryRepo.findOne.mockResolvedValue(makeEntry());
      await expect(
        service.approveCalibrationChange(ENTRY_ID, 'admin-a', true, TENANT_A),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('tenant correcto → aprueba', async () => {
      entryRepo.findOne.mockResolvedValue(
        makeEntry({ session: { id: SESSION_ID, tenantId: TENANT_A } }),
      );
      const res = await service.approveCalibrationChange(
        ENTRY_ID, 'admin-a', true, TENANT_A,
      );
      expect(res.approvalStatus).toBe('approved');
    });
  });

  describe('getDistributionAnalysis (B3-38)', () => {
    it('sesión de otro tenant → NotFoundException', async () => {
      // sessionRepo filtra por { id, tenantId }: cross-tenant no matchea.
      sessionRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getDistributionAnalysis(SESSION_ID, TENANT_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(sessionRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: SESSION_ID, tenantId: TENANT_A }),
        }),
      );
    });
  });
});
