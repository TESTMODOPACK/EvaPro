# EvaPro / Eva360 — Auditoría Técnica v2.0 y Plan Mobile App

> Documento generado el 2026-04-11. Autor: revisión técnica asistida por Claude Opus 4.6 sobre el código actual del repositorio (`develop` @ commit `d6b8eae`), complementada con tres agentes especializados (backend, frontend, data/devops) que leyeron >80 archivos entre ambos apps.
>
> Destinatario: Ricardo Ascenda (founder). Para uso interno, no cliente-facing.

---

## Tabla de contenidos

**PARTE 1 — Auditoría técnica y plan de v2.0**
- 1.1 Resumen ejecutivo
- 1.2 Hallazgos críticos (los 7 que hay que resolver antes de abrir la plataforma a >20 clientes)
- 1.3 Auditoría Backend (NestJS + TypeORM)
- 1.4 Auditoría Frontend (Next.js 14)
- 1.5 Auditoría Datos / Infraestructura / DevOps
- 1.6 Calidad y testing
- 1.7 Roadmap v2.0 priorizado
- 1.8 Estimación de esfuerzo y equipo

**PARTE 2 — Estrategia App móvil**
- 2.1 ¿Por qué una app móvil para EvaPro?
- 2.2 Opciones técnicas (PWA / Capacitor / React Native / Flutter / Nativo)
- 2.3 Comparativa detallada
- 2.4 Recomendación
- 2.5 Plan de implementación fase por fase
- 2.6 Timeline, presupuesto, riesgos
- 2.7 MVP móvil: qué vistas sí, qué vistas no

---

# PARTE 1 — AUDITORÍA TÉCNICA Y PLAN DE v2.0

## 1.1 Resumen ejecutivo

EvaPro es un **MVP funcional y bien arquitecturado a nivel de dominio** (evaluaciones 360°, OKRs, reconocimiento, PDI, encuestas de clima, subscripciones, IA). El backend es NestJS + TypeORM + PostgreSQL, el frontend Next.js 14 App Router. Ya hay multi-tenant con defensa en profundidad, JWT + 2FA, integración con Claude (Anthropic) para insights, manifest PWA y service worker básico.

**La verdad incómoda**, sin embargo, es que hoy está en **estado "startup / demo"**, no "enterprise-ready":

- **Cobertura de tests ≈ 0%** (1 spec.ts en todo el repo).
- **Sin observabilidad**: no hay Sentry, no hay logs estructurados, no hay métricas, no hay health check.
- **Seeding destructivo en cada arranque del contenedor** (justo lo que causó el bug del add-on IA hoy). Ya arreglado en el commit `d6b8eae`.
- **Sin sistema formal de migraciones** — se confía en scripts SQL ad-hoc y en `synchronize:false`.
- **Páginas monolíticas**: 10 páginas del frontend superan las 1000 líneas (la más grande, `objetivos/page.tsx`, tiene **2338 líneas**).
- **Token JWT en `localStorage`** (vulnerable a XSS).
- **31 endpoints** sin `@Roles` guard en el controller: cualquier usuario autenticado puede llamar operaciones de escritura sensibles.
- **N+1 queries** en reports que con un tenant de 1000 empleados hace 1000+ consultas extra.
- **Sin límites de memoria en Docker** (VPS puede morir por OOM).
- **Sidebar fijo de 260px sin collapse** → inutilizable en móvil.

Ninguno de estos puntos es existencial individualmente; **en conjunto** definen el salto de "demo a vendibles" que es v2.0. La estimación de esfuerzo para cerrar todo lo crítico + alto es **8–12 semanas de un equipo de 2 ingenieros senior** (backend + full-stack). Detallado en §1.7 y §1.8.

La buena noticia: **el modelo de dominio, los entities, la lógica de negocio y la UX están bien**. No hay que reescribir — hay que endurecer. Mucho del trabajo es "deuda técnica disciplinada", no redesign.

---

## 1.2 Hallazgos críticos (Top 7)

Los ordeno por **impacto × probabilidad**, no por esfuerzo.

### C1 — Seeding destructivo en cada deploy  ✅ YA ARREGLADO (`d6b8eae`)

**Descripción:** `apps/api/Dockerfile:26` ejecuta `seed.js && seed-demo-full.js && main.js` en cada arranque. Ambos scripts sobrescribían la suscripción del tenant demo (forzaban `planId`, `aiAddonCalls`, `status`). Cualquier cambio hecho por el admin vía UI se revertía al siguiente push.

**Impacto real observado:** el usuario canceló el add-on IA → al día siguiente reapareció +50 créditos porque el contenedor se reinició.

**Fix:** ambos bloques ahora son no-op si la suscripción ya existe (solo bootstrapean en el primer deploy). Fix commiteado en `d6b8eae`.

**Lección:** el seeding en startup del contenedor es un antipatrón. Debe migrarse a **scripts manuales** o **migraciones formales** (TypeORM migrations, Flyway, etc.) — ver §1.5.

---

### C2 — 31 endpoints sin autorización explícita

**Descripción:** Muchos controllers tienen `@UseGuards(AuthGuard('jwt'))` a nivel de clase (OK, requiere login) pero **no usan `@Roles(...)`** en endpoints de escritura, por lo que **cualquier usuario autenticado** (incluso `employee`) puede crear/modificar/eliminar recursos administrativos.

**Archivos afectados (muestra):**
- `contracts.controller.ts:55,67` → `create`, `update`
- `dei.controller.ts:42,53,61` → config + acciones correctivas
- `tenants.controller.ts:205,211,216` → crear tenant, bulk onboard, update
- `recruitment.controller.ts:24,40,51` → crear procesos
- `org-development.controller.ts` → 6 endpoints sin guard
- `reports/kpi.controller.ts:117,123` → crear/editar KPIs

**Explotación:** en la UI un usuario employee no ve estos botones, pero cualquier atacante con credenciales válidas puede llamar los endpoints directos con `curl`. Riesgo de privilege escalation trivial.

**Fix:** pasar `@Roles('super_admin', 'tenant_admin')` a todos los `@Post/@Patch/@Put/@Delete` en esos controllers. 1–2 horas de trabajo, máximo una tarde auditando los 31.

**Prioridad:** CRÍTICA. **Esfuerzo:** bajo.

---

### C3 — JWT en `localStorage` (XSS-exposable)

**Descripción:** `apps/web/src/store/auth.store.ts:50` persiste el token JWT en `localStorage` via zustand persist. Cualquier XSS —incluso uno que ocurra una sola vez en dev— exfiltra el token. Es el antipatrón #1 del OWASP Top 10 cliente-side.

**Mitigaciones actuales:** ninguna (no hay CSP, no hay sanitización agresiva, hay 3 `dangerouslySetInnerHTML` en el código).

**Fix recomendado:**
1. Cambiar el endpoint `/auth/login` del backend para setear una **cookie `httpOnly; Secure; SameSite=Strict`** con el token en lugar de devolverlo en el body.
2. El frontend deja de tocar el token — las llamadas a la API llevan la cookie automáticamente via `credentials: 'include'`.
3. Agregar un CSRF token para mutaciones.
4. En `next.config.mjs`: configurar `Content-Security-Policy` con `default-src 'self'` + allowlist de Render/Anthropic.

**Esfuerzo:** 1 semana (requiere cambios en auth del backend, store del frontend, y testing end-to-end del flujo de login/2FA).

**Prioridad:** CRÍTICA para compliance y clientes enterprise. Alta si atacante específico.

---

### C4 — Sin observabilidad (logs, errores, métricas, health)

**Descripción:**
- **No hay Sentry / Bugsnag / Datadog** → los errores en prod son invisibles.
- **Logs mezclan `console.log` y `Logger` de NestJS** → no estructurados, imposible consultar por tenant / usuario / request-id.
- **No hay `/health` endpoint** → el proxy (Nginx, Render) puede rutear a API muerto.
- **No hay `enableShutdownHooks()`** → requests en vuelo se pierden en cada deploy.
- **No hay métricas** (Prometheus, StatsD) → autoscaling ciego, capacity planning imposible.

**Impacto:** cuando un cliente reporte un bug en prod, el desarrollador tendrá que pedirle capturas y reproducirlo localmente porque **no hay forma de leer el stack trace**. En un SaaS esto es inaceptable más allá de 3–5 clientes.

**Fix mínimo para v2.0:**
1. Sentry SDK en `main.ts` (backend) + `layout.tsx` (frontend) — 1 día.
2. `LoggerService` estructurado con `pino` o winston, JSON output, incluir `tenantId`, `userId`, `requestId` — 2 días.
3. Endpoint `/health` con check de DB — 1 hora.
4. `app.enableShutdownHooks()` — 5 minutos.
5. Graceful shutdown en Docker Compose (`stop_grace_period: 30s`) — 5 minutos.
6. (Opcional v2.1) `/metrics` Prometheus + Grafana — 1 semana.

**Prioridad:** CRÍTICA. **Esfuerzo:** 1 semana para lo mínimo.

---

### C5 — N+1 queries en `reports.service.ts` y `analytics.service.ts`

**Descripción:** Bucles `for (const x of items) { await this.repo.findOne(...) }` dentro de reports. Ejemplos:

- `reports.service.ts:213-220` — `cycleSummary` itera sobre todos los assignments y hace una query por usuario.
- `analytics.service.ts:65-90` — loop sobre plans sin pre-cargar relaciones.
- `reports.service.ts:288, 334, 369` — múltiples loops equivalentes.

**Impacto:** un tenant de 1000 empleados con un ciclo activo → 1000 queries extra en `/reports/cycle-summary`. Observable como timeouts > 5s en production.

**Fix:** reemplazar los loops por:
```ts
const assignments = await this.assignmentRepo.find({
  relations: ['evaluatee', 'evaluator'],
  where: { cycleId, tenantId },
});
// iterar en memoria sin más queries
```
o usar `createQueryBuilder().leftJoinAndSelect()`.

**Esfuerzo:** 2–3 días (hay ~10–15 puntos de fix en total).

**Prioridad:** ALTA. Bloqueante para tenants > 500 empleados.

---

### C6 — Sin sistema de migraciones formal

**Descripción:** Hoy las migraciones viven como **scripts SQL idempotentes** en `apps/api/src/database/sql/*.sql` que hay que ejecutar a mano. No hay:
- Versionado (`001_init.sql`, `002_...`).
- Reverse migrations (rollback).
- Tabla `migrations` que tracke qué se ejecutó.
- Orden garantizado.

En dev se confía en `synchronize: true` (TypeORM crea el schema automáticamente); en prod está deshabilitado, pero no hay un reemplazo formal. Cualquier cambio de schema requiere (1) editar el entity, (2) escribir el SQL a mano, (3) recordar ejecutarlo en cada entorno.

**Fix:** adoptar **TypeORM migrations** (`typeorm migration:generate`) o **node-pg-migrate**. Todas las migraciones pasadas ad-hoc deben convertirse a archivos versionados y la tabla `migrations` debe inicializarse con su historia.

**Esfuerzo:** 1 semana (migrar el histórico + pipeline CI).

**Prioridad:** ALTA. Impide crecimiento ordenado.

---

### C7 — Páginas frontend monolíticas + no-responsive

**Descripción:** 10 páginas del frontend superan las 1000 líneas de código:

| Archivo | Líneas |
|---|---|
| `dashboard/objetivos/page.tsx` | 2338 |
| `dashboard/page.tsx` | 1884 |
| `dashboard/usuarios/page.tsx` | 1802 |
| `dashboard/evaluaciones/[id]/page.tsx` | 1570 |
| `dashboard/desarrollo/page.tsx` | 1524 |
| `dashboard/subscriptions/page.tsx` | 1364 |
| `dashboard/desarrollo-organizacional/page.tsx` | 1260 |
| `dashboard/postulantes/[id]/page.tsx` | 1238 |
| `dashboard/reconocimientos/page.tsx` | 1203 |
| `dashboard/feedback/page.tsx` | 1171 |

Cada una acumula 30+ `useState`, lógica de API, filtros, paginación, modales, formularios y estilos inline en un mismo archivo. Esto genera:

1. **Re-renders masivos** (todo el árbol re-renderiza ante cualquier cambio de estado).
2. **Mantenimiento exponencial** — añadir una feature nueva toma horas porque hay que navegar el archivo entero.
3. **Imposible testear** unidad por unidad.
4. **Bundle pesado en primer paint**.

**Adicional:** el sidebar fijo de `260px` sin collapse hace que en móvil las páginas sean inutilizables (el sidebar ocupa 70% del viewport de 375px).

**Fix:**
1. Refactor por dominio: cada página grande se parte en 3–6 componentes (`ObjetivosList.tsx`, `ObjetivosFilters.tsx`, `ObjetivoFormModal.tsx`, `ObjetivosTreeView.tsx`).
2. Sidebar collapsible con drawer en `< 768px`.
3. Media queries consistentes, tablas responsive con grid o cards.

**Esfuerzo:** 3–4 semanas de un full-stack dedicado.

**Prioridad:** ALTA para mobile + mantenimiento. MEDIA si nunca se saca la app móvil.

---

## 1.3 Auditoría Backend

### Bueno — lo que está bien hecho

- **Multi-tenancy con defensa en profundidad:** después de los últimos commits (`7a131d5`, `7932d73`), todas las queries críticas en `reports`, `talent`, `objectives`, `development`, `feedback`, `recognition`, `analytics`, `audit`, `notifications/reminders` tienen el guard `u.tenant_id = parent.tenant_id` en los JOINs. Ya se cerró el leak del caso Rodrigo Monasterio.
- **Transacciones robustas** en operaciones financieras/balance: `recognition.service.ts:718-756` (redeem con checks de balance), `recognition.service.ts:804-841` (refund), `evaluations.service.ts` con atomic updates.
- **Bcrypt con cost=12** — `auth.service.ts:197,221`. Correcto.
- **2FA implementado** vía TOTP — `auth.service.ts:240-267`. Bien hecho, con `crypto.randomBytes(20)`.
- **Rate limiting en login** — `auth.controller.ts:34-84`. 5 intentos → 15 min bloqueado.
- **Upload con MIME + size validation** — `uploads.service.ts:4-48`. 10MB, lista blanca de tipos, Cloudinary authenticated.
- **Secretos vía `process.env`** — no hay API keys hardcodeadas.
- **Feature flags por plan (`@Feature(PlanFeature.X)`)** — buen patrón para gating por suscripción.

### Malo — deuda técnica y bugs latentes

- **Validación DTO inconsistente:** 31 endpoints aceptan `@Body() dto: any` sin class-validator. Ver §C2 arriba.
- **N+1 queries** en reports/analytics. Ver §C5.
- **forwardRef circular** entre `SubscriptionsService ↔ NotificationsService`, `InvoicesService ↔ EmailService`. 10 instancias totales. Señal de acoplamiento alto. Mitigación: event-driven (usar `@nestjs/event-emitter`).
- **Servicios gigantes:**
  - `reports.service.ts`: 2252 líneas.
  - `evaluations.service.ts`: 1566 líneas.
  - `ai-insights.service.ts`: 1566 líneas.
  Solución: dividir en sub-servicios por responsabilidad (ya existe `ExecutiveDashboardService`, seguir el patrón).
- **PDF/Excel/AI inline en el request-response cycle:**
  - `invoices.service.ts:450-540` — `generatePdf` corre `jspdf` sincrónicamente.
  - `surveys.service.ts` — exports `xlsx` grandes dentro del handler HTTP.
  - `ai-insights.service.ts` — llamadas a Claude (hasta 30s latencia) dentro del handler.
  - **Impacto:** event loop bloqueado, timeouts en clientes, OOM bajo carga.
  - **Fix:** cola de trabajos (BullMQ + Redis). Los endpoints encolan y devuelven un `jobId`; el cliente pollea `/jobs/:id`.
- **Sin rate limiting** en `/auth/request-reset` y `/auth/reset-password` — bruteforceables.
- **CORS permisivo:** `main.ts:41` refleja cualquier origen si `FRONTEND_URL` está vacío. Con `credentials: true` → CSRF vulnerable.
- **PII en logs:** `feedback.service.ts:427` hace `console.log(email)`. Sin log retention policy eso termina en disco meses.
- **`rejectUnauthorized: false`** en config de DB (`database.module.ts`) — TLS sin verificar cert. Aceptable si Render es trusted, bad practice en general.
- **Sin versionado de API** — no hay `/v1/...`. Al sacar v2 habrá breaking changes inevitables.
- **`synchronize: true` en dev** — cada vez que el dev clona el repo TypeORM altera el schema automáticamente. Peligroso para un equipo.

### Feo — cosas que huelen pero no están rotas (aún)

- 10 `forwardRef()` indican ciclos de dependencia. Hoy funciona; en v2.0 reemplazar por event bus.
- No hay cache (Redis, in-memory). Cada reporte recalcula. Aceptable hoy; tenants grandes lo van a sufrir.
- `ReflectMetadata` en dev depende del orden de imports. Si alguien mueve un decorador puede romperse.

---

## 1.4 Auditoría Frontend

### Bueno

- **App Router + layouts limpios.** Solo 2 layouts totales (root + dashboard). Buena separación.
- **State management bien pensado:** Zustand para UI state (auth, locale, toast), React Query para server state. Patrón maduro.
- **21 hooks personalizados** (`useEvaluations`, `useObjectives`, etc.) que encapsulan la lógica de data fetching. Perfecto para reutilizar en mobile.
- **i18n en 3 idiomas** (`es`, `en`, `pt`) con `react-i18next`. Cambio dinámico de idioma en topbar.
- **PWA básico ya existe:** `manifest.json`, `sw.js` con offline fallback, iconos 192/512, theme color.
- **Skeletons reutilizables:** `PageSkeleton`, `CardsSkeleton`, `TableSkeleton`, `ListSkeleton`.
- **TypeScript strict habilitado**.
- **Design tokens consistentes:** `var(--accent)`, `var(--bg-surface)`, `var(--text-muted)`, etc.
- **ConfirmModal custom** en 139 lugares (mejor que `window.confirm()`).

### Malo

- **Páginas monolíticas**: 10 > 1000 líneas. Ver §C7.
- **1456 ocurrencias de `any`** en 72 archivos. El campeón es `lib/api.ts` con 293. Hace que refactors grandes sean peligrosos.
- **Strings hardcodeadas en español** mezcladas con i18n: ~95 strings encontradas. Usuario en inglés/portugués ve mezcla.
- **14 `window.confirm()` nativos** (deberían ser `<ConfirmModal>`).
- **100+ botones con solo emojis** sin `aria-label` → inaccesibles para screen readers.
- **100 instancias de `key={i}` o `key={index}`** en listas → React pierde identidad al filtrar/reordenar.
- **Sin memoización**: 0 usos de `React.memo`, 0 `useMemo`, 8 `useCallback` en toda la app. Re-renders evitables por todos lados.
- **Fetch directo en `useEffect`** en páginas de analytics: ~10 instancias fuera de React Query, sin cache, sin dedupe, sin retry.
- **Sin code splitting real:** `recharts` (85KB gzip), `xlsx` (140KB gzip), `jspdf` importados estáticamente en páginas que no siempre los usan.
- **Sin `next/image`**: 0 usos. Pérdida de optimización automática.
- **Listas 1000+ filtradas cliente-side** en `usuarios/page.tsx`. Lag en tenants grandes.

### Feo — problemas de UX móvil

- **Sidebar fijo de 260px** sin collapse en viewport `< 768px` → inutilizable.
- **Tablas con 7+ columnas** sin diseño responsive → horizontal scroll eterno.
- **Targets de touch < 44px** en muchos botones (recomendación de Apple HIG es 44×44).
- **Solo 5 `@media` queries** en todo el CSS — mobile-first ausente.
- **Service worker muy básico**: cachea assets, pero no sincroniza datos offline ni tiene background sync.

### Seguridad cliente

- **JWT en localStorage** → XSS-exposable. Ver §C3.
- **3 `dangerouslySetInnerHTML`** — los 3 usan texto controlado (i18n + emojis HTML), riesgo bajo pero mejora posible con `<span>{t(...)}</span>` + CSS.
- **Sin CSP headers** en `next.config.mjs`.

---

## 1.5 Auditoría Datos / Infraestructura / DevOps

### Schema PostgreSQL

**Bueno:**
- Índices presentes en columnas críticas: `idx_users_tenant`, `idx_sub_tenant_status`, `idx_cycles_tenant_status`, `idx_devaction_plan_status`, `idx_user_points_summary_total`.
- Foreign keys con `CASCADE` correcto en relaciones padre-hijo (DevelopmentPlan → Actions, EvaluationCycle → Stages, Objective → KeyResults, etc.).
- Bigint transformer para contadores sensibles (`subscriptions.ai_addon_calls`, `user_points.points`, `user_points_summary.*`).
- `@CreateDateColumn` + `@UpdateDateColumn` en tablas mutables.
- `tenant_id` en todas las tablas tenant-scoped, con índices compuestos.
- Tabla `audit_logs` dedicada con índice por tenant+fecha.

**Malo — índices faltantes:**
- `evaluation_responses.assignment_id` sin index (solo unique FK).
- `user_points.source` sin index (usado en agregaciones).
- `survey_responses.respondent_id` sin index.
- `objective_update.objective_id` sin index explícito.
- `key_result.objective_id` idem.

**Malo — JSONB sin schema validation:**
- `tenants.settings` (TenantSettings)
- `evaluation_cycles.settings`
- `evaluation_responses.answers` (estructura por pregunta, documentada solo en comentario)
- `survey_responses.answers`
- `audit_logs.metadata`
Todas confían en TypeScript types; no hay validación runtime. Un bug en el frontend puede insertar JSON malformado y nadie se entera hasta que el report lo lee.

**Inconsistencia de soft delete:**
- Patrón 1: `isActive: boolean` (sin timestamp) — Users, Tenants, Departments, Badges.
- Patrón 2: `deactivated_at: timestamp` (agregado en `2026-04-10`) — Departments nuevos, Positions, Competencies.
- Patrón 3: cascade real (Evaluations).
- Ambos patrones coexisten. Se necesita una **decisión** y **migración unificadora**.

**Multi-tenant maturity:**
- Todo en mismo schema con `tenant_id` (no schema-per-tenant).
- Sin Row-Level Security de Postgres → confía en la app layer.
- 1 pool de conexiones global.
- **Capacidad estimada actual:** 50 tenants × 500 users = 25K users antes de degradación visible. Más allá de eso, el pool del Render Starter plan se satura.

### Migraciones

**Estado actual:**
- No hay carpeta `/migrations` formal.
- Scripts SQL idempotentes en `apps/api/src/database/sql/` (ej. `2026-04-10-indexes-and-status.sql`).
- Scripts de seed + schema-sync en `apps/api/src/database/seed.ts`, `seed-demo-full.ts`, `schema-sync.ts`.

**Problema:** las migraciones SQL ad-hoc no están versionadas. No hay forma automática de saber qué migración está aplicada en qué entorno. Ya hice 5+ migraciones manuales que tuve que ejecutar "cuando me acuerde" en Hostinger.

**Fix:** adoptar TypeORM migrations formales (`typeorm migration:generate`, tabla `migrations`, `migration:run` en el pipeline de Render).

### Docker / Deployment

- **`docker-compose.yml`:** servicios separados (db + api + web + nginx), healthcheck en DB (`pg_isready`), volumen persistente, restart `unless-stopped`. BIEN.
- **FALTA** `mem_limit` y `cpus` — en el VPS 2GB un pico de memoria puede matar todo el stack. **CRÍTICO**.
- **FALTA** healthcheck en API y Web → nginx rutea a contenedor muerto.
- **`Dockerfile` API**: multi-stage bien, pero el `CMD` ejecuta seeds en cada startup (ya arreglado en `d6b8eae`, pero el pattern sigue — debería quitarse del Dockerfile y moverse a script manual / migration).
- **`Dockerfile` web**: `--no-frozen-lockfile` debilita la reproducibilidad.
- **Ambos Dockerfiles** corren como root. `USER node` recomendado.
- **`main.ts`** bootstrap tiene CORS + security headers manuales (sin helmet), pero FALTA:
  - `enableShutdownHooks()`
  - Logger estructurado
  - Graceful shutdown
  - Rate limiting global

### CI/CD

**`.github/workflows/ci.yml`** existe:
- Checkout, pnpm install frozen, lint, test, build. BIEN.

**FALTA:**
- Test e2e (no existen).
- SAST (dependency scan, npm audit, Snyk, etc.).
- Deploy automático (se confía en Render/Netlify webhooks → hay riesgo de deploy sin pasar por CI).
- No hay branch protection visible (nadie bloquea merges sin CI green).

### Observabilidad

Reitero lo de §C4: **nula**. Ni logs estructurados, ni errores centralizados, ni métricas, ni health, ni tracing. Este es el hallazgo que más limita la capacidad de crecer.

### Backup & Disaster Recovery

**No existe** sistema formal. Render hace snapshots automáticos del plan Starter (frecuencia no documentada públicamente), pero:
- Sin scripts de backup manual (`pg_dump → S3`).
- Sin restore test.
- Sin RTO / RPO definidos.
- Sin documentación de DR.

Para v2.0, mínimo:
- Cron diario `pg_dump` + subida a S3/R2/Wasabi.
- Retención 30 días.
- Restore test mensual.
- RTO objetivo: 1 hora. RPO: 24 horas.

---

## 1.6 Calidad y testing

**Estado actual: 0.3% de cobertura aproximada.**

- `apps/api/`: 1 archivo `app.controller.spec.ts` (placeholder).
- `apps/web/`: 0 archivos de test.
- 0 tests e2e (Playwright, Cypress).
- Jest configurado, pero sin `coverageThreshold`.

**Implicaciones:**
- Cualquier refactor grande es peligroso — nadie valida regresiones.
- La auditoría de seguridad multi-tenant es imposible de verificar automáticamente (¿qué garantiza que un nuevo endpoint aplica filtro de `tenantId`? solo "el desarrollador se acordó").
- Los cambios de scale (bigint, denormalización, índices) no pueden validarse contra casos reales.

**Propuesta mínima v2.0:**
- **Tests unitarios** en servicios de dominio críticos: `AuthService`, `RecognitionService`, `EvaluationsService`, `SubscriptionsService`, `InvoicesService`. Cobertura objetivo: **60%** en servicios, 30% global.
- **Tests e2e** con Playwright: 10–15 escenarios principales (login, crear evaluación, responder, calibración, canjear recompensa, generar factura, cancelar add-on — exactamente los que rompen en prod).
- **Jest `coverageThreshold`** en CI: fail si < 40% (inicial) subiendo a 60% en v2.1.

**Esfuerzo:** 3–4 semanas de 1 ingeniero dedicado.

---

## 1.7 Roadmap v2.0 priorizado

Propongo **3 fases** de 3–4 semanas cada una, entregables al cliente cada fase.

### Fase A — Seguridad + estabilidad (3 semanas)

Objetivo: cerrar los hallazgos que pueden causar un incidente en prod.

| # | Item | Severidad | Esfuerzo |
|---|---|---|---|
| A1 | ✅ Seeding destructivo (`d6b8eae`) | CRÍTICO | hecho |
| A2 | @Roles guards en 31 endpoints | CRÍTICO | 1 día |
| A3 | JWT → cookie `httpOnly` + CSRF | CRÍTICO | 1 semana |
| A4 | Rate limiting global + reset-password | ALTO | 1 día |
| A5 | CORS estricto + CSP headers | ALTO | 1 día |
| A6 | `/health` endpoint + graceful shutdown | ALTO | 1 día |
| A7 | Sentry + logs estructurados (pino/winston) | ALTO | 3 días |
| A8 | Docker `mem_limit` + healthchecks | ALTO | 1 día |
| A9 | Backup diario `pg_dump` → S3 | ALTO | 1 día |
| A10 | Quitar seeds del Dockerfile CMD | MEDIO | 1 día |

**Entregable:** EvaPro deployable con confianza a >20 clientes simultáneos.

---

### Fase B — Performance + escalabilidad (4 semanas)

Objetivo: soportar tenants de 1000+ empleados sin degradación.

| # | Item | Severidad | Esfuerzo |
|---|---|---|---|
| B1 | Arreglar N+1 en `reports.service.ts` y `analytics.service.ts` | ALTO | 3 días |
| B2 | Paginación obligatoria en listados (todos los `find()`) | ALTO | 3 días |
| B3 | BullMQ + Redis: queue para PDF, Excel, AI, emails | ALTO | 1 semana |
| B4 | Índices faltantes (6 columnas identificadas) | MEDIO | 1 día |
| B5 | Cache Redis para lookups estáticos (planes, competencias) | MEDIO | 2 días |
| B6 | Clustering Node.js (PM2 / `cluster` module) | MEDIO | 1 día |
| B7 | DB pool size + connection tuning | MEDIO | 1 día |
| B8 | Migraciones formales (TypeORM migration) | ALTO | 1 semana |
| B9 | Lazy load recharts/xlsx/jspdf en frontend | MEDIO | 2 días |

**Entregable:** capacidad comprobada para 200 tenants concurrentes con p95 < 500ms.

---

### Fase C — Mantenibilidad + UX (4 semanas)

Objetivo: bajar el costo de agregar features y prep para mobile app.

| # | Item | Severidad | Esfuerzo |
|---|---|---|---|
| C1 | Refactor páginas > 1000 líneas en componentes | ALTO | 2 semanas |
| C2 | Tests unitarios (60% cobertura en servicios críticos) | ALTO | 2 semanas |
| C3 | 10–15 tests e2e Playwright | ALTO | 1 semana |
| C4 | Sidebar responsive + media queries mobile-first | ALTO | 1 semana |
| C5 | Tablas responsive (grid/cards en móvil) | ALTO | 3 días |
| C6 | Migrar `any` a tipos concretos en `api.ts` | MEDIO | 1 semana |
| C7 | Strings hardcodeadas → i18n completo | MEDIO | 3 días |
| C8 | `aria-label` en botones-icono | MEDIO | 2 días |
| C9 | `window.confirm` → `<ConfirmModal>` | BAJO | 1 día |

**Entregable:** frontend listo para envolverse en Capacitor (prep para app móvil), testing automatizado, UX pulida.

---

### Fase D (opcional, post-v2.0) — Mobile App

Ver PARTE 2.

---

## 1.8 Estimación de esfuerzo y equipo

| Fase | Duración | Ingenieros | Horas totales |
|---|---|---|---|
| A — Seguridad + estabilidad | 3 semanas | 2 | 240h |
| B — Performance + escalabilidad | 4 semanas | 2 | 320h |
| C — Mantenibilidad + UX | 4 semanas | 2 | 320h |
| **Total v2.0** | **11 semanas** | **2 senior** | **880h** |

**Perfiles recomendados:**
- 1 **Backend senior NestJS/TypeORM** — dueño de fases A+B.
- 1 **Full-stack con experiencia en React/Next** — dueño de fase C + apoyo en A/B.

**Costo estimado (referencia LATAM):**
- Senior backend: USD 50–80/h.
- Full-stack: USD 45–70/h.
- **Total v2.0:** **USD 40–70K** (880h × mix de tarifas).

**Alternativa low-cost:** hacer solo Fase A en las próximas 3 semanas, posponer B y C a cuando el primer cliente enterprise lo exija. Fase A es lo mínimo-viable para no tener vergüenza de demostrar el producto.

---

# PARTE 2 — ESTRATEGIA APP MÓVIL

## 2.1 ¿Por qué una app móvil para EvaPro?

Antes de elegir tecnología, hay que validar **para qué**. En un SaaS B2B de performance management, la app móvil tiene tres audiencias distintas con distintos casos de uso:

### Audiencia 1 — Empleado (colaborador)
**Casos de uso alto-valor móvil:**
- Responder evaluaciones 360° (especialmente pares y reportes laterales que se desaniman en desktop).
- Responder encuestas de clima cortas (la tasa de respuesta en móvil es 30–40% más alta).
- Recibir y dar reconocimientos (feed tipo social + notificaciones push).
- Ver mi progreso de objetivos (dashboard personal).
- Recibir feedback rápido (quick feedback).
- Marcar check-ins con su jefe.
- Firmar electrónicamente PDI, evaluaciones, políticas.

**Valor alto:** push notifications para recordatorios de evaluaciones, encuestas, aprobaciones.

### Audiencia 2 — Manager / Jefe
**Casos de uso:**
- Aprobar pendientes (PDI, evaluaciones peer, objetivos).
- Ver 9-box de su equipo.
- Registrar check-ins 1:1.
- Responder feedback y comentarios.
- Ver alertas de empleados en riesgo.

**Valor medio.** Muchos managers usan desktop en la oficina. Móvil útil para "mientras viajo".

### Audiencia 3 — Admin RRHH / tenant-admin
**Casos de uso móviles:**
- Ver dashboards ejecutivos.
- Aprobar cosas.
- Revisar alertas.

**Valor bajo.** Admin casi siempre usa desktop. Reports, talent management, crear ciclos, importar usuarios → **no tiene sentido en móvil**.

### Conclusión estratégica

La app móvil **no debe ser una copia completa del sistema web**. Debe ser:
- **80% Audiencia 1** (empleados respondiendo / consumiendo).
- **15% Audiencia 2** (managers aprobando).
- **5% Audiencia 3** (KPIs rápidos para CEO/RRHH).

Esto es un cambio de scope crítico: **solo ~30-40% de las vistas del sistema actual deben portarse**. El resto se queda en web.

Comparativa de mercado: así es como lo hacen **Lattice, Culture Amp, 15Five, BetterWorks, Workday**. Todas tienen app móvil con una fracción de features respecto al desktop. **BetterWorks** es el caso más cercano a EvaPro — su app móvil hace solo: check-ins, objetivos personales, reconocimientos, feedback. El admin panel es 100% web.

---

## 2.2 Opciones técnicas

### Opción A — PWA pura (mejorar el service worker actual)

**Qué es:** la app web actual, pero con una experiencia mobile-first + install prompt + offline funcional + push notifications.

**Pros:**
- **0 código nuevo** — solo refactor responsive + mejora del SW existente.
- **0 app store review cycle** — instalable desde browser.
- **1 solo codebase** — cambio en web = cambio en mobile.
- **Actualización instantánea** (sin waiting for user update).
- EvaPro ya tiene `manifest.json` + `sw.js`, el 40% está hecho.

**Contras:**
- **No push notifications en iOS** hasta iOS 16.4 (casi todos tienen 16.4+ hoy, pero hay fricción).
- **No biometrics nativas** (Touch ID / Face ID) — el login se sigue haciendo con contraseña.
- **Sin presencia en App Store / Play Store** — el cliente enterprise busca el nombre y no lo encuentra, lo percibe como "no serio".
- **Sin acceso a cámara nativa robusta** (posible vía Web APIs pero limitado).
- **Descubrimiento bajo** — nadie "instala" PWAs sin que alguien le enseñe cómo.

**Esfuerzo:** 3–4 semanas (asumiendo que Fase C del roadmap v2.0 ya hizo el refactor responsive).

**Recomendado para:** MVP rápido, validar demanda, ahorrar en costo inicial.

---

### Opción B — Capacitor (wrap del web)

**Qué es:** [Capacitor](https://capacitorjs.com/) envuelve la app web en un WebView nativo + bridge para APIs nativas. Generas un APK (Android) y un IPA (iOS) con la misma codebase Next.js. Es lo que usan **Ionic**, **Stripe Terminal**, **Sworkit**.

**Pros:**
- **Reutiliza 100% del código actual de EvaPro web.** Los hooks, componentes, estilos, lógica — todo igual.
- **APIs nativas accesibles** via plugins: push notifications (Firebase), cámara, biometrics, storage seguro, geolocalización, archivos.
- **Presencia real en App Store / Play Store** — con su nombre, icono, reviews.
- **Performance "suficiente"** para una app de productividad (no es un juego).
- **Ecosistema Ionic** maduro, mucho soporte.
- **Hot reload en desarrollo** — casi tan rápido como web.
- **Soporta tanto Next.js SSR como SPA** (con Next.js es mejor exportar a estático con `next export`).

**Contras:**
- **No tan fluido como native** — scroll y transiciones se sienten "webbier". Usuario exigente lo nota.
- **Bundle más grande** — la app pesa 30-50 MB (vs 15 MB nativa).
- **Splash screen y navegación** hay que afinarlos manualmente.
- **Algunas APIs nativas** requieren plugins propios o custom.
- **Next.js SSR no funciona** — hay que usarlo como SPA (build estático). **Esto es importante: la configuración actual de EvaPro ya es SPA-like (todo es `'use client'`), así que el impacto es bajo**.

**Esfuerzo:** 4–6 semanas (asumiendo Fase C del roadmap v2.0 completa).

**Recomendado para:** balance costo/beneficio + tener presencia en stores + la mayoría del uso.

---

### Opción C — React Native (rewrite)

**Qué es:** reescribir el frontend en React Native. Código nuevo, compartiendo la lógica (hooks, api client, zustand) pero re-haciendo las vistas con `View`, `Text`, `StyleSheet`, `FlatList`, etc.

**Pros:**
- **Performance casi nativa** — es lo que usan Meta, Discord, Shopify.
- **Mejor UX móvil** — animaciones fluidas, gestos, transiciones nativas.
- **Reutilización parcial del código**: hooks, store, api client, tipos → ~30-40% del codebase.
- **Ecosistema gigante** — Expo, librerías maduras.

**Contras:**
- **2 codebases** — web + mobile. Cada feature se implementa dos veces.
- **Muchas dependencias no funcionan**:
  - `recharts` → reemplazar por `react-native-chart-kit` o `victory-native`.
  - `xlsx` → `rn-xlsx` (módulo nativo).
  - `jspdf` → `react-native-pdf-lib` o server-side.
  - Todo CSS inline (`style={{ ... }}`) → rewrite a `StyleSheet`.
  - 75+ SVG inline en Sidebar → rewrite.
- **No funciona con el código de layout actual de EvaPro** (no hay CSS Grid en React Native; es Flexbox puro + reglas propias).
- **Learning curve** si el equipo no sabe RN (debugging, dependencias nativas, Xcode, etc.).
- **Esfuerzo inicial muy alto.**

**Esfuerzo:** **16–20 semanas** para una versión mobile con paridad razonable (10-12 vistas principales).

**Recomendado para:** cuando el producto móvil justifica un team móvil dedicado y hay >1000 usuarios diarios activos.

---

### Opción D — Flutter

**Qué es:** rewrite completo en Dart + Flutter. 100% código nuevo, 0 reutilización con el web.

**Pros:**
- UX muy pulida, animaciones increíbles.
- Un único codebase Flutter sirve también para web y desktop (teoría).

**Contras:**
- **0% reutilización del código actual.** El equipo tendría que aprender Dart.
- **Bundle grande** (~20 MB mínimo).
- **Pocos desarrolladores** en LATAM comparado con React.
- **Sin ventaja concreta** sobre React Native para este use case.

**No recomendado para EvaPro** — el costo de aprender Dart + rewrite total no compensa el delta de calidad visual.

---

### Opción E — Nativo puro (Swift + Kotlin)

**Qué es:** dos codebases, Swift para iOS, Kotlin para Android.

**Pros:**
- **Mejor performance y UX posible.**
- Acceso completo a todas las APIs nativas.

**Contras:**
- **3 codebases** (web + iOS + Kotlin).
- **Tres veces el esfuerzo** de mantener features.
- Equipo triple.
- **Solo justificado** para productos con >10K daily active users y exigencias técnicas extremas (ej. apps de fitness, juegos, cámara profesional).

**No recomendado para EvaPro** — overkill total.

---

## 2.3 Comparativa detallada

| Criterio | PWA | Capacitor | React Native | Flutter | Nativo |
|---|---|---|---|---|---|
| **Reutilización código EvaPro** | 95% | 90% | 30% | 0% | 0% |
| **Esfuerzo inicial** | 3-4 sem | 4-6 sem | 16-20 sem | 20-24 sem | 30+ sem |
| **Esfuerzo mantenimiento** | 1x | 1.1x | 1.8x | 2x | 3x |
| **Push notifications iOS** | 16.4+ | Sí | Sí | Sí | Sí |
| **Biometrics** | No (Web API limitado) | Sí | Sí | Sí | Sí |
| **Offline robusto** | Parcial | Sí | Sí | Sí | Sí |
| **Presencia App Store** | No | Sí | Sí | Sí | Sí |
| **Presencia Play Store** | Instalable | Sí | Sí | Sí | Sí |
| **UX fluidez** | Web-like | Web-like+ | Nativa | Nativa+ | Nativa++ |
| **Bundle size** | <1MB | 30-50MB | 25-35MB | 20MB+ | 10-15MB |
| **Performance en lista 1000 items** | Regular | Regular | Buena | Buena | Excelente |
| **Costo 1er año** | $8K | $15K | $40K | $50K | $80K |
| **Costo mantenimiento/año** | $6K | $10K | $25K | $30K | $50K |
| **Time-to-market** | 1 mes | 1.5 meses | 5 meses | 6 meses | 8 meses |

---

## 2.4 Recomendación

### Camino recomendado: **Capacitor (con base PWA como fallback)**

Justificación:

1. **Maximiza reutilización del código actual** — 90% del frontend de EvaPro se reutiliza sin rewrite.
2. **Presencia en App Store + Play Store** — ya con su nombre, su branding, reviews. Para un SaaS B2B enterprise esto es importante (RRHH pregunta "¿tienen app?" y aparece en la store).
3. **Acceso nativo a lo que importa**: push notifications, biometrics, camera para uploads de fotos de perfil, storage seguro para tokens.
4. **Time-to-market razonable:** 6 semanas post-Fase C del roadmap v2.0.
5. **Una sola codebase** — el web y la mobile son la misma Next.js, con algunos `Capacitor.isNativePlatform()` condicionales.
6. **Salida clara a RN si alguna vez se justifica** — todos los hooks/store/api client son directamente portables.

**Por qué NO React Native (por ahora):** el costo de rewrite (16-20 semanas) solo se justifica cuando EvaPro tenga >5000 usuarios móviles activos diarios y UX nativa sea un diferenciador vs competidores. Hoy, la diferencia que percibe un usuario RRHH entre Capacitor y React Native es marginal; lo que percibe es **"¿tiene app o no?"**.

**Por qué NO PWA sola:** la ausencia de presencia en stores es un bloqueador de venta enterprise. Clientes piden "mándame el link del App Store" como señal de legitimidad.

### Secuencia sugerida

1. **Fase C de v2.0 primero** (refactor responsive + partición de páginas + sidebar móvil). Sin esto, el wrapper Capacitor va a mostrar el mismo problema del sidebar 260px fijo.
2. **Fase D (Mobile App):** 6 semanas post-Fase C.

---

## 2.5 Plan de implementación Fase D — Mobile App con Capacitor

### Semana 1 — Setup + configuración

**Objetivos:**
- Instalar Capacitor en el monorepo.
- Configurar build estático de Next.js (`next export` o `output: 'export'`).
- Crear proyectos iOS y Android.
- Primer build funcionando en simulator.

**Tareas:**
- `apps/mobile/` directorio nuevo (o integrar en `apps/web/`).
- `capacitor.config.ts` con bundle IDs (`cl.ascenda.eva360`).
- `pnpm add @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`.
- `npx cap init` + `npx cap add ios` + `npx cap add android`.
- Build estático → sync → run en simulator.
- Configurar branding básico: app name, ícono (ya existe en `public/icon-512.png`), splash screen.

**Entregable:** APK + IPA instalables en simulator con login funcional contra el API de producción.

---

### Semana 2 — Auth seguro + storage nativo

**Objetivos:**
- Migrar almacenamiento del token JWT de `localStorage` a `Capacitor Preferences` (encriptado nativo).
- Implementar login con biometrics (Touch ID / Face ID) como atajo.
- Manejar refresh token en background.

**Tareas:**
- `pnpm add @capacitor/preferences @capacitor-community/biometric-auth`.
- Refactor `auth.store.ts` para usar `Preferences.set/get` en lugar de `localStorage` cuando está en Capacitor.
- `if (Capacitor.isNativePlatform()) { ... } else { ... }` — detecta el entorno.
- Flujo: primer login con email+password → guarda token en Preferences → siguiente apertura de la app ofrece "Iniciar con Touch ID".
- Testing del flujo en iOS + Android.

**Entregable:** app con auth seguro, biometrics opcional, sin pérdida de sesión en cold-start.

---

### Semana 3 — Push notifications

**Objetivos:**
- Configurar Firebase Cloud Messaging (FCM) para iOS y Android.
- Backend envía push notifications para: recordatorios de evaluaciones, mensajes de feedback, aprobaciones pendientes, reconocimientos recibidos.

**Tareas:**
- Crear proyecto Firebase.
- Registrar apps iOS y Android.
- `pnpm add @capacitor/push-notifications`.
- Backend: nuevo módulo `push-notifications.service.ts` que usa Firebase Admin SDK.
- Guardar device tokens en una tabla `user_devices` (user_id, platform, token, last_seen).
- Integrar con el sistema de notificaciones existente (`notifications.service.ts`): cuando se crea una notif, si el user tiene device tokens → enviar push.
- Testing end-to-end: push llega a iOS real y Android real.

**Entregable:** notificaciones push funcionando en ambas plataformas, conectadas al sistema de notifs existente.

---

### Semana 4 — Optimizaciones móviles críticas

**Objetivos:**
- Las vistas priorizadas para mobile funcionan con fluidez.
- Touch targets ≥ 44×44 px.
- Navegación con bottom tabs (no sidebar en móvil).

**Tareas:**
- **Bottom tab bar** para las 5 vistas principales:
  1. Inicio (dashboard personal)
  2. Evaluaciones (recibidas + pendientes)
  3. Objetivos (mis OKRs)
  4. Reconocimientos (feed)
  5. Perfil (mi suscripción, cambiar idioma, logout)
- **Esconder sidebar** en viewport < 768px (usar `window.matchMedia` o Capacitor `Platform` detector).
- **Ocultar** vistas que no tienen sentido en móvil (crear ciclo, calibración, admin, importar usuarios, reports avanzados). Opcionalmente mostrar mensaje "Esta función solo está disponible en desktop".
- Revisar todos los botones con < 44px y ampliar.
- Tablas: reemplazar por lista de cards en viewport móvil.

**Entregable:** experiencia móvil pulida para las 5 vistas críticas del empleado.

---

### Semana 5 — Offline & sincronización

**Objetivos:**
- App usable con conexión intermitente.
- Respuestas de evaluación y feedback se guardan localmente si no hay red, se sincronizan al recuperar.

**Tareas:**
- React Query configurado con `persistQueryClient` para cachear respuestas en Preferences.
- Mutaciones offline-first: al enviar una respuesta de evaluación, guardar en queue local, mostrar "Enviando...", reintentar cuando haya conexión.
- Indicador visual de estado online/offline.
- Background sync via `@capacitor/network`.

**Entregable:** app usable en aeropuerto / metro / oficina con red mala.

---

### Semana 6 — Branding, QA, submission

**Objetivos:**
- App pulida visualmente.
- Testeo en dispositivos reales.
- Submission a App Store + Play Store.

**Tareas:**
- Splash screen, íconos, colores de branding definitivos.
- Testing en iPhone 12/13/14/15 + Android medio (Samsung A, Moto G).
- Detector de versión mínima: si el usuario tiene una versión vieja + breaking change en API, mostrar "Actualizá la app".
- Preparar screenshots para las stores (5-6 screenshots por plataforma).
- Privacy policy URL (requerida por Apple).
- Crear cuenta Apple Developer ($99/año) si no hay.
- Crear cuenta Google Play ($25 única vez) si no hay.
- Submission a ambas stores.

**Entregable:** app en review en App Store (7-14 días) y publicada en Play Store (2-3 días).

---

## 2.6 Timeline, presupuesto, riesgos

### Timeline global

```
v2.0 completo              → 11 semanas (Fases A+B+C)
  + Fase D (Mobile)        → +6 semanas
  + App Store review       → +1-2 semanas (variable Apple)
──────────────────────────────
  Total de cero a mobile   → ~19 semanas
  ≈ 5 meses
```

**Si solo se hace Fase A (mínimo) + Mobile:**
```
Fase A                     → 3 semanas
  + Refactor mobile-first  → 3 semanas (subset de Fase C)
  + Fase D (Mobile)        → 6 semanas
  + App Store review       → 1-2 semanas
──────────────────────────────
Total mínimo con mobile    → ~14 semanas
  ≈ 3.5 meses
```

### Presupuesto

**v2.0 completo + Mobile** (estimado LATAM, mix de perfiles):

| Fase | Duración | Costo |
|---|---|---|
| A — Seguridad + estabilidad | 3 sem | USD 12K |
| B — Performance + escalabilidad | 4 sem | USD 16K |
| C — Mantenibilidad + UX | 4 sem | USD 16K |
| D — Mobile (Capacitor) | 6 sem | USD 20K |
| **Total** | **17 sem** | **USD 64K** |

**Costo adicional:**
- Apple Developer: USD 99/año.
- Google Play: USD 25 una vez.
- Firebase (FCM): free tier suficiente.
- Sentry: USD 26/mes plan team (optimizable).
- Redis cloud (para queues): USD 15/mes básico.
- S3/R2 (backups): USD 5/mes.

**Total primer año operacional:** USD 64K + ~USD 700 infra extras = **~USD 65K**.

### Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Apple rechaza la app por motivo trivial | Alta | Medio | Dar 2 iteraciones en el timeline. Cumplir Apple Guidelines 1.1 estrictamente (no copy genérico, privacy policy, login test demo user). |
| Usuario final no adopta la app móvil | Media | Alto | Lanzar con push de marketing + onboarding integrado + link en emails de evaluación. |
| Bug crítico del seed/migration en deploy | Media | Alto | Migraciones formales en Fase A. Ya arreglamos el caso del add-on IA. |
| Costo de infra se dispara con primer cliente >1000 users | Media | Medio | Fase B (queues, caching, clustering) lo previene. |
| Equipo no encuentra senior NestJS bueno | Alta | Alto | Pre-contratar antes de arrancar. Hay pool bueno en Argentina, Colombia, Chile. |
| Capacitor falla en alguna vista compleja (Recharts) | Media | Medio | Recharts funciona en WebView, está probado en producción de terceros. Plan B: reemplazar charts críticos por imágenes server-rendered. |

---

## 2.7 MVP móvil — qué sí, qué no

### Vistas **SÍ** incluir en la app móvil (Fase D)

| # | Vista | Ruta web actual | Prioridad |
|---|---|---|---|
| 1 | Login + biometrics | `/login` | CRÍTICA |
| 2 | Dashboard personal (mis tareas pendientes) | `/dashboard` (subset) | CRÍTICA |
| 3 | Responder evaluación | `/dashboard/evaluaciones/[id]/responder` | CRÍTICA |
| 4 | Lista evaluaciones pendientes + recibidas | `/dashboard/mi-desempeno` | CRÍTICA |
| 5 | Mis objetivos (ver + registrar progreso) | `/dashboard/objetivos` (subset "mis") | ALTA |
| 6 | Feed de reconocimientos | `/dashboard/reconocimientos` | ALTA |
| 7 | Dar un reconocimiento | modal actual | ALTA |
| 8 | Mis PDIs + completar acciones | `/dashboard/desarrollo` (subset "mis") | ALTA |
| 9 | Responder encuesta de clima | `/dashboard/encuestas-clima/[id]/responder` | ALTA |
| 10 | Quick feedback (enviar/recibir) | `/dashboard/feedback` (subset) | MEDIA |
| 11 | Check-ins 1:1 | `/dashboard/feedback` (subset) | MEDIA |
| 12 | Notificaciones | dropdown actual | CRÍTICA |
| 13 | Perfil + idioma + logout | sidebar actual | CRÍTICA |
| 14 | Mi suscripción (solo ver, sin editar) | `/dashboard/mi-suscripcion` | BAJA |
| 15 | KPIs ejecutivos (solo admin/manager) | `/dashboard` (subset) | MEDIA |

**Total: 15 vistas.** Aproximadamente 30-35% del sistema web.

### Vistas **NO** incluir en la app móvil

| Vista | Por qué no |
|---|---|
| Usuarios (CRUD, importar) | Flujo administrativo complejo, tablas enormes. Desktop-only. |
| Crear ciclo de evaluación | Flujo administrativo de 5 pasos. |
| Calibración | Drag-and-drop, 9-box, sala virtual. No funciona en móvil. |
| Analytics avanzados + reports | Gráficos grandes + filtros pesados + export Excel. |
| Postulantes / Recruitment | CRUD complejo, subida de CV. |
| Desarrollo organizacional (admin) | Admin-only, vistas grandes. |
| Subscripciones (admin) | Admin-only. |
| Facturación | Admin-only. |
| Contratos legales | Subir/firmar documentos. Posible a futuro; post-MVP. |
| DEI dashboard | Grandes gráficos. |
| Encuestas (crear) | Admin flow. Solo responder se incluye. |
| Gestión de competencias | CRUD admin. |
| 9-box / Talent | Drag-and-drop. |

**Patrón general:** todo lo que es **CRUD administrativo, gráficos grandes o drag-and-drop** se queda en desktop. La app móvil es para **responder, consumir, aprobar**.

---

## Cierre

EvaPro está en un buen momento. Hay producto real, hay clientes piloto (Cesce), el dominio funciona, la arquitectura tiene fundamentos sólidos. **Lo que falta es endurecer, testear y pulir** — no reescribir. El roadmap v2.0 de 11 semanas resuelve los puntos más críticos. El plan de mobile app con Capacitor en 6 semanas adicionales saca el producto a stores con inversión razonable y reutilizando el 90% del código actual.

La decisión más importante del próximo trimestre no es técnica: es **cuánto presupuesto asignar**. Las opciones:

1. **Bare minimum (USD 12K):** Fase A sola, 3 semanas. Cierra los hallazgos críticos de seguridad. Sin mobile.
2. **v2.0 sólida (USD 44K):** Fases A+B+C, 11 semanas. Escala a 200 clientes. Sin mobile.
3. **v2.0 + mobile (USD 64K):** Fases A+B+C+D, 17 semanas. Listo para salir al mercado con fuerza.

Mi recomendación: **opción 3** si el horizonte de ventas es 12 meses. Opción 1 si hay que conservar runway.

Cualquier camino, **el hallazgo C1 (seeding destructivo) ya fue resuelto esta noche** en el commit `d6b8eae` — ese era el que estaba causando problemas concretos observables (add-on IA que reaparecía, plan que se revertía). Lo que sigue son mejoras estructurales.

---

**Fin del documento.**
