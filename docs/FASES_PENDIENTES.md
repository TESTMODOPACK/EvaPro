# Fases Pendientes — EvaPro

Este documento lista refactors y decisiones de diseño que quedaron postergadas
intencionalmente para no bloquear entregas actuales. Cada ítem tiene un
propietario, un impacto estimado y un punto de entrada al código.

---

## F-001 — Segregación del rol `super_admin` fuera de operaciones internas de tenant

**Estado**: pendiente — no bloquea ninguna entrega actual.
**Impacto**: alto (afecta ~20 endpoints transversales).
**Prioridad**: media.

### Contexto
Actualmente `super_admin` está habilitado como fallback en casi todos los
endpoints operacionales de RRHH (desvinculaciones, movimientos, reactivación,
notas, bulk-import, etc.) al lado de `tenant_admin`. Esto se hizo por
conveniencia de soporte: un operador de plataforma puede intervenir en
emergencias cross-tenant.

Sin embargo, el rol `super_admin` fue concebido para **operaciones de
plataforma**: gestión de tenants, planes, billing, auditoría cross-tenant,
métricas de sistema. No debería tener injerencia en procesos internos de cada
organización (quién se desvincula, quién es promovido, etc.) porque:

1. Crea responsabilidad legal ambigua (¿quién firma la desvinculación?).
2. Ensucia el audit log con acciones que no son del equipo de RRHH real.
3. Abre superficie de ataque innecesaria si una cuenta super_admin se
   compromete.

### Alcance del refactor
Remover `super_admin` del decorador `@Roles(...)` en:

- `apps/api/src/modules/users/users.controller.ts` — ~12 endpoints
  (crear, actualizar, eliminar, bulk-import, invite-bulk, resend-invite,
  normalize-departments, fill-fake-ruts, departure, reactivate, update
  departure, cancel departure, movement, notas)
- Cualquier otro controlador de dominio operacional que pueda tenerlo
  (auditar recruitment, objectives, development, feedback, signatures,
  talent, calibration).

`super_admin` debe **mantenerse** en:
- Endpoints de plataforma: `/tenants`, `/plans`, `/subscriptions`,
  `/audit-logs` (vista cross-tenant), `/system-metrics`, `/tenants/:id/impersonate`.
- Endpoints de lectura global cross-tenant para soporte (pero ideado como
  "read-only for investigation").

### Estrategia recomendada
1. Auditar endpoint por endpoint generando un CSV: `ruta | roles actuales | ¿operacional o plataforma? | roles destino`.
2. Aplicar el cambio en una rama dedicada con un commit por módulo para
   facilitar el review.
3. Actualizar los tests e2e que estén usando credenciales super_admin para
   interactuar con endpoints operacionales.
4. Agregar una nota al UI de super_admin: "Tu cuenta es de plataforma. Si
   necesitas operar sobre una organización, impersona al admin del tenant".
5. Considerar un endpoint temporal `POST /support/impersonate/:tenantId` que
   emita un JWT de `tenant_admin` de emergencia con sello de auditoría — así
   cualquier acción operacional queda registrada como impersonación
   intencional, no como super_admin actuando en un tenant.

### Referencias de código
- `apps/api/src/modules/users/users.controller.ts` líneas con `@Roles('super_admin', 'tenant_admin'...)`.
- Antecedente: el DELETE `/users/:id/departures/:depId` originalmente quedó
  como super_admin-only por criterio de "riesgo"; se abrió a tenant_admin
  cuando se detectó la inconsistencia (ver commit del fix).

---

## F-002 — Signature rerouting al desvincular firmante

**Estado**: pendiente — Stage B de la cascade de desvinculación lo dejó fuera.
**Impacto**: medio (bloquea workflows de firma cuando firmante desvincula).
**Prioridad**: media.

Requiere agregar columna `rerouted_to` en `DocumentSignature` y lógica para
reemplazar el firmante ausente por el manager o tenant_admin. Ver
`apps/api/src/modules/users/users.service.ts` método `registerDeparture`
comentario "Deferred to future stages".

---

## F-003 — Reasignación de moderador de sesión de calibración

**Estado**: pendiente — Stage B lo dejó fuera.
**Impacto**: medio.
**Prioridad**: baja.

Cuando el moderador de una sesión de calibración se desvincula, la sesión
queda sin owner. Requiere endpoint `POST /calibration/sessions/:id/reassign-moderator`.

---

## F-004 — Cron jobs pre-filter por `user.isActive`

**Estado**: pendiente.
**Impacto**: bajo (solo genera notifications/emails innecesarios a usuarios
inactivos — no rompe nada).
**Prioridad**: baja.

Los 18 cron jobs en `apps/api/src/modules/notifications/reminders.service.ts`
deberían filtrar destinatarios por `isActive = true` para evitar mandar
recordatorios a desvinculados con email todavía reachable.

---

## Convenciones para agregar nuevos ítems

1. ID incremental `F-###`.
2. Campos obligatorios: Estado, Impacto, Prioridad, Contexto, Alcance, Referencias.
3. Al implementar un ítem, no borrar de este doc — marcar como `✅ Implementado`
   con enlace al commit/PR, y mover a una sección "Historial" al final.
