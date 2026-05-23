/**
 * roles.guard.spec.ts — Tests del guard de autorización por rol.
 *
 * Foco: la comparación debe ser de IGUALDAD ESTRICTA, no substring.
 * El test "no escala por substring" es la regresión del hallazgo T-01.
 */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let auditService: { logFailure: jest.Mock };

  const ctxWithUser = (user: any): ExecutionContext =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          method: 'GET',
          url: '/x',
          route: { path: '/x' },
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    auditService = { logFailure: jest.fn().mockResolvedValue(undefined) };
    guard = new RolesGuard(
      reflector as unknown as Reflector,
      auditService as any,
    );
  });

  it('permite cuando no hay @Roles (endpoint sin restricción)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(ctxWithUser({ role: 'employee' }))).toBe(true);
  });

  it('permite con rol exacto', () => {
    reflector.getAllAndOverride.mockReturnValue(['tenant_admin']);
    expect(
      guard.canActivate(ctxWithUser({ role: 'tenant_admin', userId: 'u1' })),
    ).toBe(true);
  });

  it('permite si el rol está entre los requeridos', () => {
    reflector.getAllAndOverride.mockReturnValue(['super_admin', 'manager']);
    expect(
      guard.canActivate(ctxWithUser({ role: 'manager', userId: 'u1' })),
    ).toBe(true);
  });

  it('REGRESIÓN T-01: no escala por substring (rol contiene al requerido)', () => {
    // Con `.includes`, @Roles('admin') habría dejado pasar a
    // 'super_admin'/'tenant_admin'. Con igualdad estricta: denegado.
    reflector.getAllAndOverride.mockReturnValue(['admin']);
    expect(
      guard.canActivate(ctxWithUser({ role: 'super_admin', userId: 'u1' })),
    ).toBe(false);
    expect(
      guard.canActivate(ctxWithUser({ role: 'tenant_admin', userId: 'u1' })),
    ).toBe(false);
  });

  it('REGRESIÓN T-01: requerido que contiene al rol del user tampoco pasa', () => {
    reflector.getAllAndOverride.mockReturnValue(['tenant_admin']);
    expect(
      guard.canActivate(ctxWithUser({ role: 'admin', userId: 'u1' })),
    ).toBe(false);
  });

  it('deniega y registra access.denied cuando el rol no corresponde', () => {
    reflector.getAllAndOverride.mockReturnValue(['super_admin']);
    expect(
      guard.canActivate(ctxWithUser({ role: 'employee', userId: 'u1' })),
    ).toBe(false);
    expect(auditService.logFailure).toHaveBeenCalledWith(
      'access.denied',
      expect.objectContaining({
        metadata: expect.objectContaining({
          requiredRoles: ['super_admin'],
          actualRole: 'employee',
        }),
      }),
    );
  });

  it('deniega cuando no hay user (sin role)', () => {
    reflector.getAllAndOverride.mockReturnValue(['employee']);
    expect(guard.canActivate(ctxWithUser(undefined))).toBe(false);
  });
});
