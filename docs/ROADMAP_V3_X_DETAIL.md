Tengo suficiente contexto. Ahora construyo el documento v3.x extendido con máximo detalle técnico específico a Eva360.

---

# Roadmap v3.x — Release de Engagement y Coaching (F1–F7)

**Documento:** `docs/ROADMAP_V3_X.md` (extensión)
**Fecha:** 2026-04-21
**Autor:** Equipo Arquitectura Eva360
**Contexto previo:** este plan EXTIENDE el `ROADMAP_V3_X.md` vigente (secciones 1-9 de integraciones, SSO, PWA nativa, etc.). Las 7 features aquí descritas conforman las releases **v3.1 → v3.3** y se centran en engagement + coaching del manager. Todas parten del stack actual (NestJS 11 + TypeORM + Next.js 14 App Router) sin nuevas dependencias de infra mayores.

---

## Pre-requisitos compartidos (base arquitectónica v3.1)

Antes de tocar código de features:

1. **Extender `PlanFeature` en `apps/api/src/common/constants/plan-features.ts`** con 7 keys nuevas: `MAGIC_MEETINGS`, `PULSE_SURVEYS`, `MOOD_TRACKING`, `AI_COACH`, `FLIGHT_RISK`, `LEADER_STREAKS`, `SOCIAL_KUDOS`. Actualizar `PLAN_FEATURES` (Growth/Pro/Enterprise) según tabla al final del documento.
2. **Extender `FEATURE_LABELS`, `FEATURE_MIN_PLAN`, `ROUTE_FEATURE_MAP`** en `apps/web/src/lib/feature-routes.ts` con labels en español y mapeos de rutas nuevas.
3. **Extender `NotificationType` en `apps/api/src/modules/notifications/entities/notification.entity.ts`** con los 12 tipos nuevos listados por feature (ver cada sección).
4. **Extender `PushEventType` en `push.service.ts`** con `'mood' | 'pulse' | 'coach' | 'streaks' | 'kudos'`.
5. **Reusar `runWithCronLock(...)` de `apps/api/src/common/utils/cron-lock.ts`** para TODOS los nuevos crons multi-replica-safe.

---

## F1. Agenda Mágica de 1:1

### Resumen ejecutivo
**Problema que resuelve:** hoy la entity `CheckIn` en `apps/api/src/modules/feedback/entities/checkin.entity.ts` tiene `topic`, `notes`, `agendaTopics[]` y `actionItems[]` como campos editables manuales. El manager llega al 1:1 con una hoja en blanco y gasta los primeros 5 minutos recordando qué pasó desde el último. Esto baja calidad de la conversación y hace que los managers procrastinen los 1:1.

**Valor:**
- **Manager:** agenda pre-poblada en 3 segundos, cero preparación manual.
- **Empresa:** aumenta tasa de completitud de 1:1s, aumenta calidad (más foco en decisiones).

**KPI de éxito:** % de check-ins donde el manager abre la sección "Agenda Mágica" (target >70%) + promedio de `actionItems` por 1:1 (pre-feature vs post-feature, target +40%) + tiempo promedio que dura un 1:1 (no debería caer — si cae significa que usan la agenda como checklist rápido en vez de conversar).

### Usuarios y roles
- **Manager:** consume la agenda pre-generada, edita, marca pendientes al cerrar.
- **Employee:** ve en modo read-only antes del 1:1 (opcional, checkbox en `settings`), agrega sus propios temas vía `agendaTopics` (ya soportado).
- **tenant_admin:** sin acceso especial (solo audit).
- **super_admin:** audit en impersonation.

### Ubicación en la UI
- **Sidebar:** sin sección nueva — se consume dentro de `SEGUIMIENTO CONTINUO → Check-ins 1:1` (ruta `/dashboard/feedback`, tab `checkins`).
- **Nueva ruta:** `/dashboard/feedback/[checkinId]/agenda` — página full que abre el manager cuando hace click en un check-in scheduled.
- **Integración con página existente:** `apps/web/src/app/dashboard/feedback/page.tsx` → dentro del row de un check-in agregar botón **"Preparar agenda"** que navega a la página de agenda; en estado `COMPLETED` el botón cambia a **"Ver minuta"**.
- **Modal alternativo (opción B):** en vez de ruta, un modal grande desde la lista. Decisión: ruta para permitir deep-link desde email/push.

### Backend
#### Entities nuevas o modificadas
Modificar `CheckIn` (`checkin.entity.ts`):
- Agregar campo `magicAgenda: jsonb` con shape:
  ```
  {
    pendingFromPrevious: Array<{text, addedByUserId, checkinId}>,
    okrSnapshot: Array<{objectiveId, title, progress, status, daysToTarget}>,
    recentFeedback: Array<{feedbackId, from, to, sentiment, message, createdAt}>,
    recentRecognitions: Array<{recognitionId, valueId, message, createdAt}>,
    aiSuggestedTopics: Array<{topic, rationale, priority: 'high'|'med'|'low'}>,
    generatedAt: ISO8601,
    generatorVersion: string  // ej "v1"
  }
  ```
- Campo `carriedOverActionItems: jsonb default []` — snapshot de los `actionItems` del check-in previo entre el mismo manager-employee que quedaron `completed:false`. Sirve para que al completar este 1:1 se **puedan desmarcar** y se propaguen al siguiente.

Nueva tabla **`checkin_templates`** (opcional para F1 v1.1 — deferirlo a F1.2). Por ahora no la creamos.

**Migración:** `AddMagicAgendaToCheckins<timestamp>.ts` — añade columnas nullable en `checkins`, sin backfill (todas las filas legacy tendrán `magic_agenda=null`).

#### Service methods (en `feedback.service.ts`)
```
// 1. Genera la agenda on-demand y la cachea en la fila
generateMagicAgenda(tenantId, checkinId, userId, role): Promise<CheckIn>
  - Valida que caller sea el manager del checkin (o tenant_admin)
  - Consulta last checkin COMPLETED entre (managerId, employeeId) → extrae pendingFromPrevious
  - Consulta Objective del employeeId activos + 14 días de ventana target_date
  - Consulta QuickFeedback dado/recibido por employeeId últimas 4 semanas
  - Consulta Recognition recibido por employeeId últimas 4 semanas
  - Llama aiInsightsService.generateAgendaSuggestions() (nueva)
  - Persiste en checkin.magicAgenda + updates updatedAt
  - Audit: checkin.agenda.generated

// 2. Regenera (override cache, consume cuota IA)
refreshMagicAgenda(...): igual pero force=true

// 3. Al completar checkin, si actionItems tiene items no completados, snapshot para siguiente
private snapshotPendingForNext(checkin): void
  - Se llama dentro de completeCheckIn (ya existe)
  - Guarda actionItems.filter(i => !i.completed) en metadata del checkin como "pendingForNext"
```

**Nuevo método en `aiInsightsService`:** `generateAgendaSuggestions(tenantId, employeeId, contextData)`. Reusa `ensureClient()`, `checkRateLimit()` y el patrón de cache de `apps/api/src/modules/ai-insights/ai-insights.service.ts`. Nuevo `InsightType.AGENDA_SUGGESTIONS`. Nuevo prompt en `apps/api/src/modules/ai-insights/prompts/agenda.prompt.ts`.

#### API endpoints (nuevos en `feedback.controller.ts`)
- `POST /feedback/checkins/:id/agenda/generate` — `@Roles('super_admin','tenant_admin','manager')` → body: `{ force?: boolean }` → retorna `CheckIn` completo con `magicAgenda` poblado.
- `GET /feedback/checkins/:id/agenda` — `@Roles(...)` → retorna solo `magicAgenda` (lean, sin regenerar).
- `PATCH /feedback/checkins/:id/agenda` — permite al manager editar manualmente items agregados (ej. borrar una sugerencia IA que no aplica). Body: `{ dismissedSuggestionIds?: string[] }`.

#### Integraciones con otros módulos
- **`ObjectivesService`** (`apps/api/src/modules/objectives/objectives.service.ts`): nuevo método `findActiveForUser(tenantId, userId, options?: { includeAtRisk: boolean })`.
- **`FeedbackService`**: método `findQuickFeedbackByUser(tenantId, userId, weeksBack)` — consume y se consume a sí mismo.
- **`RecognitionService`** (`apps/api/src/modules/recognition/recognition.service.ts`): método `findReceivedByUser(tenantId, userId, weeksBack)`.
- **`AiInsightsService`**: nuevo método `generateAgendaSuggestions(...)` — consume rate limit plan Enterprise. Si el plan no tiene `AI_INSIGHTS`, el servicio retorna `aiSuggestedTopics: []` silenciosamente (graceful degradation) y aún así pobla los 4 bloques de datos puros. Decisión clave: **MAGIC_MEETINGS no exige AI_INSIGHTS**.

#### Workers / crons / jobs
- **Pre-warming opcional (deferible a F1.1):** cron `@Cron('0 7 * * MON-FRI')` que pre-genera `magicAgenda` para check-ins scheduled en las próximas 24h, usando `runWithCronLock('preWarmMagicAgendas', ...)`. Beneficio: la agenda aparece instantánea al abrir, sin latencia IA. Solo para tenants Pro+.

### Frontend
#### Páginas y componentes nuevos
- `apps/web/src/app/dashboard/feedback/[checkinId]/agenda/page.tsx` — página servida a managers. Layout: 5 cards (Pendientes del anterior, OKRs, Feedback reciente, Reconocimientos, Temas sugeridos IA) + sección editable de agenda + botón "Iniciar 1:1" que abre modo `completionFlow`.
- `components/feedback/MagicAgendaCard.tsx` — card reusable (generic: props `title`, `items`, `renderItem`, `emptyState`).
- `components/feedback/AiSuggestionsCard.tsx` — variant especial con "X sugerencias IA" + dismiss per-item + icon Claude.
- `components/feedback/CheckInCompletionModal.tsx` — al cerrar, muestra `actionItems` + checkbox "Propagar pendientes al siguiente 1:1".

#### Hooks de React Query (en `apps/web/src/hooks/useFeedback.ts`)
- `useCheckInAgenda(checkinId)` — `queryKey: ['feedback', 'checkin', checkinId, 'agenda']`, staleTime: 10min, GET `/feedback/checkins/:id/agenda`.
- `useGenerateMagicAgenda()` — mutation POST, onSuccess invalida la query de agenda + la lista de check-ins.

#### Componentes compartidos a crear
- **`AiDegradationNotice`** — card gris "Esta función genera más insights con IA (plan Enterprise)". Reusable por F4/F5.
- **`EmptyStateInline`** — variante compact del `EmptyState.tsx` existente para cards vacías sin perder altura.

### Datos y privacidad
- **Sensibilidad:** feedback reciente + pendientes del anterior son datos existentes, ya regulados. La agenda IA no almacena info nueva de PII.
- **Retención:** el jsonb `magicAgenda` se persiste hasta que se elimine el check-in (mismo ciclo GDPR que `notes`). No tiene regla separada.
- **Compliance:** ninguna consideración nueva vs el módulo feedback actual.

### Tareas desglosadas
1. **[S]** Agregar `PlanFeature.MAGIC_MEETINGS` + label + min plan (Pro) en archivos de configuración (4 archivos ya identificados).
2. **[M]** Migración TypeORM `AddMagicAgendaToCheckins` + extender `CheckIn` entity con `magicAgenda` y `carriedOverActionItems` jsonb.
3. **[M]** Implementar `generateMagicAgenda()` en `feedback.service.ts` con queries a Objectives/QuickFeedback/Recognition (reuso).
4. **[M]** Agregar `InsightType.AGENDA_SUGGESTIONS` en `ai-insight.entity.ts`, crear prompt `agenda.prompt.ts`, método `generateAgendaSuggestions()` en `ai-insights.service.ts`. 600-800 tokens output máximo.
5. **[S]** Endpoints controller + DTOs con `class-validator`.
6. **[L]** Página `/dashboard/feedback/[checkinId]/agenda/page.tsx` con las 5 cards + edición inline.
7. **[M]** Componentes `MagicAgendaCard`, `AiSuggestionsCard`, `CheckInCompletionModal`.
8. **[S]** Integración con `page.tsx` de feedback: botón "Preparar agenda" + deep link.
9. **[S]** i18n: extender `es.json`, `en.json`, `pt.json` con namespace `magicAgenda.*`.
10. **[S]** Telemetría: evento `magic_agenda_generated` en audit log.
11. **[M]** Tests de integración: generación con todas las fuentes vacías (graceful), con IA disabled (degradación), permissions (manager ajeno no puede).

**Total estimado:** ~10-13 días-dev.

### Dependencias
- **Internas:** ninguna feature de este plan (es la primera).
- **Externas:** reusa Claude API (plan Enterprise) opcional — NO bloqueante.

### Riesgos
- **UX:** si la agenda IA es genérica ("habla de sus objetivos") no aporta — el prompt debe ser específico con datos. Mitigación: dogfooding con 2-3 managers internos por 2 semanas antes del GA.
- **Cuota IA:** un tenant con 50 managers × 4 reportes × 2 checkins/mes = 400 generaciones/mes solo de agenda. Plan Enterprise actual default = 100 llamadas. Opción: **generateAgendaSuggestions NO cuenta contra el quota** (sale del tenant, no del user; volumen predecible) o subir default Enterprise a 500. Decisión recomendada: contar pero con cache 7 días + cron pre-warmer opcional.

---

## F2. Pulso Semanal Anónimo

### Resumen ejecutivo
**Problema:** `surveys` actual (encuestas clima) es pesado: creación de survey con N preguntas, audience targeting, reminders manuales. Para una pregunta semanal simple tipo Butterfly.ai, es overkill. Managers quieren saber "cómo está el equipo esta semana" sin orquestar una encuesta completa.

**Valor:**
- **Employee:** <10 seg de fricción, anonimato garantizado.
- **Manager:** termómetro semanal con trends.
- **tenant_admin:** detectar equipos o departamentos con deterioro.

**KPI de éxito:** % respuesta semanal del pulso (target >60%) × decisión clave: si cae bajo 40%, el pulso no está funcionando y revisamos.

### Usuarios y roles
- **Employee / manager / external:** responde cuando le llega. Siempre anónimo (solo agregados).
- **Manager:** ve dashboard agregado de su equipo (min 3 respuestas).
- **tenant_admin:** ve agregados a nivel tenant + configura pregunta semanal + opt-out de empleados.
- **super_admin:** sin acceso a datos (no hay impersonation sobre agregados anónimos — es crítico para la confianza).

### Ubicación en la UI
- **Sidebar nuevo ítem en CLIMA ORGANIZACIONAL:** "Pulso Semanal" → ruta `/dashboard/pulso`.
- **Dashboard widget:** en `/dashboard` card "Pulso Semanal" con el prompt si hay uno activo sin responder.
- **Web/mobile push:** miércoles 10am (configurable) llega notificación `"¿Cómo estás esta semana?"`.
- **In-app banner:** en top de `/dashboard` hasta responder o dismissear.

### Backend
#### Entities nuevas o modificadas
Nueva tabla **`pulse_questions`** — catálogo por tenant de preguntas rotativas:
```
pulse_questions
  id uuid pk
  tenant_id uuid (FK)
  text varchar(300)
  category enum: 'leadership'|'recognition'|'stress'|'belonging'|'growth'|'purpose'|'custom'
  order int
  is_active boolean default true
  created_by uuid
  created_at, updated_at
```
Seed con 6 preguntas default en español/inglés/portugués en `apps/api/src/modules/pulse/seeds/default-pulse-questions.ts`.

Nueva tabla **`pulse_cycles`** — cada ejecución semanal genera un cycle:
```
pulse_cycles
  id uuid pk
  tenant_id uuid
  question_id uuid (FK pulse_questions)
  week_starts_on date    -- lunes de la semana
  sent_at timestamptz
  closed_at timestamptz   -- +6 días (hasta antes del próximo)
  response_count int default 0  -- denormalizado para performance dashboard
  created_at
  unique(tenant_id, week_starts_on)
```

Nueva tabla **`pulse_responses`** — respuesta anónima:
```
pulse_responses
  id uuid pk
  tenant_id uuid
  pulse_cycle_id uuid (FK)
  score smallint  -- 1..5
  emoji varchar(8)  -- opcional
  comment text  -- opcional, max 300 chars, sanitizado
  department_snapshot varchar(100)  -- snapshot de departamento del respondent AL MOMENTO
  manager_id_snapshot uuid nullable  -- snapshot del manager
  created_at timestamptz
```
**NO hay `respondent_id`.** Es anónimo por diseño. Auditabilidad solo por `pulse_cycle_id` + `department_snapshot`.

Nueva tabla **`pulse_participation`** — tracking de quién respondió (para no volver a molestarlo en el mismo ciclo), separada de la respuesta:
```
pulse_participation
  id uuid pk
  tenant_id uuid
  pulse_cycle_id uuid (FK)
  user_id uuid (FK users)
  responded_at timestamptz
  unique(pulse_cycle_id, user_id)
```
**Separada explícitamente** de pulse_responses para preservar anonimato: el DB nunca correlaciona user_id con score/comment. Un atacante con acceso total a DB no puede deducir qué respondió cada persona.

Nueva tabla **`pulse_settings`** — configuración por tenant:
```
pulse_settings
  id uuid pk
  tenant_id uuid unique
  enabled boolean default false
  send_day_of_week smallint default 3  -- miércoles
  send_hour smallint default 10  -- 10am local timezone
  min_responses_for_aggregate smallint default 3
  nudge_threshold_drop_pct decimal(4,2) default 0.15  -- 15% drop
  nudge_consecutive_weeks_below decimal(3,2) default 3.5
  updated_at
```

#### Service methods (nuevo módulo `pulse/pulse.service.ts`)
```
enablePulseForTenant(tenantId, dto): PulseSettings
scheduleWeeklyPulse(): cron body — calcula tenants que toca ejecutar ESTA semana
  - respeta timezone del tenant
  - selecciona próxima pregunta del pool rotando por tenant (round-robin sobre pulse_questions activas)
  - crea pulse_cycles row
  - envía push + in-app notif a todos los users activos del tenant (excluye external)
submitResponse(tenantId, userId, cycleId, score, emoji?, comment?): void
  - valida pulse_participation para idempotencia
  - inserta pulse_responses y pulse_participation en transacción
  - incrementa response_count
getAggregateForManager(tenantId, managerId, weeksBack): PulseAggregate
  - agrupa respuestas de todos los reportes directos del manager
  - retorna { avgScore, count, trend: [{week, avg, count}], byCategory: [...] }
  - si count < min_responses_for_aggregate → retorna { insufficient: true, count }
getAggregateForTenant(tenantId): similar para tenant_admin
detectAndFireNudges(): cron weekly post-cycle — para cada manager, calcula drop vs semana anterior
  - si drop > nudge_threshold_drop_pct → crea Notification type PULSE_ALERT_DROP
  - si 2 semanas consecutivas < nudge_consecutive_weeks_below → Notification PULSE_ALERT_SUSTAINED
```

#### API endpoints (nuevo `pulse/pulse.controller.ts`)
- `GET /pulse/current` → obtiene el pulse_cycle activo para el user + si ya respondió.
- `POST /pulse/responses` → `{ cycleId, score, emoji?, comment? }`, `@Roles(all)`, rate-limited a 1 por user por cycleId.
- `GET /pulse/aggregate/me` → para manager, si es tenant_admin default manager scope all teams.
- `GET /pulse/aggregate/tenant` → `@Roles('tenant_admin')`.
- `GET /pulse/settings`, `PATCH /pulse/settings` → `@Roles('tenant_admin')`.
- `GET /pulse/questions`, `POST /pulse/questions`, `PATCH /pulse/questions/:id` → `@Roles('tenant_admin')`, customización.
- `POST /pulse/opt-out` → el usuario puede salir individualmente.

#### Integraciones con otros módulos
- **`NotificationsService`**: nuevos `NotificationType`: `PULSE_PENDING`, `PULSE_ALERT_DROP`, `PULSE_ALERT_SUSTAINED`.
- **`PushService`**: nuevo evento `'pulse'` en `PushEventType`, mensaje en `push-messages.ts`.
- **`AiInsightsService`** (opcional para F2.2): analizar comentarios en agregado usando IA para detectar temas — ver F4 coach.

#### Workers / crons / jobs
- `@Cron('0 10 * * 3')` — `scheduleWeeklyPulse()` (miércoles 10am UTC; el método aplica timezone shift por tenant usando `settings.send_day_of_week`+`send_hour`). Con `runWithCronLock('pulseWeeklySchedule', ...)`.
- `@Cron('0 10 * * 2')` — `detectAndFireNudges()` martes 10am (después que cierra el cycle del miércoles previo). Con cron lock.
- `@Cron(CronExpression.EVERY_6_HOURS)` — reminder push a quienes no respondieron (2 reminders máximo por cycle).

### Frontend
#### Páginas y componentes nuevos
- `apps/web/src/app/dashboard/pulso/page.tsx` — página principal:
  - Si hay cycle activo sin responder → card grande con pregunta + botones score 1-5 + emojis + textarea comment opcional.
  - Si ya respondió → "Gracias. Pulso cierra el {day}". Ver tendencia personal anonimizada.
- `apps/web/src/app/dashboard/pulso/equipo/page.tsx` — tab manager: trend 8 semanas, por categoría, comentarios agregados (si ≥3).
- `apps/web/src/app/dashboard/pulso/configuracion/page.tsx` — `@Roles('tenant_admin')`, gestión de settings + catálogo preguntas.
- `components/pulse/PulsePromptCard.tsx` — dashboard widget.
- `components/pulse/PulseTrendChart.tsx` — reusa Recharts (`DynamicCharts.tsx`).
- `components/pulse/InsufficientResponsesCard.tsx` — "Necesitas 3 respuestas; actualmente 2".

#### Hooks de React Query (en nuevo `apps/web/src/hooks/usePulse.ts`)
- `useCurrentPulse()` → `queryKey: ['pulse', 'current', userId]`, staleTime: 5min.
- `useSubmitPulseResponse()` → invalida `['pulse', 'current', userId]` y `['pulse', 'aggregate', ...]` del manager.
- `useTeamPulseAggregate(weeksBack)` → manager view.

#### Componentes compartidos a crear
- **`AnonymityNotice`** — card gris con icono 🔒 "100% anónimo. Tu manager ve solo agregados ≥3 respuestas". Reusable por F3.

### Datos y privacidad
- **Decisión crítica anonimato:** no hay `respondent_id` en `pulse_responses`. Correlación solo por snapshots. La tabla `pulse_participation` NO contiene el score.
- **Min 3 respuestas** antes de mostrar agregado a manager — hardcoded a `pulse_settings.min_responses_for_aggregate` (default 3, mínimo enforced 3 aunque el tenant baje el valor).
- **Ley Karin (Chile):** comentario opcional — si contiene palabras de alerta (acoso, discriminación — lista configurable en `pulse_questions.moderation_keywords`), se marca `comment` con flag y se envía notif a HR designado. Feature por separado en F3 (no en F2 v1).
- **Retención:** pulse_responses se guardan 18 meses (audit) pero se anonimizan aún más tras 6 meses (se borra `department_snapshot` y `manager_id_snapshot`).
- **GDPR:** el DSAR (data subject access request) NO retorna pulse_responses porque no hay correlación. Solo retorna `pulse_participation` (hecho de que participó).

### Tareas desglosadas
1. **[S]** Crear módulo `pulse` con estructura estándar (controller/service/module/entities/dto).
2. **[M]** Migración `CreatePulseTables` — 4 tablas con índices en `(tenant_id, pulse_cycle_id)`, `(tenant_id, created_at)`.
3. **[M]** Seed de 6 preguntas default por tenant on subscription activation (hook en `subscriptions.service.ts`).
4. **[L]** Servicio completo con cron, aggregate queries (requieren performance testing).
5. **[M]** Controller + DTOs con `class-validator` + rate limiting explícito en submit.
6. **[M]** Página respondedor + componentes visuales (emoji picker, score buttons).
7. **[M]** Dashboard manager agregado + chart trend.
8. **[S]** Dashboard tenant_admin tenant-wide.
9. **[S]** Settings UI + editor de preguntas.
10. **[S]** Push + email templates (miércoles).
11. **[S]** Nudges: tipo notificación + lógica cron.
12. **[S]** i18n en 3 idiomas.
13. **[M]** Tests: anonimato (query SQL que intente reconstruir user_id→score no debe poder), 3+ respuestas gate, nudge trigger.

**Total:** ~14-17 días-dev.

### Dependencias
- **Internas:** ninguna.
- **Externas:** push + email ya operativos.

### Riesgos
- **Fatiga de notificaciones:** el miércoles 10am se acumula con otras pushes → quiet hours ya existentes lo mitigan. Limitar a 2 reminders.
- **Privacidad percibida:** aunque sea anónimo técnicamente, usuarios sospechan. Mitigación: documentación pública + explicación en primer pulso + opción opt-out fácil.
- **Agregados inutilizables en equipos chicos:** un manager con 3 reportes siempre cumple el mínimo, pero con 2 nunca. Trade-off aceptable.

---

## F3. Check-in del Ánimo Diario

### Resumen ejecutivo
**Problema:** F2 captura señal semanal. F3 captura señal diaria, de bajo compromiso (1 tap), con potencial de **detectar caídas sostenidas antes del pulso semanal**.

**Valor:**
- **Employee:** trend personal (self-awareness), posibilidad de pedir ayuda discreta.
- **Manager / RRHH:** señal temprana de burnout / agotamiento en el equipo (agregado).
- **Empresa (Chile):** cumplimiento con Ley Karin — vía de escalamiento anónima.

**KPI de éxito:** adopción 7-day (al menos 1 mood/día durante 7 días) ≥40% empleados activos + tasa de escalamientos Karin atendidos (target 100%).

### Usuarios y roles
- **Employee:** tap diario. Ve su propio trend. Elige notificar a RRHH si 3 😫 seguidos (opt-in en el momento).
- **Manager:** ve agregado de equipo ≥5 miembros; NUNCA individual.
- **tenant_admin (o rol `hr` si creamos uno):** recibe alertas Karin anonimizadas con contexto (depto, NO identidad) + puede iniciar protocolo Karin externo.
- **super_admin:** sin acceso a moods individuales ni agregados.

### Ubicación en la UI
- **Login-land (primer impacto):** al entrar al dashboard, si no hay mood de hoy → card grande centrada pidiendo 1 tap (máx 1 vez/día).
- **Widget permanente** en sidebar top (mini): últimos 7 días como dots de colores.
- **Sidebar CLIMA ORGANIZACIONAL:** "Mi Estado de Ánimo" → `/dashboard/animo` (trend personal completo).
- **Para tenant_admin/hr:** dentro de `CLIMA ORGANIZACIONAL → Alertas Karin` → `/dashboard/animo-alertas`.

### Backend
#### Entities nuevas o modificadas
Nueva tabla **`mood_entries`**:
```
mood_entries
  id uuid pk
  tenant_id uuid
  user_id uuid (FK)
  mood_score smallint  -- 1..5 (1=😫 muy mal, 5=😀 excelente)
  mood_emoji varchar(8)  -- snapshot del emoji seleccionado
  note text  -- opcional, max 200 chars
  logged_on date NOT NULL  -- fecha local del usuario
  created_at timestamptz
  unique(tenant_id, user_id, logged_on)  -- 1 mood por día máx
```

Nueva tabla **`mood_karin_escalations`** — cuando el empleado opt-in a notificar RRHH:
```
mood_karin_escalations
  id uuid pk
  tenant_id uuid
  triggered_on date  -- día en que se activó la condición 3-seguidos
  -- SIN user_id — anonimato
  user_id_encrypted bytea  -- encripted con clave tenant para permitir seguimiento caso/cerrar sin revelar
  department_snapshot varchar(100)
  manager_id_snapshot uuid nullable
  status enum: 'open' | 'in_progress' | 'resolved' | 'dismissed'
  hr_notes text  -- notas de RRHH encryptadas
  resolved_at timestamptz nullable
  resolved_by uuid (tenant_admin user)
  created_at
```
La clave de encriptación `tenants.karin_encryption_key` (nueva columna bytea en `tenants`, generada al activar Karin). Usa `secret-crypto.ts` existente (AES-256-GCM).

**Configuración**: campo nuevo en `tenants` → `karin_compliance_enabled: boolean default false` + `karin_hr_contact_user_id: uuid nullable`.

#### Service methods (nuevo `mood/mood.service.ts`)
```
logMood(tenantId, userId, moodScore, emoji, note?): MoodEntry
  - UPSERT por (tenant, user, today local date) — permite cambiar el mood del día
  - Post-insert: evaluateKarinConditions(userId)

evaluateKarinConditions(userId): void
  - Obtiene últimos 3 días
  - Si todos son score=1 (😫) → offer(userId)
  - offer(userId): crea Notification tipo MOOD_KARIN_OFFER para el user
    (CTA con botón "Notificar a RRHH de forma anónima")

escalateToKarin(tenantId, userId): MoodKarinEscalation
  - Encripta user_id con tenant key
  - Snapshot department + manager
  - Crea escalation
  - Notifica HR contact
  - Audit (sin revelar identidad — el audit_log solo registra "karin_escalation.created" con escalation_id, no user)

getMyTrend(tenantId, userId, daysBack): MoodTrend
getTeamAggregate(tenantId, managerId, daysBack): requires ≥5 members activos ese periodo
getTenantAggregate(tenantId, byDepartment?: boolean): tenant_admin

resolveEscalation(tenantId, escalationId, action, notes): para HR
```

#### API endpoints (`mood/mood.controller.ts`)
- `POST /mood` → `{ moodScore, emoji, note? }`, idempotente por día.
- `GET /mood/today` → mood de hoy si existe.
- `GET /mood/trend?days=30` → personal.
- `GET /mood/team-aggregate?days=30` → manager.
- `GET /mood/tenant-aggregate?days=30` → tenant_admin.
- `POST /mood/escalate-karin` → user opt-in.
- `GET /mood/karin/escalations` → `@Roles('tenant_admin')` + requires `karin_compliance_enabled`.
- `PATCH /mood/karin/escalations/:id` → resolve.

#### Integraciones
- **`NotificationsService`:** nuevos tipos `MOOD_KARIN_OFFER`, `MOOD_KARIN_ESCALATED`.
- **`AuditService`:** nueva acción `mood.karin_escalated` — **no incluye `user_id` en los metadata** (usa `escalation_id`).
- **`AiInsightsService`** (futuro F3.1): análisis de `note` agregado por departamento (comentarios libres).

#### Workers / crons
- Ninguno core. Opcional: `@Cron('0 8 * * 1')` envía resumen semanal a tenant_admin con agregados mood trend tenant.

### Frontend
#### Páginas y componentes nuevos
- `components/mood/MoodPromptCard.tsx` — card grande con 5 emojis 😫😟😐🙂😀 + textarea note opcional.
- `components/mood/MoodWeekDots.tsx` — 7 dots coloreados (sidebar).
- `apps/web/src/app/dashboard/animo/page.tsx` — trend 30/90 días personal.
- `apps/web/src/app/dashboard/animo-alertas/page.tsx` — escalamientos Karin `@Roles('tenant_admin')`.
- `components/mood/KarinOptInModal.tsx` — confirmación explícita antes de escalar.

#### Hooks (nuevo `usePushMood.ts` o extender `useFeedback.ts`)
- `useMoodToday()`, `useLogMood()`, `useMoodTrend(days)`, `useTeamMoodAggregate()`, `useEscalateKarin()`.

### Datos y privacidad
- **Anonimato Karin:** `user_id` NUNCA en plaintext tras escalamiento. HR ve "persona del depto X, manager Y" sin más.
- **Ley Karin Chile:** Art. 211-A Código Trabajo. La plataforma **ofrece** el escalamiento pero no obliga. La decisión legal de activar protocolo Karin sigue siendo de la empresa.
- **Retención:** `mood_entries` retención 12 meses default. `mood_karin_escalations` se retienen indefinidamente mientras el caso esté abierto; cierre anonimiza más (borra snapshots y notas cripteadas).
- **GDPR:** DSAR retorna `mood_entries` del usuario (es suyo). NO retorna escalations porque son anónimas.
- **Mobile-first:** el 1-tap de emoji debe funcionar perfecto en móvil; tap area ≥48px.

### Tareas desglosadas
1. **[S]** `PlanFeature.MOOD_TRACKING` + migraciones de plan (Growth+).
2. **[M]** Migraciones `CreateMoodTables` + `AddKarinToTenants` (2 migraciones separadas).
3. **[M]** Encriptación user_id para Karin — reusar `secret-crypto.ts`; generar key por tenant al activar Karin.
4. **[L]** Servicio completo con evaluateKarinConditions + aggregate queries.
5. **[S]** Controller.
6. **[M]** `MoodPromptCard` + `KarinOptInModal` + tap UX.
7. **[M]** Páginas `/dashboard/animo` + `/dashboard/animo-alertas`.
8. **[S]** Widget sidebar `MoodWeekDots`.
9. **[S]** Settings Karin en `/dashboard/ajustes/clima`.
10. **[S]** Push + email de recordatorio diario (opt-out).
11. **[M]** Tests: anonimato Karin, 1-mood-per-day idempotency, escalamiento flow, min 5 para agregado manager.
12. **[S]** Legal review del texto UI Karin (con asesor legal Chile).

**Total:** ~12-15 días-dev (+ legal review asincrónico).

### Dependencias
- **Internas:** ninguna.
- **Externas:** legal review Chile.

### Riesgos
- **Adopción:** si se pide todos los días se vuelve molesto. Mitigación: opt-out fácil + cap a 1 notif por día.
- **Legal:** Ley Karin mal implementada expone a la empresa a demandas. Mitigación: review legal + disclaimer "esta herramienta es complementaria, no reemplaza protocolo formal".
- **Privacidad percibida:** usuarios no creerán el anonimato. Mitigación: documentación técnica pública + video de 60s.

---

## F4. Coach IA del Manager

### Resumen ejecutivo
**Problema:** managers (especialmente first-time managers) no saben qué hacer. El producto ya tiene todos los datos (OKRs, feedback, checkins, mood) pero no los sintetiza en acciones.

**Valor:**
- **Manager:** una bandeja de entrada con 3-5 "cosas que hacer esta semana".
- **Empresa:** multiplica el impacto del feedback de equipo.

**KPI de éxito:** % de managers activos semanalmente con recomendaciones abiertas (target ≥70%) + % de recomendaciones marcadas "hecho" (target ≥30%).

### Usuarios y roles
- **Manager:** recibe coach briefs pre-1:1, revisor feedback, recomendaciones semanales.
- **tenant_admin:** configuración on/off + review de briefs del equipo sin leer detalles (solo conteos).
- **Employee:** sin interfaz directa — sí se beneficia indirectamente del mejor feedback del manager.

### Ubicación en la UI
- **Sidebar nuevo ítem en SEGUIMIENTO CONTINUO:** "Coach IA" → `/dashboard/coach`.
- **Integración en páginas existentes:**
  - Página de agenda mágica (F1) → tab "Brief del Manager" con narrative.
  - Modal "Nuevo feedback" (crear QuickFeedback) → botón "Revisar con IA" antes de enviar.
  - Dashboard home → widget "Top 3 recomendaciones esta semana".

### Backend
#### Entities nuevas o modificadas
Reusar `AiInsight` con tipos nuevos:
- `InsightType.MANAGER_BRIEF` — pre-1:1 brief (userId = employee del brief, cycleId = NULL → nuevo campo `scope_entity_id = checkin_id`).
- `InsightType.FEEDBACK_COACH` — revisor feedback (scope_entity_id = draft feedback id temporal).
- `InsightType.MANAGER_RECOMMENDATIONS` — top 3-5 acciones semanales (userId = manager, semanal).

**Extender `AiInsight` con campo `scope_entity_id uuid nullable`** para que sirva a entidades no-cycle (checkin, feedback draft, etc.). Migración `AddScopeEntityIdToAiInsights`.

Nueva tabla **`manager_recommendations`** — separada porque tiene estado de acción:
```
manager_recommendations
  id uuid pk
  tenant_id uuid
  manager_id uuid (FK users)
  week_starts_on date
  title varchar(200)
  rationale text
  priority enum: 'high'|'med'|'low'
  action_type enum: 'schedule_1on1'|'give_feedback'|'review_okr'|'update_pdi'|'celebrate_kudos'|'check_wellbeing'
  target_user_id uuid nullable (FK users) -- a quién refiere la acción
  target_entity_id uuid nullable -- objective, okr, etc.
  status enum: 'open'|'done'|'dismissed' default 'open'
  done_at timestamptz nullable
  source_insight_id uuid (FK ai_insights)
  created_at
```

#### Service methods (nuevo `coach/coach.service.ts`)
```
generateManagerBrief(tenantId, checkinId, userId, role): AiInsight
  - Validate manager scope
  - Recolecta: 4 semanas de QuickFeedback, 4 OKRs, check-ins previos, mood trend (agregado > 5, sino opaco), pulse agregado > 3
  - buildManagerBriefPrompt() - sistema prompt que distingue "celebrar" vs "abordar"
  - Llama Claude API vía ensureClient()
  - Persiste insight
  - Return con structured output { celebrate, address, suggestedQuestions[], redFlags[] }

reviewFeedbackDraft(tenantId, managerId, draft: { toUserId, message, sentiment, category? }): AiInsight
  - Reenvía a Claude con prompt "Mejorar este feedback constructivo"
  - Structured output { toneAssessment, improvedVersion, missingElements[], bias }
  - NO persiste el draft — solo el insight (es un review)

generateWeeklyRecommendations(): cron
  - Para cada manager activo, corre analyzer
  - Top 3-5 recommendations persistidas en manager_recommendations
  - Notifica al manager (push + in-app)

markRecommendation(tenantId, recId, userId, status): toggles done/dismissed
```

#### API endpoints
- `POST /coach/brief/checkin/:checkinId` — manager genera brief (cuenta quota).
- `POST /coach/feedback/review` — review live, cuota baja (prompt corto).
- `GET /coach/recommendations?weekStart=` — manager ve recomendaciones.
- `PATCH /coach/recommendations/:id` — mark done/dismissed.
- `GET /coach/blind-spots` — alertas tipo "hace X semanas no das feedback a Y".

#### Integraciones
- **`AiInsightsService`:** nuevos prompts en `apps/api/src/modules/ai-insights/prompts/` → `manager-brief.prompt.ts`, `feedback-review.prompt.ts`, `manager-recommendations.prompt.ts`.
- **`FeedbackService`:** brief alimenta agenda F1. La agenda del F1 puede mostrar un resumen del brief como primer bloque.
- **`MoodService` + `PulseService`:** coach consume agregados con misma regla de mínimos.
- **`NotificationsService`:** nuevos tipos `COACH_BLIND_SPOT_ALERT`, `COACH_WEEKLY_RECOMMENDATIONS`.
- **`SubscriptionsService`:** el coach es la feature más costosa en tokens — plan Enterprise con default 500 calls/mo.

#### Workers / crons
- `@Cron('0 7 * * 1')` — `generateWeeklyRecommendations()` lunes 7am, reusar `runWithCronLock('coachWeeklyRecommendations',...)`.
- `@Cron('0 9 * * MON')` — `detectBlindSpots()` analiza patterns tipo "4+ semanas sin feedback a X".

### Frontend
- `apps/web/src/app/dashboard/coach/page.tsx` — dashboard coach.
- `apps/web/src/app/dashboard/coach/recommendations/page.tsx` — lista semanal.
- `components/coach/ManagerBriefCard.tsx` — en agenda mágica F1.
- `components/coach/FeedbackReviewModal.tsx` — reviewer con diff.
- `components/coach/BlindSpotCard.tsx` — alertas.
- Hooks en `useCoach.ts`.

### Datos y privacidad
- Brief y recommendations son **insights derivados** — no contienen PII nueva más allá de lo que ya ve el manager.
- **Rate limit:** Feedback review es tentador para abuso → límite 30 reviews/día per manager.
- **Storage:** `manager_recommendations` retención 6 meses.

### Tareas desglosadas
1. **[S]** `PlanFeature.AI_COACH` + Enterprise only.
2. **[M]** Migraciones: `AddScopeEntityIdToAiInsights` + `CreateManagerRecommendations`.
3. **[M]** 3 prompts nuevos + template de structured output JSON.
4. **[M]** Service `coach.service.ts`: generateBrief, reviewFeedback, weeklyRecommendations.
5. **[M]** Blind-spot detector (reglas sobre fechas: 4+ semanas sin feedback, etc.).
6. **[S]** Controller + DTOs.
7. **[M]** Página dashboard coach + componentes.
8. **[M]** Feedback review modal + integración con creación de QuickFeedback.
9. **[S]** ManagerBriefCard + integración F1.
10. **[S]** i18n.
11. **[M]** Tests: rate limit review (30/day), blind-spot thresholds, weekly cron idempotency.

**Total:** ~17-22 días-dev.

### Dependencias
- **Internas:** **F1 (MAGIC_MEETINGS)** — manager brief se integra en la agenda mágica.
- **Externas:** Claude API (obligatorio).

### Riesgos
- **Costo de tokens:** revisor feedback live con cada "enter" es caro. Mitigación: no tiempo real, solo al click "Revisar con IA".
- **Hallucination:** IA puede decir "X tiene un OKR bajo" cuando no es cierto. Mitigación: siempre citar data source (`"basado en OKR 'Mejorar NPS' con 20% avance"`).
- **Privacy concern:** employees pueden sentir que la IA los "juzga". Mitigación: nada va al employee directamente; el output es para el manager.

---

## F5. Flight Risk + Plan de Retención

### Resumen ejecutivo
**Problema:** rotación no detectada → costosa. Señales existen pero dispersas.

**Valor:**
- **tenant_admin:** dashboard "Top 10 en riesgo" con plan.
- **Manager:** acción específica por persona.
- **Empresa:** ROI directo (retener empleado > reemplazar).

**KPI de éxito:** tasa de retención de empleados flagged "alto riesgo" (target ≥60% a 90 días post-flag) vs baseline tenant.

### Usuarios y roles
- **tenant_admin:** vista tenant-wide.
- **Manager:** ve solo su equipo.
- **Employee:** NUNCA ve el flag. Trátese como PII sensible.
- **super_admin:** sin acceso directo (respeto multi-tenant).

### Ubicación en la UI
- **Sidebar nuevo ítem en TALENTO Y DESARROLLO:** "Riesgo de Rotación" → `/dashboard/flight-risk`.

### Backend
#### Entities nuevas o modificadas
Aprovechar `InsightType.FLIGHT_RISK` ya existente. Nueva tabla para acciones:
```
retention_plans
  id uuid pk
  tenant_id uuid
  user_id uuid (FK users)  -- el empleado en riesgo
  current_score decimal(5,2)  -- 0-100
  risk_level enum: 'low'|'med'|'high'|'critical'
  drivers jsonb  -- [{signal, contribution_pct}] ej: [{signal:'low_engagement',p:35}]
  recommended_actions jsonb  -- [{action_id, title, description, assignee_id}]
  status enum: 'active'|'retained'|'left'|'improved'|'dismissed'
  assigned_to uuid nullable
  next_review_date date
  last_recalculated_at timestamptz
  outcome_notes text nullable
  created_at, updated_at
  unique(tenant_id, user_id, status) WHERE status = 'active'
```

```
retention_action_log
  id uuid pk
  tenant_id uuid
  retention_plan_id uuid (FK)
  action_id varchar(50)
  action_title varchar(200)
  status enum: 'pending'|'done'|'skipped'
  executed_at timestamptz
  executed_by uuid
  outcome_notes text
  created_at
```

#### Service methods (nuevo `flight-risk/flight-risk.service.ts`)
```
calculateRiskScore(user): { score, level, drivers }
  Señales (pesos configurables):
    - pulse_avg < 3.0 last 4 weeks (15%)
    - mood_neg_ratio > 0.4 last 30d (10%)
    - no feedback received last 8w (10%)
    - OKR stagnant >30d (10%)
    - no 1:1 last 5w (15%)
    - no PDI (5%)
    - tenure in role > industry avg (10%) [requires optional role_benchmarks table]
    - negative feedback sentiment last 8w (10%)
    - salary below benchmark if available (5%)
    - received feedback but didn't take action (5%)
    - late to check-ins >3 times in 90d (5%)

recalculateAll(): nightly cron
generatePlanForUser(tenantId, userId): consulta IA
  - Reusa aiInsightsService con InsightType.FLIGHT_RISK
  - IA recibe drivers + contexto y retorna 3-5 acciones concretas
  - Crea retention_plans + retention_action_log(status=pending)

executeAction(...) / markActionDone
```

#### API endpoints
- `GET /flight-risk/dashboard?scope=team|tenant`
- `GET /flight-risk/user/:userId/plan`
- `POST /flight-risk/user/:userId/recalculate`
- `POST /flight-risk/user/:userId/generate-plan` (consume IA)
- `PATCH /flight-risk/action/:id` — mark done
- `PATCH /flight-risk/plan/:id/outcome` — marcar retenido/salió

#### Integraciones
- **`AiInsightsService`:** reusa InsightType.FLIGHT_RISK con nuevo prompt.
- **`MoodService`, `PulseService`, `ObjectivesService`, `FeedbackService`, `DevelopmentService`:** consumer read-only para signals.
- **`NotificationsService`:** `FLIGHT_RISK_NEW_HIGH`, `FLIGHT_RISK_ACTION_DUE`.

#### Workers / crons
- `@Cron('0 3 * * *')` — `recalculateAll()` nightly 3am con `runWithCronLock`.
- `@Cron('0 8 * * 1')` — weekly digest al tenant_admin.

### Frontend
- `/dashboard/flight-risk/page.tsx` — dashboard con tabla ordenada.
- `/dashboard/flight-risk/[userId]/page.tsx` — detalle con drivers + plan.
- `components/flight-risk/RiskGauge.tsx` — visual del score.
- `components/flight-risk/DriverBreakdown.tsx`.
- `components/flight-risk/ActionChecklist.tsx`.

### Datos y privacidad
- **Sensibilidad extrema:** employee NUNCA ve su propio flag. Enforce en backend: endpoints bloqueados para employee role.
- **Audit:** cada view del plan se audita.
- **Retention:** 24 meses post-resolución para ML training.
- **Evita discriminación:** el algoritmo no usa género/edad/nacionalidad. Documentar en compliance policy.

### Tareas desglosadas
1. **[S]** `PlanFeature.FLIGHT_RISK` + Pro+.
2. **[M]** Migraciones `CreateRetentionPlans`, `CreateRetentionActionLog`.
3. **[L]** Signal collector — unificar 10 queries.
4. **[M]** Score formula + test suite con fixtures.
5. **[M]** Prompt flight-risk IA.
6. **[S]** Controller.
7. **[L]** Dashboard tabla ordenada + filtros.
8. **[M]** Página detalle + plan UI + action checklist.
9. **[S]** Cron nightly.
10. **[S]** Weekly digest email tenant_admin.
11. **[M]** Permission tests (employee bloqueado siempre).
12. **[S]** Policy doc publicado.

**Total:** ~16-20 días-dev.

### Dependencias
- **Internas:** **F2 + F3** para alimentar signals (sin ellas, el score es pobre).
- **Externas:** Claude API.

### Riesgos
- **Falsos positivos:** flag incorrecto → manager actúa mal. Mitigación: gate ≥3 signals.
- **Sesgo algorítmico:** ver compliance.
- **Filtración:** empleado descubre flag → relación rota. Mitigación: enforce backend + audit + UI labels genéricos.

---

## F6. Hábitos del Líder — Streaks

### Resumen ejecutivo
**Problema:** managers olvidan disciplinas básicas. Gamificar mejora adopción.

**Valor:**
- **Manager:** dashboard claro.
- **tenant_admin:** métrica objetiva de adopción.

**KPI de éxito:** % managers con scorecard 100% semana consecutivas ≥4 (target ≥30%).

### Usuarios y roles
- **Manager:** su dashboard + streak.
- **tenant_admin:** leaderboard opcional.

### Ubicación en la UI
- **Sidebar TALENTO Y DESARROLLO:** "Mis Hábitos" (managers) → `/dashboard/habitos`.
- Badge pequeño permanente top bar con streak.

### Backend
#### Entities nuevas
```
leader_scorecards
  id uuid pk
  tenant_id uuid
  manager_id uuid (FK users)
  week_starts_on date
  checkins_completed int
  checkins_expected int
  feedback_given_count int
  direct_reports_given_feedback_count int
  total_direct_reports int
  pdi_reviews int
  okr_checkins_count int
  okr_total_count int
  score_percentage decimal(5,2)  -- 0-100
  is_perfect_week boolean default false
  unique(tenant_id, manager_id, week_starts_on)

leader_streaks
  id uuid pk
  tenant_id uuid
  manager_id uuid (FK users) unique(tenant_id, manager_id)
  current_streak int default 0
  longest_streak int default 0
  last_perfect_week date nullable
  next_milestone int  -- 4/12/26
```

Badges nuevos en `badges` catalog: `streak_4_weeks`, `streak_12_weeks`, `streak_26_weeks`, `first_perfect_week` — awarded via user_badges.

#### Service methods (`leader-habits/leader-habits.service.ts`)
```
calculateWeeklyScorecard(tenantId, managerId, weekStartsOn): LeaderScorecard
precomputeAllScorecards(): cron lunes
  - para cada manager activo, genera scorecard de la semana previa
  - actualiza streak
  - awards badges
getScorecard, getStreak, getLeaderboard (anonymized initials opt)
```

**Decisión performance:** NO cálculo on-the-fly. Cron lunes 2am precalcula todo. UI lee scorecards precalculados.

#### API endpoints
- `GET /leader-habits/scorecard?week=`
- `GET /leader-habits/streak`
- `GET /leader-habits/history?weeks=12`
- `GET /leader-habits/leaderboard` — anonymized (optional opt-in) — `@Roles('tenant_admin','manager')`.

#### Integraciones
- Lectura read-only de CheckIn, QuickFeedback, Objective, DevelopmentPlan.
- `RecognitionService` para awards badges.
- Push: `LEADER_STREAK_AT_RISK` (viernes 5pm si scorecard <70%).

#### Workers
- `@Cron('0 2 * * 1')` — `precomputeAllScorecards()` lunes 2am.
- `@Cron('0 17 * * 5')` — `streakAtRiskAlerts()` viernes 5pm.

### Frontend
- `/dashboard/habitos/page.tsx` — scorecard + streak + 4 rings.
- `/dashboard/habitos/historial/page.tsx` — timeline.
- `/dashboard/habitos/leaderboard/page.tsx` — tenant_admin anon.
- Badge en topbar `StreakBadge.tsx`.

### Datos y privacidad
- Leaderboard opt-in tenant. Iniciales "J.M." en lugar de nombre si no opt-in.
- Retention: scorecards 24 meses para trend.
- No es PII nuevo — métricas derivadas.

### Tareas desglosadas
1. **[S]** `PlanFeature.LEADER_STREAKS` + Growth+.
2. **[S]** Migraciones.
3. **[M]** Calculator con formula por categoría.
4. **[S]** Cron lunes + at-risk viernes.
5. **[S]** 4 badges nuevos.
6. **[M]** Dashboard scorecard UI con rings (Recharts).
7. **[S]** Streak visualization + milestones.
8. **[S]** Leaderboard page.
9. **[S]** Badge topbar.
10. **[S]** Push at-risk.
11. **[S]** i18n.
12. **[M]** Tests cálculo (mock semanas con/sin actividad).

**Total:** ~10-12 días-dev.

### Dependencias
- **Internas:** ninguna. Lee de módulos existentes.
- **Externas:** ninguna.

### Riesgos
- **Gamificación tóxica:** manager hace 1:1 "fantasma" para mantener streak. Mitigación: contar solo checkins `COMPLETED` con rating.
- **Performance del cron:** 500 managers × 4 queries = 2000 queries en 10min; ok con batching.

---

## F7. Muro de Reconocimiento Social

### Resumen ejecutivo
**Problema:** reconocimientos existen pero enterrados. Extender a feed social aumenta visibilidad.

**Valor:**
- **Employee:** ver celebraciones.
- **Empresa:** refuerzo valores + MVP del mes.

**KPI de éxito:** nuevos reconocimientos/semana (target +50%) + % empleados con ≥1 reacción/mes ≥50%.

### Usuarios y roles
- Todos ven feed.
- Employees reaccionan + comentan.
- tenant_admin elige visibilidad.

### Ubicación en la UI
- Reemplazar `/dashboard/reconocimientos/page.tsx` con layout 3 tabs:
  - **Feed** (nuevo) — timeline.
  - **MVP del Mes**.
  - **Dar reconocimiento** (ya existe).

### Backend
#### Entities modificadas
`Recognition` ya tiene `reactions`, `message`, `value_id`, `is_public`. Agregar:
- `recognition_comments` — nueva tabla (id, recognition_id, from_user_id, text, created_at, deleted_at).
- Campo `featured_mvp boolean default false` + `featured_at timestamptz nullable` en `recognitions`.
- Campo `tenant.recognition_visibility enum('all','department','department_only','private') default 'all'`.

```
mvp_of_the_month
  id uuid pk
  tenant_id uuid
  month varchar(7)  -- '2026-04'
  user_id uuid (FK)
  total_kudos_count int
  unique_givers_count int
  values_touched jsonb  -- [value_id...]
  announcement_notification_id uuid nullable
  unique(tenant_id, month)
```

#### Service methods (extender `recognition.service.ts`)
```
getFeed(tenantId, userId, filters, pagination): paginated
addReaction(tenantId, userId, recognitionId, emoji): toggle
addComment(tenantId, userId, recognitionId, text): RecognitionComment
deleteComment(...)
calculateMvpOfTheMonth(): cron día 1 de cada mes
  - cuenta reconocimientos recibidos mes anterior
  - tiebreaker: unique_givers > total_count > fecha más vieja
  - crea mvp_of_the_month
  - crea Notification MVP_ANNOUNCED a todos usuarios activos
  - awards badge "mvp_2026_04"
```

#### API endpoints
- `GET /recognitions/feed?cursor=&filters=` — cursor pagination.
- `POST /recognitions/:id/reactions`, `DELETE /recognitions/:id/reactions/:emoji`.
- `GET /recognitions/:id/comments`, `POST /recognitions/:id/comments`, `DELETE /recognitions/comments/:id`.
- `GET /recognitions/mvp/current`, `GET /recognitions/mvp/history`.
- `PATCH /tenants/recognition-visibility` — `@Roles('tenant_admin')`.

#### Integraciones
- **`NotificationsService`:** nuevos `MVP_ANNOUNCED`, `RECOGNITION_REACTED`, `RECOGNITION_COMMENTED`.
- **`PushService`:** evento `'kudos'`.

#### Workers
- `@Cron('0 9 1 * *')` — `calculateMvpOfTheMonth()` día 1 mes a las 9am.

### Frontend
- `/dashboard/reconocimientos/page.tsx` extendido con tabs.
- `components/recognition/RecognitionFeedItem.tsx` — cada item.
- `components/recognition/ReactionPicker.tsx`.
- `components/recognition/CommentThread.tsx`.
- `components/recognition/MvpHeroCard.tsx`.
- Hook `useRecognition.ts` extendido: `useRecognitionFeed`, `useReactToRecognition`, `useCommentOnRecognition`, `useMvpOfMonth`.

### Datos y privacidad
- **Visibilidad departamental:** filtrado backend, no UI.
- **Comentarios:** soft-delete, moderación edit 5 min.
- **MVP:** employee puede opt-out de ser MVP público.

### Tareas desglosadas
1. **[S]** `PlanFeature.SOCIAL_KUDOS` + Growth+.
2. **[S]** Migraciones: recognition_comments + featured_mvp + tenant.recognition_visibility + mvp_of_the_month.
3. **[M]** Feed query con cursor pagination.
4. **[M]** Reactions + comments service.
5. **[M]** Calculate MVP cron + tiebreaker.
6. **[M]** Feed timeline UI.
7. **[S]** Reacciones picker + toggle.
8. **[S]** Comment thread + soft-delete.
9. **[S]** MVP hero card + history.
10. **[S]** Settings visibility tenant_admin.
11. **[S]** Push "recibiste kudos" + "MVP".
12. **[S]** i18n.
13. **[M]** Tests: visibility department, tiebreaker MVP, cursor pagination.

**Total:** ~11-14 días-dev.

### Dependencias
- **Internas:** ninguna (extiende recognition).
- **Externas:** ninguna.

### Riesgos
- **Favoritismo:** un grupo reconociéndose a sí mismo domina MVP. Mitigación: tiebreaker por unique_givers.
- **Feed overload:** tenant con 500 personas genera >1 post/día. Mitigación: digest opcional.

---

## Phasing recomendado

### **v3.1 "Rituals"** (F1 + F6) — ~4 semanas
**Razones:**
- **ROI inmediato:** F1 toca 100% managers activos. F6 añade gamificación sobre F1 data.
- **Sin dependencias externas mayores:** F1 usa IA opcional (no bloquea).
- **Riesgo bajo:** ambas extienden modelos existentes.

**Trigger:** listo para producción cuando dogfooding interno (2 semanas) muestra ≥3/5 managers satisfechos.

### **v3.2 "Voice"** (F2 + F3) — ~5 semanas
**Razones:**
- **Alimentan F4/F5** con datos.
- **ROI moderado, riesgo medio-alto** (Karin + anonimato requieren testing exhaustivo).
- **Legal review Karin** en paralelo.

**Trigger:** después de v3.1 estable 4 semanas, legal review Karin completo.

### **v3.3 "Intelligence"** (F4 + F5 + F7) — ~7 semanas
**Razones:**
- F4 depende conceptualmente de F1 (agenda) + F2/F3 (datos).
- F5 depende fuertemente de F2/F3.
- F7 es independiente → podría ir en v3.2 si hay capacidad.

**Trigger:** v3.1 + v3.2 maduras; ≥3 tenants Enterprise han consumido IA v2 sin quejas.

### Alternativa "Launch acelerado" (3-4 meses totales)
Si equipo es 3+ devs full-time: paralelizar F1+F6 (dev A), F2+F3 (dev B), F7 (dev C) en los primeros 2 meses, luego F4+F5 en meses 3-4.

---

## Infraestructura compartida requerida

### Backend
1. **Event bus ligero (opcional):** actualmente servicios llaman a NotificationsService directo. Para F4 coach/F5 flight-risk que reaccionan a múltiples eventos (feedback.created, mood.low, okr.stagnant), considerar EventEmitter2 (`@nestjs/event-emitter`). NO bloqueante. **Recomendación:** empezar con llamadas directas, refactorizar a EventEmitter2 si F4/F5 acumulan >10 listeners.
2. **Fila de jobs (BullMQ) para IA:** hoy todo es sincrónico. F1 brief puede tardar 2-3s → ok. F4 cron weekly de 100+ managers → >3min. **Recomendación:** sin BullMQ; correr cron con `p-limit(5)` concurrency + cron lock ya disponible.
3. **Cache Redis:** para F6 streaks + F7 feed cursor pagination. Actualmente no hay Redis en producción. **Recomendación:** Postgres suficiente con índices; re-evaluar si F6/F7 degradan.

### Librerías nuevas
- `p-limit` — concurrency control (dev dependency, minúscula).
- Nada más. `@anthropic-ai/sdk` ya instalado.

### Migraciones DB cross-feature
- 1 migración central `AddPlanFeaturesV31.ts` — INSERT en subscription_plans features arrays nuevos keys a los 4 planes.
- 1 migración `AddNotificationTypesV31.ts` — ALTER TYPE notificaciones enum con 12 valores nuevos. **CRÍTICO:** este enum en Postgres requiere ALTER TYPE ADD VALUE (1 por 1, no transaccional). Crear sub-migración que agrupe.

---

## Compliance y privacidad

### Ley Karin (Chile)
- **F3 mood Karin:** review legal.
- **F2 pulse:** comentarios con palabras clave también alimentan flag (v3.2).
- **Documentación:** DPIA público `docs/compliance/DPIA-mood-karin.md`.

### GDPR
- **DSAR:** responde con datos de ese user específico; **NUNCA** retorna `pulse_responses` ni `mood_karin_escalations` individualmente (anónimos por diseño).
- **Derecho al olvido:** al borrar user, `mood_entries` borran; `pulse_participation` se borra pero `pulse_responses` quedan intactos.
- **Minimización:** F5 algoritmo sin género/edad/nacionalidad.

### Chile Ley 19.628 (Protección Vida Privada)
- Consentimiento implícito por TOS + explícito cuando emp. activa F3.
- Update TOS `docs/contratos-legales/03-Terminos-y-Condiciones.md` + privacy policy con nuevos tratamientos.

### Contractual
- Extender DPA `02-DPA-Acuerdo-Procesamiento-Datos.md` Anexo A: "Eva360 procesa mood, pulse responses, flight risk scores" con bases legales por cada.

---

## Métricas para medir éxito post-launch

### F1 Agenda Mágica
- Semana 1-2: generaciones/day, % checkins con agenda generada.
- Semana 4: ratio checkins con ≥1 actionItem pre/post.
- Semana 12: tiempo medio agendamento→completado (target baja 20%).

### F2 Pulso Semanal
- Semana 1: tasa respuesta 1er miércoles.
- Semana 4: tasa respuesta estabilizada (target ≥60%).
- Semana 8: nudges disparados + acción tomada.

### F3 Mood
- Semana 1-2: adopción 7-day.
- Semana 4: % mood logged diario por user activo.
- Semana 12: escalamientos Karin + tasa resolución.

### F4 Coach IA
- Semana 1-2: briefs generados, % manager con ≥1 brief/semana.
- Semana 4: % recomendaciones "done".
- Semana 12: correlación recommendations done vs mejora pulse equipo.

### F5 Flight Risk
- Semana 1-4: personas flag high; distribución levels.
- Semana 12: retention rate de flagged high (target ≥60%) vs baseline.
- Semana 24: ROI estimado (avoided_turnover_cost - plan_costs).

### F6 Streaks
- Semana 1-4: % managers con scorecard generado.
- Semana 8: % managers con streak ≥4 semanas (target ≥30%).
- Semana 12: badges otorgados / retention managers.

### F7 Muro Social
- Semana 1-2: reactions/comments por recognition.
- Semana 4: nuevos reconocimientos vs baseline pre-feed.
- Mes 1 post-MVP: engagement MVP announcement.

---

## Tabla final de feature keys

| Key                 | Plan mínimo | Feature                                   | AI required |
|---------------------|-------------|-------------------------------------------|-------------|
| `MAGIC_MEETINGS`    | Pro         | Agenda mágica de 1:1                      | Opcional    |
| `PULSE_SURVEYS`     | Growth      | Pulso semanal anónimo                     | No          |
| `MOOD_TRACKING`     | Growth      | Check-in del ánimo diario                 | No          |
| `AI_COACH`          | Enterprise  | Coach IA del manager                      | **Sí**      |
| `FLIGHT_RISK`       | Pro         | Flight risk + plan retención              | **Sí**      |
| `LEADER_STREAKS`    | Growth      | Hábitos del líder                         | No          |
| `SOCIAL_KUDOS`      | Growth      | Muro de reconocimiento social             | No          |

---

### Critical Files for Implementation

Los archivos más críticos para implementar este plan (absolutos):

- `C:\Users\ricar\OneDrive\Documentos\CLAUDE\EvaPro\apps\api\src\common\constants\plan-features.ts` — agregar 7 nuevas feature keys y extender `PLAN_FEATURES` por tier.
- `C:\Users\ricar\OneDrive\Documentos\CLAUDE\EvaPro\apps\api\src\modules\ai-insights\ai-insights.service.ts` — agregar `generateAgendaSuggestions()`, `generateManagerBrief()`, `reviewFeedbackDraft()`, `generateFlightRiskPlan()` y los nuevos `InsightType` (4 nuevos).
- `C:\Users\ricar\OneDrive\Documentos\CLAUDE\EvaPro\apps\api\src\modules\notifications\entities\notification.entity.ts` — agregar 12 `NotificationType` nuevos para pulse/mood/coach/flight-risk/streaks/kudos.
- `C:\Users\ricar\OneDrive\Documentos\CLAUDE\EvaPro\apps\api\src\modules\feedback\entities\checkin.entity.ts` y `feedback.service.ts` — extender con `magicAgenda` jsonb + lógica F1.
- `C:\Users\ricar\OneDrive\Documentos\CLAUDE\EvaPro\apps\web\src\lib\feature-routes.ts` — agregar rutas `/dashboard/pulso`, `/dashboard/animo`, `/dashboard/coach`, `/dashboard/flight-risk`, `/dashboard/habitos` con sus features asociados y labels i18n.