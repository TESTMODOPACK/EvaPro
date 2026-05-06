# ADR 0001 — Rol `external` en el módulo de firmas

**Estado:** Aceptado
**Fecha:** 2026-05-06
**Contexto:** Auditoría CTO firmas Eva360 — gap **G4**

## Problema

El rol `external` (evaluador externo: cliente, par cruzado, proveedor)
NO estaba autorizado en ningún endpoint del módulo `signatures`. Esto
significaba que el feedback emitido por external en un proceso 360
**no tenía firma del autor** → la trazabilidad legal de "quién dijo qué"
quedaba rota. En auditorías futuras no se podía demostrar que el feedback
provino realmente de la persona designada.

## Opciones consideradas

### A — `external` NO firma (anónimo)

- Pro: Privacidad reforzada para evaluador externo.
- Contra: Pérdida de trazabilidad legal. Imposibilidad de probar autoría.
- Contra: Inconsistente con `manager` y `employee`, que sí firman.

### B — `external` firma como autor del feedback emitido (✓ ELEGIDA)

- Pro: Cierra el gap legal: cada feedback tiene firma del autor.
- Pro: OTP por email valida identidad del external.
- Pro: Consistente con autoría firmada del `manager` (TAREA 5).
- Contra: Requiere que external tenga email verificado en DB.

### C — `external` firma como recipient

- No aplica: `external` por definición NO es evaluado en el ciclo.

## Decisión

**`external` SÍ firma** los documentos que emite **como `signatureRole = AUTHOR`**.

Concretamente:
- ✅ Acceso a `POST /signatures/request` y `POST /signatures/verify`.
- ✅ Acceso a `GET /signatures/mine` (ver sus propias firmas).
- ❌ **NO** acceso a `GET /signatures/team` (no tiene equipo).
- ❌ **NO** acceso a `GET /signatures` (listado del tenant — solo tenant_admin).
- ❌ **NO** acceso a `GET /signatures/verify/:id` (verificación forense — solo admin/manager).
- ❌ **NO** puede firmar como `recipient` (validado en `SignatureAuthorizationService`).
- ❌ **NO** puede firmar como `employer_witness` (eso es solo `tenant_admin`).

## Implementación

### En esta tarea (TAREA 8)

- Añadir `'external'` a `@Roles()` de `request`, `verify` y `mine` en
  `signatures.controller.ts`.
- Reglas en `SignatureAuthorizationService`: `external` rechazado por
  default en `evaluation_response` cuando no es el evaluatee (queda como está).
- Tests.

### En TAREA 5 (Manager firma como autor)

- Endpoint `POST /evaluations/responses/:id/sign-as-author` permitirá
  que cualquier evaluator (incluyendo external + manager) firme la
  evaluación que emitió, con `signatureRole = AUTHOR`.
- Será el camino real por el cual external genera su firma de autoría.

## Consecuencias

1. El email del usuario `external` debe ser verificado antes de habilitar
   firma. Esto se debe asegurar en el flujo de creación del usuario
   (responsabilidad fuera de este ADR).
2. Los listings de firmas (`getSignatures`, `getSignaturesByTenant`)
   muestran ahora firmas de external — esto está OK, son auditables.
3. Si en el futuro se decide cambiar a "external es anónimo" (Opción A),
   este ADR deberá ser superseded por uno nuevo y el código revertido.
