# Reset de plantillas + ciclos · DEMO Company

Procedimiento para limpiar todas las plantillas y ciclos del tenant
**DEMO Company** y luego generar un pool de ciclos (uno por plantilla,
con estados rotando entre `draft`, `active` y `closed`).

> Las plantillas las creas tú desde la UI por rol/cargo. Estos scripts
> sólo borran datos y luego crean ciclos a partir de lo que encuentren.

---

## 1) Limpieza — borra plantillas + ciclos (idempotente)

Borra `form_templates`, `form_sub_templates`, `evaluation_cycles` y todas
sus dependencias (assignments, responses, stages, snapshots, calibration,
ai_insights de ciclos, etc.) del tenant DEMO Company.

**Preserva:** usuarios, departamentos, organigrama, competencias,
objetivos/OKRs, posiciones, notificaciones. Los `development_plans` se
desligan del ciclo (`cycle_id → NULL`) pero no se borran.

```bash
# Copiar SQL al contenedor de la BD
docker compose cp \
  apps/api/src/database/sql/clear-demo-company-templates-and-cycles.sql \
  db:/tmp/

# Ejecutar
docker compose exec -T db psql -U eva360 -d eva360 \
  -f /tmp/clear-demo-company-templates-and-cycles.sql
```

El script imprime un resumen antes/después y termina mostrando los
contadores remanentes (deben ser `0`).

---

## 2) Crear plantillas — manual, desde la UI

Inicia sesión como `admin` del tenant DEMO Company y crea las
plantillas necesarias por rol/cargo desde
`/dashboard/plantillas`. Asegúrate de:

- Marcar cada plantilla como `Published` (no Draft).
- Configurar `default_cycle_type` (90/180/270/360) o incluir el grado en
  el nombre (ej. `Líder — 360°`) — el seed lo detecta por el nombre si
  el campo está vacío.
- Configurar `form_sub_templates` (los pesos por relación) si quieres
  ciclos `active`/`closed` con scoring realista.

---

## 3) Generar un ciclo por plantilla — estados rotando

```bash
# Build previo (si aplica)
docker compose exec api npm run build

# Ejecutar el seed
docker compose exec api node dist/database/seed-demo-cycles-by-template.js
```

O en desarrollo local:

```bash
DATABASE_URL=postgres://eva360:...@localhost:5432/eva360 \
  npx ts-node apps/api/src/database/seed-demo-cycles-by-template.ts
```

### Qué hace

- Busca todas las plantillas `published` del tenant DEMO Company.
- Por cada plantilla crea **un ciclo** con prefijo `[POOL]` en el nombre.
- Rota estados en el orden `closed → active → draft` (ej. con 6
  plantillas: 2 closed, 2 active, 2 draft).
- `closed`: assignments + respuestas al ~85%.
- `active`: assignments creados, ~50% completados.
- `draft`: sin assignments (igual que un borrador real).
- Idempotente: limpia primero todos los ciclos previos con prefijo
  `[POOL]` antes de crear los nuevos.

### Variables de entorno opcionales

| Variable              | Default            | Descripción                                  |
|-----------------------|--------------------|----------------------------------------------|
| `POOL_PREFIX`         | `[POOL]`           | Prefijo del nombre del ciclo                 |
| `CYCLE_PERIOD`        | `quarterly`        | `quarterly`, `biannual`, `annual`, `custom`  |
| `CYCLE_START_DATE`    | hoy − 30 días      | Fecha base de inicio (YYYY-MM-DD)            |
| `CYCLE_DURATION_DAYS` | `60`               | Duración en días de cada ciclo               |

---

## 4) Verificación

Desde la UI: `/dashboard/evaluaciones` debería mostrar tantos ciclos
como plantillas published existan, distribuidos entre `BORRADOR`,
`ACTIVO` y `CERRADO`.

Desde SQL:

```sql
SELECT name, type, status, start_date, end_date
FROM evaluation_cycles c
JOIN tenants t ON t.id = c.tenant_id
WHERE t.slug = 'demo' OR t.name ILIKE '%demo%company%'
ORDER BY status, start_date;
```
