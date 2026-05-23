/**
 * feature.guard.spec.ts — Contrato del gating de plan (T-05). Lo usan
 * surveys/org-development/promotions/reports (Grupo 2 Fase A) además de
 * los endpoints que ya lo tenían. La precedencia handler > class la
 * resuelve Nest (reflector.getAllAndOverride), no este guard.
 */
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureGuard } from './feature.guard';

describe('FeatureGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let subs: { findByTenantId: jest.Mock };
  let guard: FeatureGuard;

  const ctx = (user: any): any => ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  });

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    subs = { findByTenantId: jest.fn() };
    guard = new FeatureGuard(reflector as unknown as Reflector, subs as any);
  });

  it('sin @Feature → permite (no toca suscripción)', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(
      guard.canActivate(ctx({ tenantId: 't1' })),
    ).resolves.toBe(true);
    expect(subs.findByTenantId).not.toHaveBeenCalled();
  });

  it('@Feature presente + sin tenantId (super_admin directo) → Forbidden', async () => {
    reflector.getAllAndOverride.mockReturnValue('ENGAGEMENT_SURVEYS');
    await expect(
      guard.canActivate(ctx({ role: 'super_admin' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('@Feature presente + tenant sin suscripción → Forbidden', async () => {
    reflector.getAllAndOverride.mockReturnValue('ORG_DEVELOPMENT');
    subs.findByTenantId.mockResolvedValue(null);
    await expect(
      guard.canActivate(ctx({ tenantId: 't1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('@Feature presente + plan NO incluye la feature → Forbidden', async () => {
    reflector.getAllAndOverride.mockReturnValue('NINE_BOX');
    subs.findByTenantId.mockResolvedValue({
      plan: { name: 'Growth', features: ['ENGAGEMENT_SURVEYS', 'OKR'] },
    });
    await expect(
      guard.canActivate(ctx({ tenantId: 't1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('@Feature presente + plan incluye la feature → permite', async () => {
    reflector.getAllAndOverride.mockReturnValue('BASIC_REPORTS');
    subs.findByTenantId.mockResolvedValue({
      plan: { name: 'Starter', features: ['EVAL_90_180', 'BASIC_REPORTS'] },
    });
    await expect(
      guard.canActivate(ctx({ tenantId: 't1' })),
    ).resolves.toBe(true);
  });

  it('override de método (ADVANCED) gana sobre clase (BASIC): el guard usa el valor resuelto por Nest', async () => {
    // getAllAndOverride ya devuelve el valor resuelto (handler > class).
    reflector.getAllAndOverride.mockReturnValue('ADVANCED_REPORTS');
    subs.findByTenantId.mockResolvedValue({
      plan: { name: 'Starter', features: ['BASIC_REPORTS'] }, // no ADVANCED
    });
    await expect(
      guard.canActivate(ctx({ tenantId: 't1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
