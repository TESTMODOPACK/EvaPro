/**
 * tenant-context.interceptor.spec.ts — Tests unitarios del interceptor
 * que setea `app.current_tenant_id` en la transaccion de Postgres.
 *
 * F4 Fase A2 — typeorm-transactional wrappea cada request en una tx.
 * Los tests mockean runInTransaction como un pass-through (ejecuta el
 * callback sin abrir tx real) para no requerir BD.
 *
 * Sin DI de NestJS — instanciamos la clase manualmente con mocks.
 */
import { ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Observable, of, throwError } from 'rxjs';

// Mock del modulo typeorm-transactional — runInTransaction se reduce a
// "ejecuta el callback inmediatamente" para que los tests funcionen sin
// BD real. La tx-real se valida en E2E (Fase B).
jest.mock('typeorm-transactional', () => ({
  runInTransaction: jest.fn(async (cb: () => Promise<unknown>) => cb()),
}));

// Mock del modulo Sentry — sus exports son no-configurable properties
// asi que jest.spyOn() falla con "Cannot redefine property". Mock al
// nivel del modulo permite control total. setUser/setTag se reemplazan
// por scope en cada test.
const mockScope = {
  setUser: jest.fn(),
  setTag: jest.fn(),
};
jest.mock('@sentry/nestjs', () => ({
  getIsolationScope: jest.fn(() => mockScope),
}));

// Importar despues del mock para que el interceptor reciba el modulo
// mockeado.
import { TenantContextInterceptor } from './tenant-context.interceptor';

describe('TenantContextInterceptor', () => {
  let interceptor: TenantContextInterceptor;
  let mockDataSource: { query: jest.Mock };
  let mockNext: { handle: jest.Mock };

  /** Construye un ExecutionContext cuyo getRequest() retorna `req`. */
  const ctxWithRequest = (req: any): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
    } as ExecutionContext);

  beforeEach(() => {
    // Silenciar Logger del interceptor para no llenar stdout en los
    // casos de error que probamos a proposito.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    mockDataSource = {
      query: jest.fn().mockResolvedValue(undefined),
    };
    mockNext = {
      handle: jest.fn().mockReturnValue(of('controller-result')),
    };
    interceptor = new TenantContextInterceptor(mockDataSource as unknown as DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockScope.setUser.mockClear();
    mockScope.setTag.mockClear();
  });

  /**
   * Drena el Observable retornado por intercept y devuelve la promesa
   * del primer valor emitido (o lanza el error).
   */
  async function drainObservable<T>(obs$: Observable<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      obs$.subscribe({
        next: resolve,
        error: reject,
      });
    });
  }

  describe('resolveTenantValue (via efecto observable en query)', () => {
    it('Caso 1: tenant_admin con tenantId UUID valido → setea el UUID', async () => {
      const tenantId = 'a1b2c3d4-e5f6-4a5b-9c8d-1234567890ab';
      const ctx = ctxWithRequest({
        user: { role: 'tenant_admin', tenantId, userId: 'user-1' },
      });

      const obs$ = interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      const result = await drainObservable(obs$);

      expect(result).toBe('controller-result');
      expect(mockDataSource.query).toHaveBeenCalledWith(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        [tenantId],
      );
    });

    it('Caso 2: super_admin → setea string vacio (bypass marker)', async () => {
      const ctx = ctxWithRequest({
        user: {
          role: 'super_admin',
          tenantId: 'a1b2c3d4-e5f6-4a5b-9c8d-1234567890ab',
          userId: 'sa-1',
        },
      });

      const obs$ = interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      await drainObservable(obs$);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        [''],
      );
    });

    it('Caso 3: request sin user (publico) → setea string vacio', async () => {
      const ctx = ctxWithRequest({});

      const obs$ = interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      await drainObservable(obs$);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        [''],
      );
    });

    it('Caso 4: tenantId malformed (no UUID) → fail-safe a string vacio', async () => {
      const ctx = ctxWithRequest({
        user: { role: 'tenant_admin', tenantId: 'not-a-uuid' },
      });

      const obs$ = interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      await drainObservable(obs$);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        [''],
      );
    });

    it('Caso 4b: SQL injection attempt en tenantId → fail-safe', async () => {
      const ctx = ctxWithRequest({
        user: {
          role: 'tenant_admin',
          tenantId: "'; DROP TABLE users; --",
        },
      });

      const obs$ = interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      await drainObservable(obs$);

      const setQueries = mockDataSource.query.mock.calls.filter(
        ([sql]) => sql.includes("'app.current_tenant_id', $1"),
      );
      expect(setQueries).toHaveLength(1);
      expect(setQueries[0][1]).toEqual(['']);
    });
  });

  describe('error handling', () => {
    it('Caso 5: set_config falla en DB → request sigue, no crash', async () => {
      mockDataSource.query.mockImplementationOnce(() =>
        Promise.reject(new Error('DB connection lost')),
      );
      const ctx = ctxWithRequest({
        user: { role: 'tenant_admin', tenantId: 'a1b2c3d4-e5f6-4a5b-9c8d-1234567890ab' },
      });

      const obs$ = interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      const result = await drainObservable(obs$);

      // El controller corrio igual.
      expect(mockNext.handle).toHaveBeenCalled();
      expect(result).toBe('controller-result');
    });

    it('Si el controller arroja error, el error se propaga', async () => {
      mockNext.handle.mockReturnValueOnce(throwError(() => new Error('boom')));
      const ctx = ctxWithRequest({
        user: { role: 'tenant_admin', tenantId: 'a1b2c3d4-e5f6-4a5b-9c8d-1234567890ab' },
      });

      const obs$ = interceptor.intercept(ctx, mockNext as unknown as CallHandler);

      await expect(drainObservable(obs$)).rejects.toThrow('boom');
      // Verifica que set_config se intento llamar antes de la falla.
      expect(mockDataSource.query).toHaveBeenCalled();
    });
  });

  describe('Sentry integration', () => {
    it('setea Sentry user/tags cuando hay user', async () => {
      const ctx = ctxWithRequest({
        user: {
          role: 'tenant_admin',
          tenantId: 'a1b2c3d4-e5f6-4a5b-9c8d-1234567890ab',
          userId: 'u-1',
        },
      });
      const obs$ = interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      await drainObservable(obs$);

      expect(mockScope.setUser).toHaveBeenCalledWith({
        id: 'u-1',
        username: 'tenant_admin',
      });
      expect(mockScope.setTag).toHaveBeenCalledWith(
        'tenantId',
        'a1b2c3d4-e5f6-4a5b-9c8d-1234567890ab',
      );
      expect(mockScope.setTag).toHaveBeenCalledWith('role', 'tenant_admin');
    });

    it('NO setea Sentry user cuando no hay user (request publico)', async () => {
      const ctx = ctxWithRequest({});
      const obs$ = interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      await drainObservable(obs$);

      expect(mockScope.setUser).not.toHaveBeenCalled();
    });

    it('NO leakea email del user a Sentry (compliance GDPR)', async () => {
      const ctx = ctxWithRequest({
        user: {
          role: 'tenant_admin',
          tenantId: 'a1b2c3d4-e5f6-4a5b-9c8d-1234567890ab',
          userId: 'u-1',
          email: 'user@example.com',
        },
      });
      const obs$ = interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      await drainObservable(obs$);

      const callArg = mockScope.setUser.mock.calls[0]?.[0];
      expect(callArg).toBeDefined();
      expect(callArg.email).toBeUndefined();
      expect(JSON.stringify(callArg)).not.toContain('user@example.com');
    });
  });
});
