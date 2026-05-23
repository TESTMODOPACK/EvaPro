/**
 * validate-manager-scope.spec.ts — Contrato del primitive de autorización
 * por ownership/team-scope. Lo usan B3-01/14/15/26 (evaluations,
 * objectives, development) además de update/approve/bulkApprove
 * preexistentes, así que aquí se fija la regla una sola vez.
 */
import { ForbiddenException } from '@nestjs/common';
import {
  assertManagerCanAccessUser,
  assertManagerOwnsResource,
} from './validate-manager-scope';

describe('assertManagerCanAccessUser', () => {
  const TENANT = 'tenant-1';
  const CALLER = 'caller-1';
  const TARGET = 'target-1';

  const repoReturning = (managerId: string | null) => ({
    findOne: jest.fn().mockResolvedValue({ id: TARGET, managerId }),
  });
  const repoMissing = () => ({ findOne: jest.fn().mockResolvedValue(null) });

  it('super_admin pasa sin tocar la BD', async () => {
    const repo = repoMissing();
    await expect(
      assertManagerCanAccessUser(repo as any, CALLER, 'super_admin', TARGET, TENANT),
    ).resolves.toBeUndefined();
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('tenant_admin pasa sin tocar la BD', async () => {
    const repo = repoMissing();
    await expect(
      assertManagerCanAccessUser(repo as any, CALLER, 'tenant_admin', TARGET, TENANT),
    ).resolves.toBeUndefined();
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('self-access: cualquier rol accede a su propia data', async () => {
    const repo = repoMissing();
    await expect(
      assertManagerCanAccessUser(repo as any, CALLER, 'employee', CALLER, TENANT),
    ).resolves.toBeUndefined();
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('employee NO puede acceder a otro usuario (IDOR cerrado)', async () => {
    await expect(
      assertManagerCanAccessUser(repoMissing() as any, CALLER, 'employee', TARGET, TENANT),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('external NO puede acceder a otro usuario', async () => {
    await expect(
      assertManagerCanAccessUser(repoMissing() as any, CALLER, 'external', TARGET, TENANT),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('manager accede SOLO a su reporte directo', async () => {
    await expect(
      assertManagerCanAccessUser(
        repoReturning(CALLER) as any, // target.managerId === caller
        CALLER, 'manager', TARGET, TENANT,
      ),
    ).resolves.toBeUndefined();
  });

  it('manager NO accede a usuario fuera de su equipo', async () => {
    await expect(
      assertManagerCanAccessUser(
        repoReturning('otro-mgr') as any,
        CALLER, 'manager', TARGET, TENANT,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('manager: target inexistente en el tenant → Forbidden (sin leak de existencia)', async () => {
    await expect(
      assertManagerCanAccessUser(repoMissing() as any, CALLER, 'manager', TARGET, TENANT),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rol desconocido → deny by default', async () => {
    await expect(
      assertManagerCanAccessUser(repoMissing() as any, CALLER, '', TARGET, TENANT),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('assertManagerOwnsResource', () => {
  it('admin y self pasan; manager solo si es su reporte; resto Forbidden', () => {
    expect(() => assertManagerOwnsResource('c', 'super_admin', 'o', null)).not.toThrow();
    expect(() => assertManagerOwnsResource('c', 'tenant_admin', 'o', null)).not.toThrow();
    expect(() => assertManagerOwnsResource('c', 'employee', 'c', null)).not.toThrow();
    expect(() => assertManagerOwnsResource('c', 'manager', 'o', 'c')).not.toThrow();
    expect(() => assertManagerOwnsResource('c', 'manager', 'o', 'other')).toThrow(
      ForbiddenException,
    );
    expect(() => assertManagerOwnsResource('c', 'employee', 'o', null)).toThrow(
      ForbiddenException,
    );
  });
});
