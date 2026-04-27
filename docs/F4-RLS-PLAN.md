# F4 — Row-Level Security en Postgres

## TL;DR

Implementar RLS de Postgres como capa adicional de aislamiento multi-tenant, encima del filtrado a nivel de aplicación que existe hoy en TypeORM. **Defense-in-depth**: si una query olvida `WHERE tenant_id = ?`, RLS impide leakage cross-tenant.

**Estimado realista**: 3-5 días de trabajo concentrado, partido en 5 fases incrementales. **NO 1-2 días** como estimé inicialmente — el análisis profundo reveló complejidades arquitectónicas (connection pooling, cron jobs, queries cross-tenant intencionales).

## Estado actual del aislamiento (pre-F4)

- **Aplicación-level**: cada query tiene `WHERE tenant_id = ?` (la mayoría). 66 de 78 entidades tienen columna `tenant_id`.
- **Punto de falla**: si un dev olvida el filtro en una query nueva → leak. Ej. detectado en análisis: `ai-insights.service.ts` hace `userRepo.find({ where: { role: 'tenant_admin', isActive: true } })` sin tenantId → retorna admins de TODOS los tenants.
- **Cron jobs (20+)**: ejecutan sin contexto de request, dependen del filtro tenant_id en queries → si una query lo olvida, el cron afecta a todos los tenants.

## Decisión arquitectónica clave

**Postgres session vars + connection pinning** vs alternativas:

| Approach | Pros | Contras | Decisión |
|---|---|---|---|
| Session var (`set_config(app.current_tenant_id)`) | Estándar en Postgres+RLS | Connection pool requiere pinning per-request | ✅ Esta vamos |
| Filtrado vía TypeORM event subscribers | Simple, sin cambios a Postgres | No es "real" RLS, frágil | ❌ Rechazado (defense-in-depth requiere DB-level) |
| pgbouncer transaction pooling | Garantiza connection-per-tx | Infraestructura adicional | ❌ Defer (no urgente) |

## Las 5 fases

### Fase A0 — Foundation (preparatorio, sin riesgo)

**Estado**: ✅ Completado.

**Entregables**:
- TenantContextInterceptor mejorado (`set_config` session-level + reset on finalize)
- SQL audit script (`apps/api/src/database/sql/2026-04-27-F4-rls-audit.sql`)
- Este documento

**Limitación documentada**: Connection pool puede dar conexiones distintas dentro de un mismo request → variable inconsistente entre queries del controller. **No causa breakage hoy** porque RLS no está activado, pero tiene que resolverse antes de Fase B.

---

### Fase A1 — Tests + audit en producción (sin riesgo)

**Esfuerzo**: 2-3h.

**Entregables**:
- Correr el SQL audit en prod, capturar baseline:
  - Tablas con/sin `tenant_id`
  - Tablas con `tenant_id` pero SIN índice sobre esa columna (riesgo de perf cuando RLS active)
  - Distribución de rows por tenant en top 5 tablas
- Test E2E que valide isolation cross-tenant (debe fallar HOY → confirma que RLS es necesario):
  - Login user del tenant A
  - Hacer query directa al endpoint
  - Verificar que NO retorna datos del tenant B
- Documentar resultado del audit en `F4-RLS-AUDIT-RESULTS.md`

**No-go conditions** (si se cumple alguno, replantear plan):
- Más de 5 tablas con `tenant_id` y sin índice (problema de perf no resoluble en una semana)
- Más de 10 queries que LEGITIMAMENTE consultan cross-tenant (admin reports, MVP cross-tenant calc) — si son muchas, RLS molesta más de lo que ayuda

---

### Fase A2 — Connection pinning (riesgo bajo si se hace bien)

**Esfuerzo**: 1 día completo.

**El problema central**: Postgres `set_config` es por-conexión. TypeORM connection pool da conexiones aleatorias del pool a cada query. Para que RLS funcione, **todas las queries de un request deben usar la misma conexión**.

**Approach elegido**: Wrap el request lifecycle en `dataSource.transaction()`. Dentro de una transacción TypeORM mantiene una sola conexión. Todas las queries que usen el `EntityManager` de esa transacción ven el mismo `set_config`.

**Subtarea crítica**: hacer que TODOS los repositorios/services usen el `EntityManager` de la transacción, NO el global `dataSource`. Opciones:

1. **`typeorm-transactional` library** (recomendado): añade dependencia, usa cls-hooked para propagar tx context globalmente sin tocar code de services. Tested en producción en miles de apps NestJS.

2. **AsyncLocalStorage nativo**: similar a opción 1 pero hand-rolled. Más control, más código.

3. **Refactorizar todos los services** para inyectar EntityManager en cada método. ❌ Demasiado invasivo.

**Decisión**: Opción 1 (`typeorm-transactional`). Justificación: maduro, ampliamente usado, evita 1 semana de refactor.

**Pasos**:
1. `pnpm add typeorm-transactional` en `apps/api`
2. Initialize en `main.ts` antes del NestFactory.create
3. Modificar TenantContextInterceptor para wrappear request en `@Transactional()`
4. Verificar las 13 instancias existentes de `dataSource.transaction()` siguen funcionando (deben; serán nested tx → savepoints)
5. Tests E2E para confirmar que la session var se propaga a todas las queries

**Riesgo**: cambiar a tx-per-request añade overhead. Latencia esperada: +5-10ms por request. Aceptable.

---

### Fase A3 — Refactor cron jobs (riesgo medio)

**Esfuerzo**: 4-5h.

20+ cron handlers ejecutan sin tenant context. Hay que refactorizar para que cada uno:
- Itere tenants explícitamente (como hace ya `recognition.service.calculateMvpOfTheMonth`)
- Setee `app.current_tenant_id` antes de queries del tenant
- Limpie al fin

Approach concreto: helper `runForEachTenant(callback)` que envuelve la iteración + set_config + reset.

```ts
// Pseudo-código
await this.tenantRunner.runForEachTenant(async (tenantId) => {
  // queries dentro ven app.current_tenant_id = tenantId
  await this.processCycleReminders(tenantId);
});
```

Cron jobs identificados que requieren refactor (lista parcial):
- `feedback.service.autoCompleteStaleCheckIns`
- `recruitment.service` (cron a 1am)
- `notifications/reminders.service.*` (20+ handlers)
- `surveys.service.daily_10am`
- `team-meetings.service.daily_205am`

**Riesgo**: si un cron rompe, falla silenciosamente (los crons no atienden requests). Tests obligatorios.

---

### Fase B — Habilitar RLS en tabla pivot (riesgo alto — primer cutover real)

**Esfuerzo**: 3-4h.

**Tabla elegida**: `evaluation_responses`. Razones:
- Mediano tamaño (no la mas grande, no la mas chica)
- Datos sensibles (respuestas de evaluación)
- Pocas queries cross-tenant legítimas (sólo super_admin reports)

**Migration SQL**:
```sql
ALTER TABLE evaluation_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON evaluation_responses
  USING (
    tenant_id::text = current_setting('app.current_tenant_id', true)
    OR current_setting('app.current_tenant_id', true) = ''  -- super_admin bypass
  );
```

**Validación**:
1. Test E2E: login como tenant A, query evaluation_responses → solo retorna data de A
2. Test E2E: login como super_admin, query → retorna todo (bypass funciona)
3. Test E2E: cron job que toca evaluation_responses → funciona (vía Fase A3)
4. Performance: medir latencia antes/después en query típica

**Plan de rollback**:
```sql
ALTER TABLE evaluation_responses DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON evaluation_responses;
```

**Si la Fase B funciona durante 24-48h en producción sin issues**, avanzamos a Fase C. Si rompe algo, rollback inmediato y debug.

---

### Fase C — Roll out a 65 tablas restantes (riesgo medio)

**Esfuerzo**: 4-6h.

Una migration SQL grande que aplica el mismo patrón de Fase B a las 65 tablas restantes. Misma policy, mismo bypass para super_admin.

Validación post-deploy: smoke test recorriendo todas las features de la app, verificando que no haya 0-rows donde antes había datos.

---

### Fase D — Cleanup + audit final (riesgo bajo)

**Esfuerzo**: 2-3h.

- Quitar filtros `tenantId` redundantes en queries TypeORM (RLS ya los hace innecesarios). Esto NO es obligatorio — coexisten bien — pero limpia código duplicado.
- Test de penetración: simular bug donde un dev olvida `tenantId` en una query nueva. Verificar que RLS lo cacha (devuelve 0 rows en lugar de leak).
- Documentar runbook operacional: "qué hacer si RLS bloquea una query legítima".

## Total estimado

| Fase | Esfuerzo | Riesgo deploy |
|---|---|---|
| A0 — Foundation | 2-3h | 🟢 Cero (este commit) |
| A1 — Tests + audit | 2-3h | 🟢 Cero (solo testing) |
| A2 — Connection pinning | 1 día (8h) | 🟡 Medio (deps nuevas) |
| A3 — Refactor cron jobs | 4-5h | 🟠 Medio-alto (cron failures = silenciosos) |
| B — RLS en tabla pivot | 3-4h | 🔴 Alto (primer cutover) |
| C — Roll out 65 tablas | 4-6h | 🟠 Medio (Fase B ya valido patrón) |
| D — Cleanup | 2-3h | 🟢 Bajo |
| **Total** | **3-5 días** | |

## Decisiones pendientes (al inicio de Fase A1)

- ¿Apruebas adoptar `typeorm-transactional` como dependencia? Maduro pero introduce magic CLS context — algunos devs prefieren evitarlo.
- ¿Validamos en staging primero o vamos directo a prod después de smoke tests locales? (recomendación: staging si existe).
- ¿Algún tenant específico que NO debe tener RLS en una primera fase? Ej. tenant interno demo.

## Referencias

- Postgres docs: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- Anti-patterns en RLS: https://supabase.com/docs/guides/auth/row-level-security#example-policies
- typeorm-transactional: https://github.com/Aliheym/typeorm-transactional
