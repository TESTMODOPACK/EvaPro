/**
 * tenant-scope.ts — Helper para resolver el tenantId correcto en operaciones
 * write-side-effect que pueden ser invocadas por super_admin y por
 * tenant_admin/manager/employee.
 *
 * Reemplaza el patrón inseguro:
 *
 *   const tenantId = req.user.tenantId;  // ← si super_admin tiene tenantId
 *                                         //   residual (seed viejo), todo lo
 *                                         //   que hace cae en ese tenant
 *
 * Por la regla explícita:
 *
 *   const tenantId = resolveOperatingTenantId(req.user, dto.tenantId);
 *
 *   - super_admin: DEBE pasar explicitTenantId (body o query). Si no → 400.
 *   - Resto de roles: siempre usan req.user.tenantId (ignoran el explícito
 *     para evitar smuggling cross-tenant).
 *
 * Para endpoints con path :id (update, remove, resend-invite) el patrón
 * alternativo es pasar `undefined` al service cuando role === 'super_admin'
 * y dejar que el service resuelva por id sin filtrar por tenant. Ver
 * precedente en users.controller::fillFakeRuts y users.service::remove.
 *
 * Contexto histórico: el bug cross-tenant de POST /users (usuarios creados
 * en Demo Company cuando super_admin eligía otro tenant) se produjo porque
 * super_admin tenía tenantId=<demo> residual del seed antiguo, el DTO no
 * whitelisteaba tenantId, y el controller hacía fallback silencioso a
 * req.user.tenantId. Fix en users.controller:112+ + create-user.dto.ts +
 * seed.ts. Este helper centraliza la regla para los otros endpoints con
 * la misma clase de bug.
 */
import { BadRequestException } from '@nestjs/common';

export interface OperatingUser {
  role: string;
  tenantId?: string | null;
}

export function resolveOperatingTenantId(
  user: OperatingUser,
  explicitTenantId?: string,
): string {
  if (user.role === 'super_admin') {
    if (!explicitTenantId) {
      throw new BadRequestException(
        'super_admin debe especificar tenantId en el body o query para esta operación.',
      );
    }
    return explicitTenantId;
  }
  // Roles tenant-scoped: siempre usan su propio tenantId. Cualquier
  // explicitTenantId recibido se ignora silenciosamente (anti-smuggling).
  return user.tenantId as string;
}
