/**
 * tenant-context.interceptor.spec.ts — Tests unitarios del interceptor
 * que setea `app.current_tenant_id` en la sesion de Postgres.
 *
 * F4 Fase A1 — Documenta el contrato del interceptor antes de
 * habilitar RLS:
 *   - super_admin → set var=''
 *   - tenantId UUID valido → set var=<uuid>
 *   - tenantId malformed → set var='' (fail-safe, no leak)
 *   - sin user → set var=''
 *   - set_config falla en DB → request sigue, no crash
 *   - finalize() siempre ejecuta el reset (success o error)
 *
 * Sin DI de NestJS — instanciamos la clase manualmente con mocks. Esto
 * evita los DI issues que causan los 26 tests fallidos preexistentes en
 * evaluations.service.spec / recognition.service.spec / etc.
 */
import { ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Observable, of, throwError } from 'rxjs';

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
  });

  /**
   * Drena el Observable retornado por intercept y espera a que
   * complete (incluyendo finalize). Devuelve el array de valores
   * emitidos.
   */
  async function drainObservable<T>(obs$: Observable<T>): Promise<T[]> {
    const values: T[] = [];
    return new Promise((resolve, reject) => {
      obs$.subscribe({
        next: (v) => values.push(v),
        error: reject,
        complete: () => {
          // Esperar un tick para que el reset async del finalize
          // termine antes de verificar las llamadas a query.
          setImmediate(() => resolve(values));
        },
      });
    });
  }

  describe('resolveTenantValue (via efecto observable en query)', () => {
    it('Caso 1: tenant_admin con tenantId UUID valido → setea el UUID', async () => {
      const tenantId = 'a1b2c3d4-e5f6-4a5b-9c8d-1234567890ab';
      const ctx = ctxWithRequest({
        user: { role: 'tenant_admin', tenantId, userId: 'user-1' },
      });

      const obs$ = await interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      await drainObservable(obs$);

      // Primera query: setea el tenant
      expect(mockDataSource.query).toHaveBeenCalledWith(
        `SELECT set_config('app.current_tenant_id', $1, false)`,
        [tenantId],
      );
      // Segunda query: reset on finalize
      expect(mockDataSource.query).toHaveBeenCalledWith(
        `SELECT set_config('app.current_tenant_id', '', false)`,
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

      const obs$ = await interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      await drainObservable(obs$);

      // Aunque el user TIENE tenantId, super_admin recibe '' como
      // marcador para que la policy haga bypass.
      expect(mockDataSource.query).toHaveBeenCalledWith(
        `SELECT set_config('app.current_tenant_id', $1, false)`,
        [''],
      );
    });

    it('Caso 3: request sin user (publico) → setea string vacio', async () => {
      const ctx = ctxWithRequest({}); // sin req.user

      const obs$ = await interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      await drainObservable(obs$);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        `SELECT set_config('app.current_tenant_id', $1, false)`,
        [''],
      );
    });

    it('Caso 4: tenantId malformed (no UUID) → fail-safe a string vacio', async () => {
      const ctx = ctxWithRequest({
        user: { role: 'tenant_admin', tenantId: 'not-a-uuid' },
      });

      const obs$ = await interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      await drainObservable(obs$);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        `SELECT set_config('app.current_tenant_id', $1, false)`,
        [''],
      );
    });

    it('Caso 4b: SQL injection attempt en tenantId → fail-safe', async () => {
      // Defense-in-depth: aunque set_config usa params y no
      // concatenacion, validamos que el valor que llega al $1 sea
      // siempre limpio (UUID o vacio, nunca una cadena custom).
      const ctx = ctxWithRequest({
        user: {
          role: 'tenant_admin',
          tenantId: "'; DROP TABLE users; --",
        },
      });

      const obs$ = await interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      await drainObservable(obs$);

      // El valor pasado al $1 debe ser '', NO la cadena maliciosa.
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

      const obs$ = await interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      const result = await drainObservable(obs$);

      // El controller corrio igual.
      expect(mockNext.handle).toHaveBeenCalled();
      expect(result).toEqual(['controller-result']);
    });

    it('Caso 6: finalize reset falla → response no rompe', async () => {
      // Primera query ok, segunda (reset on finalize) falla.
      mockDataSource.query
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('reset failed'));

      const ctx = ctxWithRequest({
        user: { role: 'tenant_admin', tenantId: 'a1b2c3d4-e5f6-4a5b-9c8d-1234567890ab' },
      });
      const obs$ = await interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      const result = await drainObservable(obs$);

      // El response llego al usuario sin error visible.
      expect(result).toEqual(['controller-result']);
    });

    it('finalize ejecuta tambien cuando el controller arroja error', async () => {
      mockNext.handle.mockReturnValueOnce(throwError(() => new Error('boom')));
      const ctx = ctxWithRequest({
        user: { role: 'tenant_admin', tenantId: 'a1b2c3d4-e5f6-4a5b-9c8d-1234567890ab' },
      });

      const obs$ = await interceptor.intercept(ctx, mockNext as unknown as CallHandler);

      // Drain con manejo de error
      await new Promise<void>((resolve) => {
        obs$.subscribe({
          next: () => {},
          error: () => {
            // Esperar tick para que el reset async corra
            setImmediate(resolve);
          },
        });
      });

      // Verificar que se llamo el reset incluso con error
      const resetCalls = mockDataSource.query.mock.calls.filter(
        ([sql]) => !sql.includes('$1'),
      );
      expect(resetCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Sentry integration', () => {
    beforeEach(() => {
      // El mockScope es compartido entre tests — limpiar entre cada uno
      // para que las assertions no vean llamadas de tests previos.
      mockScope.setUser.mockClear();
      mockScope.setTag.mockClear();
    });

    it('setea Sentry user/tags cuando hay user', async () => {
      const ctx = ctxWithRequest({
        user: {
          role: 'tenant_admin',
          tenantId: 'a1b2c3d4-e5f6-4a5b-9c8d-1234567890ab',
          userId: 'u-1',
        },
      });
      const obs$ = await interceptor.intercept(ctx, mockNext as unknown as CallHandler);
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
      const obs$ = await interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      await drainObservable(obs$);

      expect(mockScope.setUser).not.toHaveBeenCalled();
    });

    it('NO leakea email del user a Sentry (compliance GDPR)', async () => {
      const ctx = ctxWithRequest({
        user: {
          role: 'tenant_admin',
          tenantId: 'a1b2c3d4-e5f6-4a5b-9c8d-1234567890ab',
          userId: 'u-1',
          email: 'user@example.com', // NO debe llegar a Sentry
        },
      });
      const obs$ = await interceptor.intercept(ctx, mockNext as unknown as CallHandler);
      await drainObservable(obs$);

      const callArg = mockScope.setUser.mock.calls[0]?.[0];
      expect(callArg).toBeDefined();
      expect(callArg.email).toBeUndefined();
      expect(JSON.stringify(callArg)).not.toContain('user@example.com');
    });
  });
});
