/**
 * tenant-cron-runner.spec.ts — Tests unitarios del helper de F4 Fase A3.
 *
 * Verifica:
 *   - runForEachTenant itera solo tenants activos
 *   - Cada iteracion abre tx + setea app.current_tenant_id correcto
 *   - Errores per-tenant NO detienen el procesamiento del resto
 *   - runAsSystem ejecuta callback con tenant_id vacio
 *   - Tests sin BD — typeorm-transactional mockeado como pass-through.
 */
import { Logger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Tenant } from '../../modules/tenants/entities/tenant.entity';

// Mock typeorm-transactional como pass-through. La tx real se valida
// en E2E (Fase B). Aqui solo verificamos que runInTransaction se
// invoca y propaga el callback.
jest.mock('typeorm-transactional', () => ({
  runInTransaction: jest.fn(async (cb: () => Promise<unknown>) => cb()),
}));

import { TenantCronRunner } from './tenant-cron-runner';

describe('TenantCronRunner', () => {
  let runner: TenantCronRunner;
  let mockDataSource: { query: jest.Mock };
  let mockTenantRepo: { find: jest.Mock };

  beforeEach(() => {
    // Silenciar Logger del runner para no contaminar stdout en error
    // cases que probamos a proposito.
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    mockDataSource = {
      query: jest.fn().mockResolvedValue(undefined),
    };
    mockTenantRepo = {
      find: jest.fn(),
    };

    runner = new TenantCronRunner(
      mockDataSource as unknown as DataSource,
      mockTenantRepo as unknown as Repository<Tenant>,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('runForEachTenant', () => {
    it('itera solo tenants activos', async () => {
      mockTenantRepo.find.mockResolvedValue([
        { id: 'aaaaaaaa-1111-4111-8111-111111111111' },
        { id: 'bbbbbbbb-2222-4222-8222-222222222222' },
      ]);

      const callback = jest.fn().mockResolvedValue('ok');
      await runner.runForEachTenant('test', callback);

      expect(mockTenantRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        select: ['id'],
      });
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenNthCalledWith(
        1,
        'aaaaaaaa-1111-4111-8111-111111111111',
      );
      expect(callback).toHaveBeenNthCalledWith(
        2,
        'bbbbbbbb-2222-4222-8222-222222222222',
      );
    });

    it('setea app.current_tenant_id antes de cada callback', async () => {
      const tenantA = 'aaaaaaaa-1111-4111-8111-111111111111';
      const tenantB = 'bbbbbbbb-2222-4222-8222-222222222222';
      mockTenantRepo.find.mockResolvedValue([
        { id: tenantA },
        { id: tenantB },
      ]);

      const callOrder: Array<{ kind: 'set' | 'callback'; arg: string }> = [];
      mockDataSource.query.mockImplementation((_sql, args) => {
        callOrder.push({ kind: 'set', arg: args[0] });
        return Promise.resolve();
      });
      const callback = jest.fn(async (tid: string) => {
        callOrder.push({ kind: 'callback', arg: tid });
      });

      await runner.runForEachTenant('test', callback);

      // Orden esperado: set tenantA, callback tenantA, set tenantB, callback tenantB.
      expect(callOrder).toEqual([
        { kind: 'set', arg: tenantA },
        { kind: 'callback', arg: tenantA },
        { kind: 'set', arg: tenantB },
        { kind: 'callback', arg: tenantB },
      ]);
    });

    it('retorna array con resultados en orden de procesamiento', async () => {
      mockTenantRepo.find.mockResolvedValue([
        { id: 'aaaaaaaa-1111-4111-8111-111111111111' },
        { id: 'bbbbbbbb-2222-4222-8222-222222222222' },
      ]);

      const callback = jest
        .fn()
        .mockResolvedValueOnce('result-a')
        .mockResolvedValueOnce('result-b');
      const results = await runner.runForEachTenant('test', callback);

      expect(results).toEqual(['result-a', 'result-b']);
    });

    it('error en un tenant NO detiene los siguientes', async () => {
      mockTenantRepo.find.mockResolvedValue([
        { id: 'aaaaaaaa-1111-4111-8111-111111111111' },
        { id: 'bbbbbbbb-2222-4222-8222-222222222222' },
        { id: 'cccccccc-3333-4333-8333-333333333333' },
      ]);

      const callback = jest
        .fn()
        .mockResolvedValueOnce('ok-a')
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce('ok-c');
      const results = await runner.runForEachTenant('test', callback);

      // Tenant b falla, pero a y c se procesan.
      expect(callback).toHaveBeenCalledTimes(3);
      expect(results).toEqual(['ok-a', undefined, 'ok-c']);
    });

    it('lista vacia de tenants → callback nunca se llama', async () => {
      mockTenantRepo.find.mockResolvedValue([]);
      const callback = jest.fn();

      const results = await runner.runForEachTenant('test', callback);

      expect(callback).not.toHaveBeenCalled();
      expect(results).toEqual([]);
    });

    it('SQL de set_config usa parametrizacion (defense vs injection)', async () => {
      // Aunque el tenantId viene de la tabla tenants (no de input
      // externo), defense-in-depth: el helper SIEMPRE pasa el valor
      // como parametro $1, nunca concatenacion.
      mockTenantRepo.find.mockResolvedValue([
        { id: "'; DROP TABLE users; --" }, // hipotetico tenantId malo
      ]);

      const callback = jest.fn().mockResolvedValue('ok');
      await runner.runForEachTenant('test', callback);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        ["'; DROP TABLE users; --"],
      );
    });
  });

  describe('runAsSystem', () => {
    it('ejecuta callback con app.current_tenant_id vacio', async () => {
      const callback = jest.fn().mockResolvedValue('system-result');

      const result = await runner.runAsSystem('test', callback);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        [''],
      );
      expect(callback).toHaveBeenCalledTimes(1);
      expect(result).toBe('system-result');
    });

    it('NO consulta tabla tenants (es un cron global)', async () => {
      const callback = jest.fn().mockResolvedValue(null);

      await runner.runAsSystem('test', callback);

      expect(mockTenantRepo.find).not.toHaveBeenCalled();
    });

    it('error en callback se propaga (no se silencia)', async () => {
      // Diferencia con runForEachTenant: aqui NO hay otros tenants
      // que aislar — si el cron de sistema falla, debe fallar loud
      // para que se vea en monitoring.
      const callback = jest.fn().mockRejectedValue(new Error('system fail'));

      await expect(runner.runAsSystem('test', callback)).rejects.toThrow(
        'system fail',
      );
    });
  });
});
