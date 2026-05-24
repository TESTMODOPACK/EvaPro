/**
 * safe-json.interceptor.spec.ts — Tests del interceptor que sirve como
 * última línea de defensa contra `TypeError: Converting circular
 * structure to JSON`.
 *
 * Cubre:
 *   1. Body sin ciclo → pasa intacto (sin overhead apreciable).
 *   2. Body con ciclo → sanitiza '[Circular]' + audit fire-and-forget.
 *   3. Primitivos / null / undefined → pasan intactos.
 *   4. Buffer → pasa intacto (downloads binarios).
 *   5. Stream (objeto con .pipe) → pasa intacto (Express los entuba).
 *   6. AuditService no provisto → no crash (es @Optional).
 *   7. AuditService.logFailure rechaza → no crash (fire-and-forget).
 *   8. Forensic metadata: method + path + role + kind correctos.
 */
import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { SafeJsonInterceptor } from './safe-json.interceptor';

describe('SafeJsonInterceptor', () => {
  let interceptor: SafeJsonInterceptor;
  let mockAudit: { logFailure: jest.Mock };
  let mockNext: { handle: jest.Mock };

  const ctxWithRequest = (req: any): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
    } as ExecutionContext);

  beforeEach(() => {
    // Silenciar warn del interceptor en casos que probamos a propósito.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    mockAudit = {
      logFailure: jest.fn().mockResolvedValue(undefined),
    };
    mockNext = {
      handle: jest.fn(),
    };
    interceptor = new SafeJsonInterceptor(mockAudit as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  async function drainObservable<T>(obs$: Observable<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      obs$.subscribe({ next: resolve, error: reject });
    });
  }

  describe('passthrough (sin ciclo)', () => {
    it('Body plain object → pasa intacto', async () => {
      const body = { id: 1, name: 'Alice', items: [{ id: 2 }] };
      mockNext.handle.mockReturnValueOnce(of(body));

      const result = await drainObservable(
        interceptor.intercept(ctxWithRequest({}), mockNext as unknown as CallHandler),
      );

      expect(result).toBe(body); // misma referencia, no clone
      expect(mockAudit.logFailure).not.toHaveBeenCalled();
    });

    it('Body array → pasa intacto', async () => {
      const body = [{ id: 1 }, { id: 2 }];
      mockNext.handle.mockReturnValueOnce(of(body));

      const result = await drainObservable(
        interceptor.intercept(ctxWithRequest({}), mockNext as unknown as CallHandler),
      );

      expect(result).toBe(body);
      expect(mockAudit.logFailure).not.toHaveBeenCalled();
    });

    it('Body null → pasa intacto', async () => {
      mockNext.handle.mockReturnValueOnce(of(null));

      const result = await drainObservable(
        interceptor.intercept(ctxWithRequest({}), mockNext as unknown as CallHandler),
      );

      expect(result).toBeNull();
      expect(mockAudit.logFailure).not.toHaveBeenCalled();
    });

    it('Body undefined → pasa intacto', async () => {
      mockNext.handle.mockReturnValueOnce(of(undefined));

      const result = await drainObservable(
        interceptor.intercept(ctxWithRequest({}), mockNext as unknown as CallHandler),
      );

      expect(result).toBeUndefined();
      expect(mockAudit.logFailure).not.toHaveBeenCalled();
    });

    it('Body string primitivo → pasa intacto', async () => {
      mockNext.handle.mockReturnValueOnce(of('hello'));

      const result = await drainObservable(
        interceptor.intercept(ctxWithRequest({}), mockNext as unknown as CallHandler),
      );

      expect(result).toBe('hello');
      expect(mockAudit.logFailure).not.toHaveBeenCalled();
    });

    it('Body number primitivo → pasa intacto', async () => {
      mockNext.handle.mockReturnValueOnce(of(42));

      const result = await drainObservable(
        interceptor.intercept(ctxWithRequest({}), mockNext as unknown as CallHandler),
      );

      expect(result).toBe(42);
      expect(mockAudit.logFailure).not.toHaveBeenCalled();
    });

    it('Buffer → pasa intacto (NO stringify, downloads binarios)', async () => {
      const buf = Buffer.from('binary content');
      mockNext.handle.mockReturnValueOnce(of(buf));

      const result = await drainObservable(
        interceptor.intercept(ctxWithRequest({}), mockNext as unknown as CallHandler),
      );

      expect(result).toBe(buf);
      expect(mockAudit.logFailure).not.toHaveBeenCalled();
    });

    it('Stream-like (con .pipe) → pasa intacto', async () => {
      const stream = { pipe: jest.fn(), data: 'whatever' };
      mockNext.handle.mockReturnValueOnce(of(stream));

      const result = await drainObservable(
        interceptor.intercept(ctxWithRequest({}), mockNext as unknown as CallHandler),
      );

      expect(result).toBe(stream);
      expect(mockAudit.logFailure).not.toHaveBeenCalled();
    });
  });

  describe('detección y sanitización de ciclos', () => {
    it('Body con ciclo → sanitiza con [Circular] y devuelve respuesta degradada', async () => {
      // Construye un ciclo: a.child = b; b.parent = a
      const a: any = { name: 'a' };
      const b: any = { name: 'b', parent: a };
      a.child = b;
      mockNext.handle.mockReturnValueOnce(of(a));

      const result: any = await drainObservable(
        interceptor.intercept(
          ctxWithRequest({
            method: 'GET',
            url: '/api/test',
            user: { role: 'tenant_admin', tenantId: 't-1', userId: 'u-1' },
          }),
          mockNext as unknown as CallHandler,
        ),
      );

      // La respuesta llegó (no 500), pero con el ciclo reemplazado.
      expect(result).toBeDefined();
      expect(result.name).toBe('a');
      expect(result.child.name).toBe('b');
      // El back-ref hacia `a` quedó como '[Circular]'.
      expect(result.child.parent).toBe('[Circular]');
      // Confirma que es JSON-stringifiable ahora.
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('Ciclo → dispara audit logFailure con metadata forense', async () => {
      const a: any = { name: 'cyc' };
      a.self = a;
      mockNext.handle.mockReturnValueOnce(of(a));

      const req = {
        method: 'GET',
        originalUrl: '/api/reports/foo',
        route: { path: '/api/reports/foo' },
        ip: '10.0.0.1',
        user: { role: 'super_admin', tenantId: null, userId: 'sa-1' },
      };

      await drainObservable(
        interceptor.intercept(ctxWithRequest(req), mockNext as unknown as CallHandler),
      );

      expect(mockAudit.logFailure).toHaveBeenCalledTimes(1);
      const [action, payload] = mockAudit.logFailure.mock.calls[0];
      expect(action).toBe('system.error');
      expect(payload.tenantId).toBeNull(); // super_admin
      expect(payload.userId).toBe('sa-1');
      expect(payload.entityType).toBe('Endpoint');
      expect(payload.entityId).toBe('GET /api/reports/foo');
      expect(payload.metadata.kind).toBe('circular_response_body');
      expect(payload.metadata.method).toBe('GET');
      expect(payload.metadata.path).toBe('/api/reports/foo');
      expect(payload.metadata.userRole).toBe('super_admin');
      expect(payload.ipAddress).toBe('10.0.0.1');
      expect(payload.error).toBeInstanceOf(Error);
    });

    it('Ciclo + tenant_admin → audit scopeado al tenant del usuario', async () => {
      const a: any = {};
      a.x = a;
      mockNext.handle.mockReturnValueOnce(of(a));

      await drainObservable(
        interceptor.intercept(
          ctxWithRequest({
            method: 'POST',
            url: '/api/evaluations',
            user: { role: 'tenant_admin', tenantId: 't-42', userId: 'u-9' },
          }),
          mockNext as unknown as CallHandler,
        ),
      );

      const [, payload] = mockAudit.logFailure.mock.calls[0];
      expect(payload.tenantId).toBe('t-42');
    });

    it('Ciclo sin user (publico) → audit con tenantId/userId null', async () => {
      const a: any = {};
      a.x = a;
      mockNext.handle.mockReturnValueOnce(of(a));

      await drainObservable(
        interceptor.intercept(
          ctxWithRequest({ method: 'GET', url: '/public' }),
          mockNext as unknown as CallHandler,
        ),
      );

      const [, payload] = mockAudit.logFailure.mock.calls[0];
      expect(payload.tenantId).toBeNull();
      expect(payload.userId).toBeNull();
      expect(payload.metadata.userRole).toBeUndefined();
    });
  });

  describe('resiliencia', () => {
    it('AuditService no provisto → no crash en ciclo', async () => {
      const noAuditInterceptor = new SafeJsonInterceptor(undefined);
      const a: any = {};
      a.x = a;
      mockNext.handle.mockReturnValueOnce(of(a));

      const result = await drainObservable(
        noAuditInterceptor.intercept(
          ctxWithRequest({ method: 'GET', url: '/x' }),
          mockNext as unknown as CallHandler,
        ),
      );

      // Sanitizó igualmente y devolvió respuesta sin 500.
      expect(result).toBeDefined();
      expect((result as any).x).toBe('[Circular]');
    });

    it('AuditService.logFailure rechaza → no se propaga el error (fire-and-forget)', async () => {
      mockAudit.logFailure.mockReturnValueOnce(
        Promise.reject(new Error('DB down')),
      );
      const a: any = {};
      a.x = a;
      mockNext.handle.mockReturnValueOnce(of(a));

      // No debe lanzar.
      const result = await drainObservable(
        interceptor.intercept(
          ctxWithRequest({ method: 'GET', url: '/x' }),
          mockNext as unknown as CallHandler,
        ),
      );

      expect(result).toBeDefined();
    });
  });

  describe('extracción de path', () => {
    it('Prefiere req.route.path sobre originalUrl/url', async () => {
      const a: any = {};
      a.x = a;
      mockNext.handle.mockReturnValueOnce(of(a));

      await drainObservable(
        interceptor.intercept(
          ctxWithRequest({
            method: 'GET',
            route: { path: '/api/users/:id' },
            originalUrl: '/api/users/123?x=1',
            url: '/api/users/123?x=1',
          }),
          mockNext as unknown as CallHandler,
        ),
      );

      const [, payload] = mockAudit.logFailure.mock.calls[0];
      expect(payload.entityId).toBe('GET /api/users/:id');
      expect(payload.metadata.path).toBe('/api/users/:id');
    });

    it('Fallback a originalUrl cuando no hay route.path', async () => {
      const a: any = {};
      a.x = a;
      mockNext.handle.mockReturnValueOnce(of(a));

      await drainObservable(
        interceptor.intercept(
          ctxWithRequest({
            method: 'POST',
            originalUrl: '/raw/path',
            url: '/raw/path',
          }),
          mockNext as unknown as CallHandler,
        ),
      );

      const [, payload] = mockAudit.logFailure.mock.calls[0];
      expect(payload.metadata.path).toBe('/raw/path');
    });

    it('Fallback a "<unknown>" cuando no hay ninguna fuente de path', async () => {
      const a: any = {};
      a.x = a;
      mockNext.handle.mockReturnValueOnce(of(a));

      await drainObservable(
        interceptor.intercept(
          ctxWithRequest({ method: 'GET' }),
          mockNext as unknown as CallHandler,
        ),
      );

      const [, payload] = mockAudit.logFailure.mock.calls[0];
      expect(payload.metadata.path).toBe('<unknown>');
    });
  });
});
