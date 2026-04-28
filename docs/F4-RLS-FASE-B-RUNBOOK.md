# F4 Fase B — Runbook operacional

Activación de Row-Level Security en `evaluation_responses` (primer cutover).

## Pre-requisitos (verificar antes de empezar)

- [ ] F4 Fase A0–A3 mergeadas a main y desplegadas en producción.
- [ ] **CRÍTICO — Role separation aplicado**: ver sección "Role separation" abajo. Sin esto, RLS es decorativa porque la app conecta como `eva360` (SUPERUSER) y el superuser tiene `BYPASSRLS` automático.
- [ ] Backup reciente de la BD (`pg_dump` exitoso en las últimas 24h, ejecutado con `eva360` que es superuser → backup completo).
- [ ] Ventana de mantenimiento aprobada (impacto esperado: <30s de queries lentas mientras se cambia el plan; sin downtime).
- [ ] Acceso SSH al VPS Hostinger.
- [ ] Operador presente para ejecutar rollback si algo falla.

## Role separation (paso intermedio crítico antes del SQL RLS)

### Por qué

`postgres:16-alpine` con `POSTGRES_USER=eva360` crea ese role como **SUPERUSER**. Cualquier query del rol superuser bypasea RLS automáticamente — la policy `tenant_isolation` se evalúa pero el privilegio del rol la salta.

Por lo tanto, **aplicar `2026-04-27-F4B-enable-rls-evaluation-responses.sql` solo, sin separar roles, no protege nada**. La aplicación seguiría leyendo cross-tenant si una query olvida el filtro `WHERE tenant_id = ?`.

### Solución: dos roles separados

| Rol | Atributos | Uso |
|---|---|---|
| `eva360` (existente, no se toca) | SUPERUSER, LOGIN | Backups, migrations, scripts admin |
| `eva360_app` (nuevo) | LOGIN, **NO SUPERUSER**, CONNECT, USAGE, INSERT/SELECT/UPDATE/DELETE en todas las tablas | La app (DATABASE_URL) |

`eva360_app` es non-superuser → RLS le aplica → policies efectivas.
`eva360` queda intacto como superuser → `pg_dump`/`pg_restore` no requieren cambio.

### Pasos

1. **Aplicar la migration de role separation** (incluido en este commit):
   ```bash
   docker compose exec -T db psql -U eva360 -d eva360 \
     < apps/api/src/database/sql/2026-04-28-create-eva360-app-role.sql
   ```

   El script:
   - `CREATE ROLE eva360_app WITH LOGIN PASSWORD 'xxx' NOSUPERUSER`
   - `GRANT CONNECT ON DATABASE eva360 TO eva360_app`
   - `GRANT USAGE ON SCHEMA public TO eva360_app`
   - `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eva360_app`
   - `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eva360_app`
   - `ALTER DEFAULT PRIVILEGES ...` para tablas/sequences futuras (cuando cleanup-orphans cree algo nuevo)

   La password se pasa via env var `EVA360_APP_PASSWORD` (settear en el `.env` antes de ejecutar).

2. **Cambiar `DATABASE_URL` en `.env` del VPS**: del role `eva360` al role `eva360_app`:
   ```bash
   # Antes:
   DATABASE_URL=postgresql://eva360:<password-eva360>@db:5432/eva360
   # Después:
   DATABASE_URL=postgresql://eva360_app:<password-eva360-app>@db:5432/eva360
   ```

3. **Restart del API** (sin rebuild):
   ```bash
   docker compose restart api
   ```

4. **Smoke test**: login + ver dashboard. Si todo funciona, la app ya conecta como `eva360_app`.

5. **Validar privilegios**:
   ```bash
   docker compose exec -T db psql -U eva360 -c \
     "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('eva360', 'eva360_app');"
   ```
   Esperado:
   ```
    rolname    | rolsuper | rolbypassrls
   ------------+----------+--------------
    eva360     | t        | t
    eva360_app | f        | f
   ```

6. **Recién ahora aplicar la migration de RLS** (siguiente sección).

### Rollback role separation (si algo falla)

```bash
# Revertir DATABASE_URL al rol eva360 superuser
sed -i 's/eva360_app:/eva360:/' /docker/eva360/.env
docker compose restart api

# (Opcional) eliminar el rol nuevo
docker compose exec -T db psql -U eva360 -d eva360 \
  < apps/api/src/database/sql/2026-04-28-drop-eva360-app-role.sql
```

## Decisión arquitectónica clave

**FORCE ROW LEVEL SECURITY** + **role separation**: la migración SQL activa `FORCE`. Sin separación de roles, el user que conecta como SUPERUSER bypasea la policy automáticamente y RLS sería decorativo.

Con role separation aplicado (sección anterior):

- `eva360_app` (app): NOT SUPERUSER → RLS aplica → policy filtra correctamente.
- `eva360` (admin/backups): SUPERUSER → BYPASSRLS automático → backups y migrations funcionan sin cambios.

**Consecuencia para conexiones admin sin GUC**: `psql -U eva360_app -c "..."` directo verá 0 filas en evaluation_responses (porque el GUC no está seteado). Operadores deben usar:

- `psql -U eva360 ...` (admin superuser) para queries cross-tenant.
- `psql -U eva360_app -c "SELECT set_config('app.current_tenant_id', '', true); ..."` para emular "modo system" como app.

La app vía `TenantContextInterceptor` (cada request HTTP) y los crons vía `TenantCronRunner` (Fase A3) ya setean el GUC correctamente — no requieren cambios.

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
