/**
 * audit.interceptor.ts — Interceptor que escribe automaticamente al
 * audit_log cuando un endpoint tiene el decorator @Audited().
 *
 * Se ejecuta DESPUES de que el handler responde exitosamente. Si el
 * handler tira una excepcion, NO se audita (solo acciones exitosas
 * son relevantes para compliance).
 *
 * El interceptor extrae:
 *   - action y entityType del decorator @Audited
 *   - tenantId y userId del req.user (Passport JWT)
 *   - entityId del response (si es un objeto con .id)
 *
 * Es global (registrado como APP_INTERCEPTOR en AppModule) pero solo
 * actua sobre endpoints que tienen el decorator. Los que no lo tienen
 * pasan sin costo — la verificacion de metadata es O(1).
 */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AUDIT_METADATA_KEY, AuditMetadata } from '../decorators/audited.decorator';
import { AuditService } from '../../modules/audit/audit.service';

@Injectable()
export class AuditInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const metadata = this.reflector.get<AuditMetadata>(
      AUDIT_METADATA_KEY,
      context.getHandler(),
    );

    // Si el handler no tiene @Audited, pasar sin hacer nada
    if (!metadata) return next.handle();

    const req = context.switchToHttp().getRequest();
    const user = req.user;

    return next.handle().pipe(
      tap({
        next: (response) => {
          // Fire-and-forget — no bloquear la respuesta por el audit log.
          // Si el audit falla, el usuario recibe su respuesta normal y
          // el error se loguea silenciosamente.
          const tenantId = user?.tenantId || 'system';
          const userId = user?.userId || user?.id || null;
          const entityId = response?.id || null;

          this.auditService
            .log(tenantId, userId, metadata.action, metadata.entityType, entityId)
            .catch((err) => {
              this.logger.error(
                `Audit log failed for ${metadata.action}: ${err?.message || err}`,
              );
            });
        },
      }),
    );
  }
}
