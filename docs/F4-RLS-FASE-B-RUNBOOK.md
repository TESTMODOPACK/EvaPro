# F4 Fase B — Runbook operacional

Activación de Row-Level Security en `evaluation_responses` (primer cutover).

## Pre-requisitos (verificar antes de empezar)

- [ ] F4 Fase A0–A3 mergeadas a main y desplegadas en producción.
- [ ] Backup reciente de la BD (`pg_dump` exitoso en las últimas 24h).
- [ ] Ventana de mantenimiento aprobada (impacto esperado: <30s de queries lentas mientras se cambia el plan; sin downtime).
- [ ] Acceso SSH al VPS Hostinger.
- [ ] Operador presente para ejecutar rollback si algo falla.

## Decisión arquitectónica clave

**FORCE ROW LEVEL SECURITY**: la migración activa esta opción. Sin ella, el user `eva360` (owner de la tabla) bypasea la policy automáticamente y el RLS sería decorativo. Con `FORCE`, la app misma queda sujeta al filtrado.

**Consecuencia**: cualquier conexión a la BD que NO setee `app.current_tenant_id` verá 0 filas en `evaluation_responses`. Esto incluye:

- Conexiones admin vía `psql` directo → operador debe correr `SELECT set_config('app.current_tenant_id', '', true);` al inicio de la sesión para entrar en modo "system" (ve todo).
- Scripts ad-hoc (seed, migration) → mismo set_config explícito necesario.
- pg_dump con role distinto → si el role tiene BYPASSRLS (postgres superuser), no hay problema. Verificar:
  ```sql
  SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('eva360','postgres');
  ```

La app via `TenantContextInterceptor` (cada request HTTP) y los crons via `TenantCronRunner` (Fase A3) ya setean el GUC correctamente.

## Pasos del cutover

### 1. Audit pre-deploy (5 min)

```bash
ssh root@<host>
cd /opt/eva360
docker compose exec -T db psql -U eva360 -d eva360 \
  < apps/api/src/database/sql/2026-04-27-F4-rls-audit.sql
```

Verificar:
- `evaluation_responses` aparece con `no RLS` en la sección "1. Tablas tenant-scoped".
- En la sección "5. Indices sobre tenant_id", existe el índice `idx_eval_response_tenant`.
- En la sección "6. Tablas con tenant_id PERO SIN índice", `evaluation_responses` **no** aparece.

Si alguno falla, **STOP** — fix índices antes de continuar.

### 2. Aplicar la migration (1 min)

```bash
docker compose exec -T db psql -U eva360 -d eva360 \
  < apps/api/src/database/sql/2026-04-27-F4B-enable-rls-evaluation-responses.sql
```

Output esperado al final:

```
table_name           | rls_status     | force_status
---------------------+----------------+-------------
evaluation_responses | ✓ RLS ENABLED  | ✓ FORCED

policyname        | applies_to | using_clause
------------------+------------+----------------------
tenant_isolation  | ALL        | (tenant_id::text = current_setting...
```

### 3. Validación post-deploy (5 min)

```bash
docker compose exec -T db psql -U eva360 -d eva360 \
  < apps/api/src/database/sql/2026-04-27-F4B-validate-rls.sql
```

Buscar en el output:
- `✓ OK` en el test 5 (aislamiento per-tenant).
- `✓ OK: cross-tenant UPDATE bloqueado` en el test 6.

Si cualquier test muestra `FAIL`, ir directo al paso 6 (rollback).

### 4. Smoke test funcional (10 min)

Validar manualmente desde el frontend:
- [ ] Login como `tenant_admin` de un tenant cualquiera → entrar a `/evaluations` y ver respuestas existentes (debe verlas).
- [ ] Login como `super_admin` → entrar a `/admin/evaluations` y ver respuestas de varios tenants.
- [ ] Crear nueva respuesta a una evaluación pendiente → verificar que se guarda y aparece en el dashboard.
- [ ] Cron `recognition.calculateMvpOfTheMonth` (lo más reciente que toca evaluation_responses indirectamente): verificar logs del API para confirmar que no se rompió el cron mensual del 1°.

### 5. Monitoreo de 24-48h

- **Sentry**: revisar cualquier error nuevo. Filtros: `tenantId tag` + `error.message contains "row-level security" or "no rows"`.
- **Performance**: revisar latencia de queries a `evaluation_responses`. RLS añade un filtro `AND tenant_id = ?` automático; con el índice `idx_eval_response_tenant` el costo debe ser cercano a cero.
- **Logs del API**: buscar mensajes `set_config failed` (indicaría que el interceptor no está seteando el GUC correctamente).
- **Consultas de soporte**: si algún cliente reporta "no veo mis evaluaciones", investigar si su sesión tiene el JWT correcto (debe tener `tenantId` válido).

### 6. Rollback (si algo se rompe)

**Cuando**: errores 500 masivos, evaluaciones invisibles para clientes legítimos, cron jobs fallando con "0 rows affected" cuando deberían modificar filas.

```bash
docker compose exec -T db psql -U eva360 -d eva360 \
  < apps/api/src/database/sql/2026-04-27-F4B-rollback-rls-evaluation-responses.sql
```

El rollback toma <1s (drop policy + disable RLS). El servicio vuelve al estado pre-Fase B inmediatamente, sin reiniciar el API.

Después de rollback:
- Documentar la causa raíz en un postmortem.
- Reabrir el plan F4 para ajustar la policy o el setup.

## Trade-offs aceptados

1. **Latencia +1-2ms por query**: Postgres evalúa la policy en cada SELECT/UPDATE/DELETE. Con índice sobre `tenant_id`, el costo es despreciable.

2. **Conexiones admin sin context ven 0 filas**: cualquier `psql` directo necesita `set_config('app.current_tenant_id', '', true)` al inicio. Documentado arriba.

3. **Defense-in-depth incompleto**: solo `evaluation_responses` está protegido. Las otras 65 tablas con `tenant_id` siguen sin RLS. Esto se completa en Fase C.

4. **Audit log de cron failures puede perderse**: si un cron Tier 2/3 falla dentro de `runForEachTenant`, la tx hace rollback y el `cron.failed` audit no persiste. Trade-off conocido y documentado en `reminders.service.ts`. Sentry sigue capturando.

## Próximos pasos

Si Fase B está estable durante 24-48h en producción:
- **Fase C**: roll out RLS a las 65 tablas restantes (4-6h, una migration grande). Mismo patrón.
- **Fase D**: cleanup. Quitar filtros `WHERE tenantId = ?` redundantes en queries TypeORM (ya RLS los enforza). Test de penetración: simular bug donde dev olvida el filtro y verificar que RLS lo bloquea.

## Referencias

- Plan general: [`docs/F4-RLS-PLAN.md`](./F4-RLS-PLAN.md)
- Postgres RLS docs: <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>
- Anti-patterns RLS: <https://supabase.com/docs/guides/auth/row-level-security#example-policies>
