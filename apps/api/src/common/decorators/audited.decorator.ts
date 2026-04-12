/**
 * audited.decorator.ts — Decorator para marcar endpoints como "auditados".
 *
 * NOTA: Este decorator es SOLO metadata. La auditoria real se ejecuta via
 * el AuditInterceptor (ver audit.interceptor.ts) que lee esta metadata
 * y escribe al audit_log despues de que el request se completa con exito.
 *
 * Uso en un controller:
 *
 *   @Post()
 *   @Audited('tenant.created', 'tenant')
 *   create(@Request() req, @Body() dto) { ... }
 *
 * Esto genera un audit log con:
 *   action: 'tenant.created'
 *   entityType: 'tenant'
 *   entityId: extraido del response (si es un objeto con .id)
 *   tenantId: req.user.tenantId
 *   userId: req.user.userId
 */
import { SetMetadata } from '@nestjs/common';

export const AUDIT_METADATA_KEY = 'eva360:audited';

export interface AuditMetadata {
  action: string;
  entityType: string;
}

export const Audited = (action: string, entityType: string) =>
  SetMetadata(AUDIT_METADATA_KEY, { action, entityType } as AuditMetadata);
