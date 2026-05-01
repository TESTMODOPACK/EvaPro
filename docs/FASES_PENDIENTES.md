# Fases Pendientes — EvaPro

Este documento lista **refactors técnicos puntuales** (deuda técnica, fixes
de arquitectura) que quedaron postergados intencionalmente. Cada ítem tiene
un impacto estimado y un punto de entrada al código.

Para **features estratégicas de producto** pendientes (integraciones Slack/Teams,
SSO SAML, app nativa, certificaciones, etc.), ver
[`ROADMAP_V3_X.md`](./ROADMAP_V3_X.md).

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

## F-005 — Captcha (hCaptcha o Turnstile) en job board público

**Estado**: pendiente — diferido en S7.1, no bloqueante mientras no haya tráfico abusivo.
**Impacto**: medio (sin esto un bot puede saturar el pipeline de candidatos del tenant).
**Prioridad**: media — subir a alta si llegan reportes de spam en producción.

### Contexto
S7.1 lanzó el job board público con rate limit por IP in-memory (5 aplicaciones/hora),
lo cual mitiga ataques simples pero no detiene un bot distribuido o un atacante
con IPs rotativas. El captcha es la siguiente capa defensiva.

### Alcance del refactor
**Backend** (`apps/api/`):
- Nuevo guard `apps/api/src/common/guards/captcha.guard.ts`:
  - Lee header `x-captcha-token`.
  - POST a `https://hcaptcha.com/siteverify` (o Turnstile equivalente) con `secret` (env) + token.
  - Si responde `success=false` → `BadRequestException`.
  - Cachea tokens validados ~60s en memoria para evitar doble-call.
- Decorar `@UseGuards(CaptchaGuard)` solo en `PublicJobsController.apply` (no en GET).
- Env vars: `HCAPTCHA_SECRET` o `TURNSTILE_SECRET`.

**Frontend** (`apps/web/`):
- Instalar `@hcaptcha/react-hcaptcha` o `@marsidev/react-turnstile`.
- En `apps/web/src/app/jobs/[tenantSlug]/[processSlug]/page.tsx`:
  - Componente captcha antes del botón Enviar.
  - Estado `captchaToken: string | null`. Submit habilitado solo cuando hay token.
  - Pasar token en header del fetch al endpoint apply.
- Env vars: `NEXT_PUBLIC_HCAPTCHA_SITEKEY` o `NEXT_PUBLIC_TURNSTILE_SITEKEY`.

### Riesgos / consideraciones
- hCaptcha free tier: ~10k validaciones/mes; tenants populares podrían exceder.
- Turnstile (Cloudflare) es ilimitado y gratis pero requiere cuenta CF.
- Accesibilidad: ambos tienen modo accesible pero hay que probar con screen readers.

**Esfuerzo estimado**: 0.5 día.

### Referencias de código
- `apps/api/src/modules/recruitment/public-jobs.controller.ts`
- `apps/api/src/modules/recruitment/recruitment.service.ts` método `applyToPublicProcess`
- `apps/web/src/app/jobs/[tenantSlug]/[processSlug]/page.tsx`

---

## F-006 — Branding por tenant en página pública del job board

**Estado**: pendiente — diferido en S7.1, fallback default funciona.
**Impacto**: bajo-medio (UX/marketing, no afecta funcionalidad core).
**Prioridad**: baja — subir cuando un tenant pida personalización.

### Contexto
La página `/jobs/[tenantSlug]/[processSlug]` muestra "Eva360" branding por
default. Para que se vea como una página del tenant (logo + colores corporativos),
hay que extender el endpoint público y el render.

### Alcance del refactor
**Backend**:
- Verificar campos en `Tenant.settings` jsonb (probablemente ya existen
  `brandColor`, `logoUrl`, `faviconUrl`; si no, agregarlos).
- Extender `getPublicProcess` para devolver:
  ```ts
  branding: {
    logoUrl: tenant.settings?.logoUrl ?? null,
    primaryColor: tenant.settings?.brandColor ?? '#6366f1',
    faviconUrl: tenant.settings?.faviconUrl ?? null,
  }
  ```

**Frontend** (`apps/web/src/app/jobs/[tenantSlug]/[processSlug]/page.tsx`):
- Renderizar logo arriba del título de la card.
- Aplicar `primaryColor` al botón submit y al borde de la card.
- Generar `metadata` Next.js dinámica con `tenantName + processTitle` para SEO.
- Setear `<link rel="icon">` dinámico cuando hay `faviconUrl`.

### Riesgos / consideraciones
- Tenants sin branding configurado → fallback al default (lógica ya en place).
- Si `logoUrl` es base64 grande (>1MB), la página tarda — considerar límite
  o forzar URL externa (CDN del tenant).

**Esfuerzo estimado**: 1 día.

### Referencias de código
- `apps/api/src/modules/recruitment/recruitment.service.ts` método `getPublicProcess`
- `apps/api/src/modules/tenants/entities/tenant.entity.ts` (campo `settings` jsonb)
- `apps/web/src/app/jobs/[tenantSlug]/[processSlug]/page.tsx`

---

## F-007 — Admin UI para setear `public_slug` del proceso

**Estado**: pendiente — endpoint backend listo desde S7.1, falta frontend.
**Impacto**: alto operacional (sin esto, un admin no puede publicar un proceso
sin hacer PATCH manual via curl/Postman).
**Prioridad**: ALTA — primera limitación a cerrar para que S7.1 sea usable.

### Contexto
El endpoint `PATCH /recruitment/processes/:id/public-slug` ya valida formato,
unicidad por tenant y emite audit logs. Falta el UI para que el admin opere
desde el dashboard.

### Alcance del refactor
**Frontend** (`apps/web/src/app/dashboard/postulantes/[id]/page.tsx`):
- Nueva sección en pestaña Configuración (junto a `ScoringWeightsEditor`):
  - Toggle "Publicar en job board".
  - Input slug con validación regex `[a-z0-9-]{3,60}` (espejar el regex del backend).
  - Botón "Generar slug del título" que auto-derive desde `process.title`
    (kebab-case + lowercase).
  - Una vez publicado, mostrar URL completa (`/jobs/{tenantSlug}/{processSlug}`)
    con botón "Copiar al portapapeles".
  - Botón "Despublicar" que llama PATCH con `slug: null`.
- Visible solo cuando: `role === 'tenant_admin'` AND `processType === 'external'`
  AND `status === 'active'`.
- Llamar `api.recruitment.processes.setPublicSlug(token, id, slug)` (ya existe).

**Backend**: 0 cambios (endpoint listo).

### Riesgos / consideraciones
- Validación: el regex en cliente debe ser idéntico al del backend para evitar
  errores 400 confusos.
- Mostrar errores claros: "slug en uso", "formato inválido", etc.

**Esfuerzo estimado**: 0.5 día.

### Referencias de código
- `apps/api/src/modules/recruitment/recruitment.controller.ts` (endpoint PATCH)
- `apps/api/src/modules/recruitment/recruitment.service.ts` método `setPublicSlug`
- `apps/web/src/lib/api.ts` función `setPublicSlug` (ya existe)

---

## F-008 — OAuth Google Calendar para sync 2-way de entrevistas

**Estado**: pendiente — diferido en S7.2, .ics email cubre el caso común.
**Impacto**: medio-alto (feature avanzada que diferenciaria de competidores
mid-market, pero requiere App Verification de Google que toma 4-6 semanas).
**Prioridad**: BAJA — solo arrancar cuando un cliente lo pida explícitamente.

### Contexto
S7.2 envía `.ics` adjunto al email del candidato + evaluator, lo cual funciona
con cualquier cliente de calendario (Google, Outlook, Apple). Esto es 1-way:
si el evaluator mueve el evento dentro de su Google Calendar, nuestro
`scheduled_at` queda desincronizado.

Sync 2-way real implica OAuth + API directa + webhooks.

### Alcance del refactor
**Backend**:
- Nuevo módulo `apps/api/src/modules/google-calendar/`:
  - `google-calendar.module.ts`.
  - `google-calendar.service.ts` con `createEvent`, `updateEvent`, `cancelEvent`
    usando `googleapis` SDK.
  - Entity `oauth_tokens.entity.ts`: `tenant_id`, `user_id`, `refresh_token`
    (encrypted), `access_token`, `expires_at`, `scope`, `granted_at`,
    `revoked_at`.
  - Helper de token rotation (refresh cuando access expira).
- Endpoints:
  - `GET /recruitment/google/connect` → redirige a Google OAuth con state token (CSRF).
  - `GET /recruitment/google/callback` → intercambia code por tokens, persiste.
  - `POST /recruitment/google/disconnect` → revoca + borra fila.
- Modificar `recruitment.service.scheduleInterview` y `cancelInterviewSlot`:
  - Si evaluator tiene token activo → llamar `googleCalendarService.createEvent/cancelEvent`
    además del email.
  - Persistir `googleEventId` en `RecruitmentInterviewSlot` (nueva columna).
- Webhook subscription para sync 2-way real:
  - Endpoint `POST /webhooks/google-calendar` (sin auth, valida via signature).
  - Cron de renovación de watch (expiran cada 7 días).
  - Lógica: si evaluator mueve evento → actualizar `slot.scheduledAt`; si
    borra → marcar `cancelled`.

**Dependencias**:
- `googleapis` npm package.
- GCP project con OAuth client.
- Env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
- **Google App Verification** (4-6 semanas para scope `calendar.events` en producción).

**Frontend**:
- Nueva sección en perfil/settings: "Conectar Google Calendar" → abre popup OAuth.
- Status badge: "Conectado como user@gmail.com" o "No conectado".
- Botón "Desconectar".

### Riesgos / consideraciones
- **Compliance**: persistir `refresh_token` de Google es PII alta. Encriptar con
  `node:crypto` + key from env. Audit obligatorio en connect/disconnect/use.
- Google revoca `refresh_token` cada 6 meses si la app no está verified — los
  users tienen que reconectar.
- Webhook reliability: si Google envía cambio y el server estaba caído, no hay
  retry — necesitamos polling adicional como fallback.
- Multi-evaluator: si 3 evaluators conectan 3 cuentas Google distintas, el
  evento se crea bajo el OAuth del evaluator que recibe la entrevista (cada uno
  ve su propio evento).
- App Verification de Google bloquea producción hasta que pase el proceso.

**Esfuerzo estimado**: 5-7 días dev + 4-6 semanas de Google App Verification (en paralelo).

### Referencias de código
- `apps/api/src/modules/recruitment/recruitment.service.ts` métodos
  `scheduleInterview`, `cancelInterviewSlot`
- `apps/api/src/modules/recruitment/utils/ics-generator.ts` (.ics actual)

---

## F-009 — UI modal para agendar entrevistas (S7.2)

**Estado**: pendiente — endpoints backend listos desde S7.2, falta frontend.
**Impacto**: alto operacional (sin esto, agendar slot requiere PATCH manual).
**Prioridad**: ALTA — segunda limitación crítica para que S7.2 sea usable.

### Contexto
Los endpoints `POST /recruitment/candidates/:id/schedule-interview`,
`PATCH /recruitment/interview-slots/:id/cancel` y
`GET /recruitment/candidates/:id/upcoming-interviews` ya están operativos.
Falta el UI.

### Alcance del refactor
**Frontend** (`apps/web/src/app/dashboard/postulantes/[id]/`):
- Nuevo componente `ScheduleInterviewModal.tsx`:
  - Dropdown evaluator (cargado desde `process.evaluators`).
  - DateTimePicker (`<input type="datetime-local">` o componente custom).
  - Select duración: 15 / 30 / 45 / 60 / 90 / 120 min (default 60).
  - Input URL meeting (opcional).
  - Textarea notas para el evaluator (opcional).
  - Validación pre-submit: fecha futura, evaluator seleccionado.
  - Submit → `api.recruitment.candidates.scheduleInterview(...)`.
- Botón "Agendar entrevista" en candidate detail (mostrar solo cuando
  `stage` ∈ {`cv_review`, `interviewing`, `scored`, `approved`}).
- Nueva sección "Próximas entrevistas" en candidate detail:
  - Listar slots con fecha + evaluator + meeting URL + status.
  - Botón "Cancelar" por slot → prompt para razón →
    `api.recruitment.candidates.cancelInterviewSlot(...)`.

**Backend**: 0 cambios (endpoints listos).

### Riesgos / consideraciones
- **Time zone**: HTML5 `datetime-local` retorna fecha en TZ del browser. Hay
  que serializar a UTC ISO antes de enviar (`new Date(value).toISOString()`).
  Mostrar la fecha del backend con `toLocaleString('es-CL')` para que el admin
  vea su TZ local.
- **Doble booking del evaluator**: el backend no chequea hoy. Considerar
  warning (no error) en frontend: "El evaluator ya tiene otra entrevista a las {time}".

**Esfuerzo estimado**: 1-1.5 días.

### Referencias de código
- `apps/api/src/modules/recruitment/recruitment.controller.ts` endpoints `schedule-interview` / `interview-slots/:id/cancel` / `upcoming-interviews`
- `apps/web/src/lib/api.ts` funciones `scheduleInterview`, `cancelInterviewSlot`,
  `getUpcomingInterviews` (ya existen)

---

## F-010 — Auto-marcar `no_show` en entrevistas vencidas (S7.2)

**Estado**: pendiente — diferido en S7.2, admin puede marcar manual mientras tanto.
**Impacto**: bajo (solo afecta calidad del audit trail; no rompe flujos).
**Prioridad**: baja.

### Contexto
Hoy un slot con `status='scheduled'` y `scheduled_at` ya pasada se queda en
ese estado indefinidamente si el admin no marca manualmente. Esto polluciona
las queries de "próximas entrevistas" y métricas.

### Alcance del refactor
**Backend**:
- Extender el cron `sendInterviewReminders` (o crear `markPastSlotsNoShow`):
  ```sql
  UPDATE recruitment_interview_slots
  SET status = 'no_show'
  WHERE status = 'scheduled'
    AND scheduled_at + (duration_minutes || ' minutes')::interval < NOW() - INTERVAL '24 hours'
  ```
- Audit log `recruitment.interview_auto_marked_no_show` por slot afectado
  (loop o subquery).
- **Decision**: 24h de grace después de `scheduled_at + duration` para que
  admin tenga chance de marcar `completed` manualmente.

**Frontend**:
- En sección "Próximas entrevistas" del detalle del candidato (F-009),
  agregar botones rápidos por slot: "Marcar completed" / "Marcar no_show"
  para que admin no dependa del cron.
- Endpoint nuevo: `PATCH /interview-slots/:id/status` con audit del cambio
  (necesita prepararse).

### Riesgos / consideraciones
- **Falsos positivos**: si admin no marca `completed` pero la entrevista sí
  ocurrió, queda como `no_show`. El admin puede corregir manualmente — el
  endpoint debe permitir transitions `no_show → completed` con audit.
- **Tests**: agregar test del cron con mock de `Date.now()` para verificar
  la ventana de 24h.

**Esfuerzo estimado**: 0.5 día.

### Referencias de código
- `apps/api/src/modules/recruitment/recruitment.service.ts` método
  `sendInterviewReminders` (cron actual de S7.2)
- `apps/api/src/modules/recruitment/entities/recruitment-interview-slot.entity.ts`
  enum `InterviewSlotStatus`

---

## Sprint 8 sugerido — cerrar gaps críticos de S7

Tres ítems anteriores se identificaron como **bloqueantes operacionales**: sin
ellos, S7.1 y S7.2 funcionan pero requieren PATCH manual via curl/Postman, lo
cual no es usable por admins reales. Recomendación de packaging:

| Ítem | Esfuerzo | Bloqueante? |
|------|----------|-------------|
| F-007 — Admin UI public_slug | 0.5d | Sí (sin esto no se publica un proceso) |
| F-009 — UI modal agendar entrevista | 1-1.5d | Sí (sin esto no se agendan slots) |
| F-010 — Auto no_show | 0.5d | No (calidad audit trail) |

**Sprint 8 total: 2-2.5 días**.

Los demás (F-005 captcha, F-006 branding, F-008 Google OAuth) se difieren hasta
que haya señal de mercado:
- F-005 si hay reportes de spam.
- F-006 si un tenant pide personalización.
- F-008 si un cliente pide sync 2-way real (alto costo, ROI incierto mientras
  el `.ics` cubra el caso común).

---

## Convenciones para agregar nuevos ítems

1. ID incremental `F-###`.
2. Campos obligatorios: Estado, Impacto, Prioridad, Contexto, Alcance, Referencias.
3. Al implementar un ítem, no borrar de este doc — marcar como `✅ Implementado`
   con enlace al commit/PR, y mover a una sección "Historial" al final.
