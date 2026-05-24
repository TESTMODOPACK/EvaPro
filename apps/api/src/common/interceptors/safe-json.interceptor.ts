import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuditService } from '../../modules/audit/audit.service';

/**
 * SafeJsonInterceptor — última línea de defensa contra
 * `TypeError: Converting circular structure to JSON`.
 *
 * Contexto del bug que cierra: un controller devuelve un body que
 * contiene referencias circulares (típicamente entidades TypeORM con
 * relaciones bidireccionales sin sanitizar, o respuestas que enganchan
 * accidentalmente el `req`/`res`/socket). Cuando NestJS pasa ese body
 * al adapter de Express y éste llama `response.json(body)`, falla
 * con `Converting circular structure to JSON`. El cliente recibe 500
 * y el FE muestra "Error al cargar los datos".
 *
 * Estrategia:
 *   1. Caso normal (sin ciclo): `JSON.stringify(body)` no lanza →
 *      devolvemos el body intacto. Express lo serializará de nuevo
 *      (cost: una stringify extra que evita 500s en producción).
 *   2. Caso con ciclo: capturamos el throw, sanitizamos reemplazando
 *      referencias circulares por `'[Circular]'`, devolvemos al
 *      cliente una respuesta degradada (en vez de 500) y dejamos
 *      registro forense en audit_log (`system.error` con `kind:
 *      circular_response_body` + endpoint + método + path + role).
 *      Eso permite identificar el call-site específico en el próximo
 *      evento y arreglarlo puntualmente.
 *
 * Skips:
 *   - Primitivos, null, undefined.
 *   - Buffers (downloads binarios — Express los maneja diferente).
 *   - Streams (tienen `.pipe` — Express los entuba directo).
 */
@Injectable()
export class SafeJsonInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SafeJsonInterceptor.name);

  constructor(@Optional() private readonly auditService?: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const res = context.switchToHttp().getResponse();
    return next.handle().pipe(
      map((body) => {
        if (body == null || typeof body !== 'object') return body;
        if (Buffer.isBuffer(body)) return body;
        if (typeof (body as any).pipe === 'function') return body; // Streams
        // Handlers que usan `@Res()` (sin passthrough) + `return res.send(x)`
        // retornan el propio `res` (Express Response). NestJS no lo
        // serializa (porque detecta passthrough:false), pero este map
        // todavía corre. Si lo procesáramos, el probe-stringify
        // fallaría con cycle (socket→parser→socket) y dispararíamos
        // un audit falso-positivo. Skipear cuando body === res es la
        // detección más precisa (1 referencia identity, sin duck-typing).
        if (body === res) return body;

        try {
          // Probe: si el body es serializable, no tocamos nada.
          // El costo es una stringify extra; el ahorro es evitar el
          // 500 en caso de ciclo (que también requeriría stringify
          // dentro de Express y fallaría ahí, sin posibilidad de
          // diagnóstico).
          JSON.stringify(body);
          return body;
        } catch (err: any) {
          const req = context.switchToHttp().getRequest();
          this.handleCircularBody(req, err);
          return this.sanitizeCycles(body);
        }
      }),
    );
  }

  private handleCircularBody(req: any, err: Error): void {
    const method = req?.method;
    const path =
      req?.route?.path || req?.originalUrl || req?.url || '<unknown>';
    this.logger.warn(
      `[SafeJsonInterceptor] Circular structure detected in response body for ${method} ${path}: ${err.message}`,
    );
    // Audit log con info suficiente para identificar el call-site
    // específico la próxima vez que ocurra. Fire-and-forget.
    this.auditService
      ?.logFailure('system.error', {
        tenantId:
          req?.user?.role === 'super_admin'
            ? null
            : req?.user?.tenantId ?? null,
        userId: req?.user?.userId ?? null,
        entityType: 'Endpoint',
        entityId: `${method ?? ''} ${path}`,
        error: err,
        metadata: {
          kind: 'circular_response_body',
          method,
          path,
          userRole: req?.user?.role,
        },
        ipAddress:
          req?.ip || req?.headers?.['x-forwarded-for'] || undefined,
      })
      .catch(() => {});
  }

  /**
   * Sanitiza ciclos reemplazándolos por `'[Circular]'` usando un
   * WeakSet para detectar nodos repetidos. La doble pasada
   * (stringify→parse) es cara pero solo se ejecuta cuando ya se
   * detectó un ciclo (caso raro post-deploy del fix).
   */
  private sanitizeCycles<T>(body: T): T {
    const seen = new WeakSet<object>();
    return JSON.parse(
      JSON.stringify(body, (_key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        return value;
      }),
    ) as T;
  }
}
