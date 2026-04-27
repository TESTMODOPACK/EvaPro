# F4 Fase C — Runbook operacional

Roll-out de RLS a las 66 tablas tenant-scoped restantes (todas excepto `evaluation_responses`, ya cubierta en Fase B).

## Pre-requisitos

- [ ] **Fase B aplicada y validada en producción durante 24-48h sin issues** (recomendado, no obligatorio).
  - Si Fase B + C se aplican juntas en el mismo cutover, la complejidad de debug aumenta — preferir secuencial salvo presión de schedule.
- [ ] Backup reciente de la BD (`pg_dump` exitoso < 24h).
- [ ] Ventana de mantenimiento aprobada (impacto esperado: <2 min de queries lentas mientras se cambia plan en 67 tablas; sin downtime).
- [ ] Acceso SSH al VPS Hostinger.
- [ ] Operador presente para ejecutar rollback si algo falla.

## Diferencias con Fase B

| Aspecto | Fase B | Fase C |
|---|---|---|
| Tablas afectadas | 1 (`evaluation_responses`) | 67 (todas con `tenant_id`) |
| Estrategia SQL | tabla literal | DO block que itera `information_schema` |
| Idempotente | sí | sí (re-ejecutar es safe; cubre tablas nuevas automáticamente) |
| Rollback | <1s | ~2-5s (loop sobre 67 tablas) |
| Test E2E nuevo | sí | reusa el de Fase B (válido para ambas) |

## Pasos del cutover

### 1. Audit pre-deploy (5 min)

```bash
ssh root@<host>
cd /opt/eva360
docker compose exec -T db psql -U eva360 -d eva360 \
  < apps/api/src/database/sql/2026-04-27-F4-rls-audit.sql
```

Verificar:
- Sección "1. Tablas tenant-scoped": deben aparecer ~67 tablas.
  - Solo `evaluation_responses` debería decir `RLS ENABLED` (Fase B).
  - Las otras 66 deben decir `no RLS`.
- Sección "6. Tablas con tenant_id PERO SIN índice": **debe estar vacío**. Si aparece alguna tabla, **STOP** — agregar índice antes de aplicar Fase C (`CREATE INDEX idx_<table>_tenant_id ON <table>(tenant_id);`).

### 2. Aplicar la migration (1-2 min)

```bash
docker compose exec -T db psql -U eva360 -d eva360 \
  < apps/api/src/database/sql/2026-04-27-F4C-rls-all-tenant-tables.sql
```

Output esperado: 67 líneas `✓ RLS aplicado a <table_name>` + resumen `Tablas procesadas: 67`.

Las dos queries de post-check finales deben retornar 0 filas:
- `Post-check: alguna tabla sin RLS (esperado: 0)`
- `Post-check: alguna tabla sin policy tenant_isolation (esperado: 0)`

### 3. Validación post-deploy (5 min)

```bash
docker compose exec -T db psql -U eva360 -d eva360 \
  < apps/api/src/database/sql/2026-04-27-F4C-validate-rls-all.sql
```

Buscar en el output:
- Sección "1. Coverage": `with_rls = with_force = with_policy = total_tenant_tables` (todos iguales, 67).
- Sección "1b. Tablas FALTANTES": **0 filas** (vacío).
- Sección "2.1-2.3": cada query retorna `0` (sin GUC = 0 filas por defense-in-depth).
- Sección "2.5": `✓ OK: aislamiento en users` (o `⚠` si BD tiene 1 solo tenant).
- Sección "2.6": `✓ OK: cross-tenant UPDATE bloqueado en notifications`.

Si cualquier test muestra `FAIL` o `EXCEPTION`, ir directo al paso 6.

### 4. Smoke test funcional (15-20 min)

Validar manualmente desde el frontend:

- [ ] **Login normal multi-tenant**:
  - Login `tenant_admin` de tenant A → ver users, evaluations, surveys, recognitions, etc. todo de su tenant.
  - Logout, login `tenant_admin` de tenant B → ver SOLO data de tenant B.
  - **CRITICAL**: ver que NO hay leak cross-tenant en ninguna pantalla.

- [ ] **Login super_admin**:
  - Acceder a `/admin` → ver listado de tenants, métricas globales, etc.
  - Verificar que las queries cross-tenant del super_admin (subscriptions globales, leads) siguen funcionando.

- [ ] **Crear/editar entidades**:
  - Crear nuevo objetivo, plan PDI, evaluación, etc.
  - Verificar que se asocia al tenant correcto y aparece en su listado.

- [ ] **Crons (esperar al menos 1 ciclo)**:
  - Verificar logs del API en las próximas horas: `[Cron] processing N active tenants` debe aparecer y los crons deben terminar OK.
  - No debe haber errores `set_config failed` ni `permission denied` en las logs.
  - El cron de notificaciones (cada 6h) es el más rápido para validar — esperar 1h máximo.

### 5. Monitoreo de 24-48h

- **Sentry**: filtrar por nuevos errores. Buscar:
  - `row-level security` o `RLS`
  - `permission denied for table` (si algún role distinto al app intenta acceso sin BYPASSRLS)
  - `Unable to connect to the database` (no debería aparecer pero confirmar)
- **Logs API**: buscar `set_config failed` (síntoma de tx no abierta correctamente).
- **Performance**: monitorear latencia p95 de endpoints más usados:
  - `/users` (debería ser similar a antes con índice)
  - `/evaluations` (similar)
  - `/notifications` (similar)
  - Esperar +1-3ms por query, despreciable.
- **Soporte clientes**: si reportan "datos faltantes" o "no veo X", investigar primero si el JWT tiene `tenantId` correcto.

### 6. Rollback (si algo se rompe)

**Cuando**: errores 500 masivos, datos invisibles para clientes legítimos, crones fallando masivamente.

**Opción A — Rollback solo Fase C** (mantiene Fase B activa en `evaluation_responses`):

```bash
# Aplicar rollback global (afecta TODAS las tablas, incluida la de Fase B)
docker compose exec -T db psql -U eva360 -d eva360 \
  < apps/api/src/database/sql/2026-04-27-F4C-rollback-rls-all-tenant-tables.sql

# Re-aplicar SOLO Fase B para mantenerla activa
docker compose exec -T db psql -U eva360 -d eva360 \
  < apps/api/src/database/sql/2026-04-27-F4B-enable-rls-evaluation-responses.sql
```

**Opción B — Rollback total (vuelve al estado pre-F4 a nivel BD)**:

```bash
docker compose exec -T db psql -U eva360 -d eva360 \
  < apps/api/src/database/sql/2026-04-27-F4C-rollback-rls-all-tenant-tables.sql
```

(Este comando también limpia Fase B porque toca todas las tablas con tenant_id.)

Tiempo: ~2-5s. El servicio vuelve al estado pre-F4 inmediatamente, sin reiniciar el API.

Después de rollback:
- Documentar la causa raíz en un postmortem.
- Investigar la tabla específica que rompió (logs, Sentry).
- Si es una tabla puntual con caso especial, considerar excluirla de Fase C (modificar el DO block para skipearla) y re-intentar.

## Trade-offs aceptados

1. **Latencia +1-3ms por query**: filtro RLS en 67 tablas. Con índice sobre `tenant_id`, despreciable. Si algún endpoint específico empeora notablemente, investigar si el query plan cambió (`EXPLAIN ANALYZE`).

2. **Migrations futuras necesitan setear el GUC**: si una migration nueva (TypeORM o SQL ad-hoc) hace UPDATE/INSERT sobre tablas tenant-scoped sin setear `app.current_tenant_id`, falla. Solución: prefix cada migration SQL con `SELECT set_config('app.current_tenant_id', '', true);`. Documentar en CONTRIBUTING / AGENTS.md.

3. **Tablas nuevas con tenant_id**: cuando se agregue una tabla nueva con `tenant_id`, hay 2 opciones:
   - (preferida) re-ejecutar `2026-04-27-F4C-rls-all-tenant-tables.sql` (idempotente, cubre la nueva tabla).
   - (alternativa) crear migration específica para esa tabla.

   Documentar: nueva tabla con tenant_id → ejecutar Fase C SQL para que reciba RLS automáticamente.

4. **Defense-in-depth completo a nivel BD**: a partir de aquí, cualquier bug en queries TypeORM (olvidar `WHERE tenantId = ?`) NO causa leak — RLS lo cacha. Esto es el goal principal de F4.

## Próximos pasos

Si Fase C está estable durante 24-48h en producción:
- **Fase D**: cleanup. Quitar filtros `WHERE tenantId = ?` redundantes en queries TypeORM (RLS ya los hace innecesarios). Test de penetración: simular bug de query sin filtro y verificar que RLS lo cacha. Documentar runbook operacional para casos edge ("RLS bloquea una query legítima → cómo investigar").

## Referencias

- Plan general: [`docs/F4-RLS-PLAN.md`](./F4-RLS-PLAN.md)
- Runbook Fase B: [`docs/F4-RLS-FASE-B-RUNBOOK.md`](./F4-RLS-FASE-B-RUNBOOK.md)
- Lista canónica de tablas: [`apps/api/src/common/rls/expected-tenant-tables.ts`](../apps/api/src/common/rls/expected-tenant-tables.ts)
- Postgres RLS docs: <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>
