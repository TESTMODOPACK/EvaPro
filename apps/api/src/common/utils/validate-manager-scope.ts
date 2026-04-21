import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';

/**
 * validate-manager-scope.ts — Helper para validar que un caller con rol
 * `manager` solo acceda a data de SUS direct reports o self.
 *
 * Contexto del bug que resuelve:
 *   Muchos endpoints detail con `:userId` en el path se confiaron en "el
 *   service aplicará scope". Pero cuando el service hace
 *   `where: { id: userId }` con el userId del path, NO hay scope por
 *   managerId — entonces un manager podía pedir `/endpoint/:otroUserId`
 *   y recibir data de un colaborador ajeno.
 *
 * Patrón de uso:
 *
 *   // En un controller
 *   @Get('something/:userId')
 *   async action(@Param('userId') userId: string, @Request() req: any) {
 *     await assertManagerCanAccessUser(
 *       this.userRepo,
 *       req.user.userId,
 *       req.user.role,
 *       userId,
 *       req.user.tenantId,
 *     );
 *     return this.service.getSomething(userId);
 *   }
 *
 * Reglas:
 *   - super_admin / tenant_admin  → siempre pasa (admin del tenant).
 *   - self (caller === target)    → siempre pasa (acceso propio).
 *   - manager                     → solo si target.managerId === caller.
 *   - employee                    → solo self (implícito por el check anterior).
 *   - external                    → siempre bloqueado con excepción de self.
 *
 * Retorna 403 Forbidden si el manager intenta acceder a un user fuera de
 * su equipo. Retorna 404 NotFound si el target no existe (para no leak
 * existencia cross-tenant, consistente con `assertCanAccessUser` del
 * users.service).
 *
 * NOTA: este helper solo cubre el caso "manager → target user". Si el
 * endpoint trabaja con un recurso (ej: objective, evaluation) cuyo dueño
 * es un user, el caller debe resolver primero `resource.ownerId` y luego
 * llamar este helper con `targetUserId = resource.ownerId`.
 */
export async function assertManagerCanAccessUser(
  userRepo: Repository<any>,
  callerUserId: string,
  callerRole: string,
  targetUserId: string,
  tenantId: string,
): Promise<void> {
  // Super_admin y tenant_admin: acceso full dentro del tenant.
  if (callerRole === 'super_admin' || callerRole === 'tenant_admin') return;

  // Self-access: siempre permitido (cualquier rol puede ver su propia data).
  if (callerUserId === targetUserId) return;

  // External: solo self. Ya bloqueado por el check anterior.
  if (callerRole === 'external') {
    throw new ForbiddenException('Los asesores externos solo pueden acceder a su propia información');
  }

  // Employee: solo self. Ya bloqueado por el check anterior.
  if (callerRole === 'employee') {
    throw new ForbiddenException('Solo puedes acceder a tu propia información');
  }

  // Manager: validar que target es direct report.
  if (callerRole === 'manager') {
    const target = await userRepo.findOne({
      where: { id: targetUserId, tenantId },
      select: ['id', 'managerId'],
    });
    if (!target) {
      // User no existe en este tenant → pretendemos que no existe,
      // sin leak de info cross-tenant.
      throw new ForbiddenException('Usuario no accesible');
    }
    if (target.managerId !== callerUserId) {
      throw new ForbiddenException(
        'Solo puedes acceder a información de tu equipo directo',
      );
    }
    return;
  }

  // Rol desconocido: deny by default.
  throw new ForbiddenException('Rol no autorizado');
}

/**
 * Versión para validar ownership de un recurso (objective, plan, etc.)
 * cuando el controller ya cargó el recurso y tiene el `ownerUserId`.
 *
 * Evita hacer una query extra a `users` si ya tenés el managerId del
 * owner cacheado por algún lado.
 */
export function assertManagerOwnsResource(
  callerUserId: string,
  callerRole: string,
  resourceOwnerId: string,
  resourceOwnerManagerId: string | null,
): void {
  if (callerRole === 'super_admin' || callerRole === 'tenant_admin') return;
  if (callerUserId === resourceOwnerId) return;
  if (callerRole === 'manager' && resourceOwnerManagerId === callerUserId) return;
  throw new ForbiddenException(
    'Solo puedes acceder a recursos de tu equipo directo o propios',
  );
}
