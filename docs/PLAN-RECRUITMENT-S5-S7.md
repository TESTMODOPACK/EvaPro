# Plan de Implementación — Recruitment S5 / S6 / S7

**Estado**: Borrador — pendiente aprobación stakeholders.
**Autor**: Auditoría post-S4.
**Versión**: v1 (2026-04-30).
**Predecesor**: Sprints S1-S4 ya en producción (commits `9e33a5b` y previos).

Este documento extiende el plan original (S1-S4) con tres sprints adicionales
agrupados por **área de impacto**: soporte/compliance, UX/producto y calidad
técnica. Cada sprint puede ejecutarse independientemente; las dependencias
están explícitas en cada subtarea.

> **Regla operativa heredada**: cada subtarea termina con **revisión
> exhaustiva de bugs** y commit independiente. El merge a `main` sucede al
> final de cada sprint completo (no por subtarea).

---

## Resumen ejecutivo

| Sprint | Foco | Subtareas | Esfuerzo estimado | Bloqueante |
|--------|------|-----------|-------------------|------------|
| **S5** | Quick wins compliance + foundation | 3 | 5–7 días | No |
| **S6** | UX/Producto visible | 3 | 8–11 días | Solo S6.3 depende de S5.3 |
| **S7** | Features grandes (opcionales) | 2 | 10–15 días | S7.1 depende de S5.1 (email) |

**Recomendación de priorización**:
1. S5 completo → unblock workflows manuales hoy + base de tests para refactors futuros.
2. S6 completo → impacto visible para el cliente; el módulo deja de "verse plano" frente a competidores.
3. S7 según pipeline comercial: S7.1 (job board) si el cliente pide self-service, S7.2 (calendar) si hay demanda de integraciones.

---

## Sprint 5 — Quick wins compliance + foundation

**Objetivo**: cerrar gaps operativos detectados en S4 y crear la red de
tests que protege todo lo construido en S1-S4.

**Branch**: `feat/s5-recruitment-quick-wins`.
**Esfuerzo**: 5–7 días (1.5 días promedio por subtarea + buffer review).

### S5.1 — Email automático al ganador externo del hire

**Problema actual**: `hireCandidate` para externos crea cuenta + retorna
`tempPassword` al admin, pero no envía email automático al candidato. El
admin debe copiar el password y enviarlo manualmente — propenso a:
- Errores tipográficos al copiar/pegar.
- Olvido (admin cierra modal, candidato nunca recibe acceso).
- Filtración (password queda en historial de chat / WhatsApp / SMS).

**Alcance**:
1. **Backend** (`apps/api/src/modules/recruitment/recruitment.service.ts`):
   - En `hireCandidate` rama externo, después del commit de la transacción
     (post-event-emit), llamar a `notificationsService` o `emailService`
     para enviar email de bienvenida con `tempPassword` + URL de login.
   - Crear template específico `recruitment_hire_external.hbs` (no
     reutilizar `sendInvitation` porque el contexto es distinto: ya está
     hirado, no es invitación a evaluar).
   - Email idempotente: registrar audit log `recruitment.hire_email_sent`
     con `candidateId` para evitar reenvío doble si el admin ejecuta el
     hire dos veces (que no debería poder, pero defense-in-depth).

2. **Backend** — agregar endpoint manual:
   - `POST /recruitment/candidates/:id/resend-welcome-email`
   - Solo `tenant_admin`, solo para externos en stage `hired`.
   - Genera nuevo `tempPassword`, persiste en `users.passwordHash`, marca
     `mustChangePassword=true`, envía email. Audit log
     `recruitment.welcome_email_resent`.

3. **Frontend** (`apps/web/src/app/dashboard/postulantes/[id]/page.tsx`):
   - Si candidato es `hired` + externo, mostrar botón "Reenviar email de
     bienvenida" en vista detalle.
   - Cambiar mensaje del modal de hire externo: en lugar de mostrar el
     `tempPassword` siempre, mostrar **solo si el email falló**. Si el
     email se envió OK, mostrar "Email enviado a {email}. Si no llega,
     usa el botón Reenviar en el detalle del candidato".

**Riesgos**:
- Email puede caer en spam (Resend tiene buena reputación pero el
  password en plain text trigger spam filters). Mitigación: el email NO
  contiene el password en plain text — manda link a página de set-password
  con token de un solo uso (ya existe la mecánica `mustChangePassword`).
- Resend puede estar caído cuando dispara el hire. Mitigación: si falla,
  el modal del frontend debe mostrar el `tempPassword` como fallback
  manual. El audit log captura el fallo para soporte.

**Acceptance criteria**:
- [ ] Email enviado dentro de 30s del hire externo en condición normal.
- [ ] Si Resend falla, frontend muestra `tempPassword` con texto claro
  "Email no se envió, copia y envía manualmente".
- [ ] Botón "Reenviar email" funciona y rota el password (el viejo no
  vale más, evita compromiso si quedó expuesto).
- [ ] Audit log `recruitment.hire_email_sent` o `_failed` por cada hire
  externo.

**Bug review checklist**:
- [ ] El email NO se envía si la transacción de `hireCandidate` rollback
  (debe estar fuera de la tx — post-commit).
- [ ] Si el listener falla, `hireCandidate` NO debe lanzar (audit log + log).
- [ ] El `resend` invalida el password anterior (no acumula passwords).
- [ ] El email tiene URL absoluta correcta según `NODE_ENV` (no localhost
  en prod).
- [ ] Se respeta el feature flag de Resend si existe.

**Esfuerzo**: 1.5 días.

---

### S5.2 — Vista admin de CV archivado (compliance access)

**Problema actual**: S4.2 archiva el CV en `cv_url_archived` con
`select: false`. Si un cliente pide acceso al CV de un candidato pre-purge
(por requerimiento legal — ej. demanda laboral de candidato no-contratado),
no hay UI; sólo SQL directo.

**Alcance**:
1. **Backend** — endpoint admin-only:
   - `GET /recruitment/candidates/:id/archived-cv`
   - Solo `tenant_admin` (NO super_admin — alineado con F-001).
   - Trae `cv_url_archived` + `cv_archived_at` con `addSelect`.
   - Audit log `recruitment.archived_cv_accessed` con metadata
     (`candidateId`, `reason` opcional pasado por query param).

2. **Frontend**:
   - En la vista `dashboard/postulantes/[id]/page.tsx`, si:
     - `candidate.cvUrl == null` Y `candidate.cvArchivedAt != null` →
       mostrar banner "CV archivado el {fecha} (compliance 24m). [Ver CV
       archivado]" — solo visible para admin.
   - Click → modal con campo "Razón de acceso" (texto libre obligatorio,
     min 20 chars) → fetch al endpoint → renderizar el data URL.
   - El campo "Razón" se envía al backend como query param y se persiste
     en `recruitment.archived_cv_accessed.metadata.reason`.

3. **Audit/UI**:
   - Sección nueva en `dashboard/audit-logs/page.tsx` (si existe) o
     filtro `recruitment.archived_cv_accessed` para que el cumplimiento
     pueda revisar quién accedió a qué CV archivado.

**Riesgos**:
- **Brecha de privacidad si el endpoint no chequea `tenant_admin`
  estrictamente**. Mitigación: test de rol obligatorio + revisión por
  pares antes de merge.
- **Payload grande** (CVs ~1MB+ base64). Mitigación: ya es admin-only y
  bajo volumen — no hay paginación necesaria.

**Acceptance criteria**:
- [ ] `manager` y `employee` reciben 403 al GET.
- [ ] `tenant_admin` ve el CV solo si pasa el campo `reason` con ≥20 chars.
- [ ] Cada acceso queda en audit log con la razón.
- [ ] El banner aparece SOLO para procesos cerrados con CV archivado.
- [ ] El CV no se descarga al disco — se renderiza inline (data URL en
  iframe sandboxed).

**Bug review checklist**:
- [ ] El endpoint NO retorna el CV si `cv_archived_at IS NULL` (i.e.,
  candidatos activos). Solo accede al archivado.
- [ ] Si `cv_url_archived IS NULL` (ya purgado por cron) → 404 con mensaje
  claro.
- [ ] Cross-tenant: super_admin no puede acceder a archivos de otro tenant
  sin el modo de impersonación adecuado.
- [ ] El `reason` se valida server-side, no solo en frontend.
- [ ] El banner no se muestra en procesos `draft`/`active` (solo
  `closed`/`completed`).

**Esfuerzo**: 1.5 días.

---

### S5.3 — Tests unitarios `recruitment.service`

**Problema actual**: el módulo no tiene `recruitment.service.spec.ts`. Se
construyeron 4 sprints sobre cero cobertura. Riesgo de regresión alto:
cualquier refactor del flow de hire o de la cascada toca lógica crítica
(transacciones + RLS + cascada user) sin red de seguridad.

**Alcance**:
1. **Setup**:
   - Resolver el bug de babel parser que rompe los specs existentes
     (descubierto en S4.1 — `auth.service.spec.ts`, `evaluations.service.spec.ts`,
     `recognition.service.spec.ts` fallan con `SyntaxError: Missing
     semicolon`). Probable issue de `babel.config.js` o `jest.config.js`
     no detectando TypeScript correctamente.
   - Una vez resuelto, los 3 specs existentes deberían pasar.

2. **Cobertura mínima viable** (`recruitment.service.spec.ts`):
   - **`createProcess`**: valida campos obligatorios, defaults de
     `scoringWeights`, audit log emitido.
   - **`updateProcess`**:
     - Status transitions válidas (draft→active, active→completed/closed).
     - Status transitions inválidas (closed→draft) → error.
     - Archive de CVs en transición a closed/completed (S4.2).
     - Restore de CVs en reopen (S4.2).
     - Audit logs de scoring weights / requirements (S4.1).
   - **`addExternalCandidate` / `addInternalCandidate`**:
     - Tipo de proceso correcto (no permitir interno en proceso external).
     - Audit log.
   - **`updateCandidateStage`**:
     - Bloqueo de stage=hired (forzar uso de hireCandidate).
     - Bloqueo desde stage=hired (forzar revertHire).
     - Audit log.
   - **`hireCandidate`** (más crítico):
     - Captura de `previousUserState` para internos.
     - Captura de `previousCandidateStages`.
     - Race condition: mock `processRepo.update().affected = 0` → error.
     - Cascada user transferida (mock `usersService.transferUser`).
     - Otros candidatos pasan a `not_hired`.
     - Email externo enviado (S5.1) — fuera de tx.
   - **`revertHire`**:
     - Restaura state previo del user.
     - Restaura stages previos de candidatos.
     - Restaura CVs archivados (S4.2).
     - Borra user_movement con effective_date.
   - **`autoCloseExpiredProcesses`** y **`purgeArchivedCvs`** y
     **`detectLegacyHiresWithoutCascade`**: tests de los crons con mocks
     de tiempo y dataSource.

3. **Mocks reutilizables**:
   - Crear `recruitment.service.spec.helpers.ts` con fábricas de
     `RecruitmentProcess`, `RecruitmentCandidate`, etc. y mocks de
     `dataSource`, `tenantCronRunner`, `auditService`.

**Riesgos**:
- El fix del babel parser puede tomar más tiempo que las 1.5 días si es
  config compleja del monorepo. Mitigación: timebox de 0.5 día — si no
  se resuelve, escribir los tests con `ts-jest` directo (workaround) y
  abrir issue separado para el fix global.
- Los tests de transacciones (mock de `dataSource.transaction`) son
  notoriamente frágiles. Estrategia: no testear la transacción en sí,
  testear cada paso aislado.

**Acceptance criteria**:
- [ ] `pnpm jest --testPathPatterns=recruitment.service.spec` pasa con
  ≥40 tests.
- [ ] Cobertura de líneas en `recruitment.service.ts` ≥ 60% (medida con
  `jest --coverage`).
- [ ] CI corre los tests en cada PR.
- [ ] Specs existentes (auth/evaluations/recognition) restaurados.

**Bug review checklist**:
- [ ] Ningún test depende de orden — pueden correr aislados.
- [ ] Mocks de `Date.now()` para tests de `endDate < hoy` no leakean
  entre tests (`afterEach`).
- [ ] No se usan datos reales de tenants — solo UUIDs fake.
- [ ] Tests de cascada user mockean `transferUser` — no llaman al real.

**Esfuerzo**: 2.5–3 días.

---

## Sprint 6 — UX / Producto visible

**Objetivo**: dejar el módulo "comparable" frente a competidores SMB.
Pipeline visual + bulk actions + métricas son el mínimo esperado por un
recruiter moderno.

**Branch**: `feat/s6-recruitment-ux`.
**Esfuerzo**: 8–11 días.

**Dependencia**: S6.3 depende de S5.3 (tests existentes para no regresar
en cambios de cálculo).

### S6.1 — Pipeline kanban view

**Problema actual**: `dashboard/postulantes/page.tsx` muestra la lista de
candidatos como tabla. Para procesos con 20+ candidatos, no hay vista
que muestre la distribución por stage de un vistazo.

**Alcance**:
1. **Frontend**:
   - Toggle en la vista del proceso: "Tabla | Kanban".
   - Kanban: columnas por `CandidateStage` (excepto `not_hired`/`rejected`
     que van colapsadas en una columna "Descartados").
   - Drag & drop entre columnas → llama `PATCH /candidates/:id/stage`.
   - Card del candidato muestra: nombre, foto/avatar, score (si scored),
     CV indicator (icono PDF si tiene CV), antigüedad en el stage actual
     (calc desde `updatedAt`).
   - Búsqueda + filtros (mismo que tabla actual).

2. **Backend**:
   - No requiere cambios en endpoints — el endpoint actual `GET
     /recruitment/processes/:id` ya devuelve candidatos con stage.
   - Considerar: agregar `stageChangedAt` (nuevo campo o computed) para
     mostrar antigüedad en stage. Si se persiste como columna, agregar
     en `cleanup-orphans`.

3. **Reglas de drag & drop**:
   - No permitir drag a `hired` (debe usarse el modal — defense-in-depth
     duplica la regla del backend).
   - No permitir drag desde `hired` (debe usarse "Revertir contratación").
   - Mostrar toast de error claro si el backend rechaza la transición.

**Riesgos**:
- Drag & drop en mobile es problemático. Mitigación: en breakpoint
  `<md`, fallback a select tradicional + botón "Mover a..."
- Performance: 100+ candidatos puede lagger. Mitigación: virtualización
  por columna (`react-window`) si supera 50 cards.

**Acceptance criteria**:
- [ ] Toggle persiste preferencia del usuario en localStorage.
- [ ] Drag & drop funciona en desktop; mobile usa select.
- [ ] Visualmente alineado con el design system (mismo theme que la
  tabla).
- [ ] Click en card abre el detalle del candidato (no rompe UX actual).

**Bug review checklist**:
- [ ] Optimistic update en frontend rolba si el backend rechaza.
- [ ] No re-renderiza el kanban entero por cada update — solo la card
  movida.
- [ ] Drop en columna inválida (rejected→hired) muestra error sin mover.
- [ ] El `stageChangedAt` se actualiza cuando cambia el stage (verificar
  que el backend lo escribe).

**Esfuerzo**: 3 días.

---

### S6.2 — Bulk actions

**Problema actual**: para descartar 10 candidatos, el admin debe entrar
a cada uno y cambiar stage manualmente. Tedioso en procesos masivos.

**Alcance**:
1. **Frontend**:
   - Checkbox por candidato en la tabla (vista lista).
   - "Seleccionar todos" en el header.
   - Toolbar bulk con acciones: "Cambiar stage a...", "Eliminar",
     "Exportar a CSV".
   - Confirmación obligatoria antes de bulk delete (pide tipear "ELIMINAR").

2. **Backend** — endpoints nuevos:
   - `PATCH /recruitment/candidates/bulk-stage`
     - Body: `{ candidateIds: string[], stage: string }`.
     - Valida que todos pertenezcan al mismo tenant + bloquea `hired`.
     - Audit log por candidato (no bulk audit — para rastreabilidad).
   - `DELETE /recruitment/candidates/bulk`
     - Body: `{ candidateIds: string[] }`.
     - Solo `tenant_admin`. Bloquea si alguno está en `hired`.

3. **Lógica defensiva**:
   - Bulk no puede transicionar a `hired` (regla S1).
   - Bulk de candidatos en distintos procesos: permitido si el admin
     tiene acceso a ambos.

**Riesgos**:
- El admin selecciona "todos" y descarta accidentalmente un proceso de
  500 candidatos. Mitigación: confirm modal con count + razón opcional.
- N+1 queries en el bulk update. Mitigación: usar un solo UPDATE con
  `WHERE id IN (:...ids)`.

**Acceptance criteria**:
- [ ] Bulk cambia stage de 50 candidatos en <2s (single query).
- [ ] Audit log creado por cada candidato afectado.
- [ ] Bulk delete pide confirmación textual.
- [ ] Selección persiste al filtrar (si filtras y luego destildas filtro,
  los seleccionados originales siguen marcados — pattern Gmail).

**Bug review checklist**:
- [ ] Cross-tenant: el admin no puede afectar candidatos de otro tenant
  pasando IDs (validación server-side por tenantId).
- [ ] Si uno de los IDs no existe → respuesta clara de cuáles fallaron,
  no error genérico.
- [ ] La transacción es atómica: si uno falla, ninguno cambia (vs.
  parcial). Decisión: parcial OK pero respuesta debe listar errores.
- [ ] Bulk delete no rompe FKs (interviews del candidato → CASCADE OK).

**Esfuerzo**: 2 días.

---

### S6.3 — Métricas del proceso (dashboard widget + endpoint)

**Problema actual**: no hay forma de ver "cuántos días promedio para
contratar" o "% conversión por stage" sin SQL directo.

**Alcance**:
1. **Backend**:
   - `GET /recruitment/processes/:id/metrics`:
     - `daysActive`: días desde `startDate` (o `createdAt` si null).
     - `candidateCount` por stage.
     - `avgDaysInStage`: promedio de tiempo en cada stage (requiere
       `stageChangedAt` de S6.1 o un nuevo campo `stage_history` JSONB).
     - `conversionRate`: % de `cv_review` → `interviewing` → `scored` →
       `approved` → `hired`.
     - `interviewsCompleted` / `interviewsExpected` (basado en
       evaluators × candidatos en `interviewing`+).
     - `winnerScore` y `runnerUpScore` si hay scored.
   - `GET /recruitment/tenant/metrics`:
     - Aggregate del tenant: `avgDaysToHire`, `processesActive`,
       `processesCompletedLast30d`, etc.
     - Útil para dashboard ejecutivo.

2. **Frontend**:
   - Widget en `dashboard/postulantes/[id]/page.tsx` arriba de la lista
     de candidatos: 4-5 KPI cards (avgDaysInStage, conversionRate,
     winnerScore, etc.).
   - Widget en `dashboard/ejecutivo/page.tsx` (junto al de Movilidad
     Interna de S3.3): "Recruitment KPIs" con avgDaysToHire +
     processes status pie chart.

3. **Persistencia de stage history**:
   - Nueva tabla `recruitment_candidate_stage_history`:
     - `id`, `candidateId`, `tenantId`, `fromStage`, `toStage`,
       `changedAt`, `changedBy`.
   - Insert automático en `updateCandidateStage` y en flows que cambien
     stage (hire, revertHire, bulk).
   - Permite calcular `avgDaysInStage` con precisión.

**Riesgos**:
- `recruitment_candidate_stage_history` puede crecer rápido. Mitigación:
  índice por `candidateId` + cron de archivado a frío después de 24m
  (similar a CV).
- Retro-compatibilidad: candidatos creados antes de S6.3 no tienen
  history. Backfill best-effort desde `audit_logs.recruitment.candidate_stage_changed`
  (S4.1) — afortunadamente ya tenemos ese log.

**Acceptance criteria**:
- [ ] Widget aparece en vista del proceso con datos correctos para
  procesos creados post-S6.3.
- [ ] Backfill desde audit_logs popula history de candidatos pre-S6.3.
- [ ] Endpoints respetan tenancy (no leak entre tenants).
- [ ] Tests cubren cálculos de conversión y avg.

**Bug review checklist**:
- [ ] División por cero protegida (proceso sin candidatos).
- [ ] `winnerScore` es null si `winningCandidateId` es null (no falla).
- [ ] Backfill es idempotente — re-run no duplica filas.
- [ ] Métricas del tenant excluyen procesos archived (sin status).
- [ ] El widget ejecutivo no falla si el tenant es nuevo (0 procesos).

**Esfuerzo**: 3.5 días.

---

## Sprint 7 — Features grandes (opcionales)

**Objetivo**: extensiones de alto impacto para clientes mid-market. Cada
subtarea es lo suficientemente grande para ser su propio sprint si se
ejecuta en aislado.

**Branch**: `feat/s7-recruitment-extensions`.
**Esfuerzo**: 10–15 días.

**Dependencia**: S7.1 depende de S5.1 (sistema de email confiable).

### S7.1 — Job board público

**Problema actual**: solo el admin puede agregar candidatos externos. No
existe URL pública donde candidatos se auto-registren. Limita el alcance
de los procesos externos a la base de contactos del recruiter.

**Alcance**:
1. **Backend**:
   - Nuevo endpoint público (sin auth):
     - `GET /public/jobs/:tenantSlug/:processSlug` → trae descripción
       + requirements + form fields.
     - `POST /public/jobs/:tenantSlug/:processSlug/apply`:
       - Body: nombre, email, phone, linkedIn, CV (data URL), cover
         letter opcional.
       - Crea `RecruitmentCandidate` con stage `registered`.
       - Captcha (hCaptcha o Cloudflare Turnstile) para evitar spam.
       - Rate limit por IP (5 aplicaciones / hora).
       - Audit log `recruitment.candidate_self_applied` con metadata
         `source: 'public_jobboard'`.
   - Nueva columna `recruitment_processes.public_slug` (varchar unique
     por tenant + nullable). Solo procesos con `processType=external` y
     `status=active` y `public_slug` set son visibles.
   - Tenant config: `tenant.recruitment_public_enabled` (boolean) — el
     admin opta-in.

2. **Frontend público**:
   - Nuevo route `apps/web/src/app/jobs/[tenantSlug]/[processSlug]/page.tsx`.
   - SSG / ISR para que cargue rápido + se indexe en Google.
   - Form de aplicación con validación + submit.
   - Página de éxito con next steps.

3. **Frontend admin**:
   - En `dashboard/postulantes/[id]/page.tsx` (proceso external + active):
     toggle "Hacer público" → pide slug → muestra URL copiable.
   - Filtro en lista de candidatos por `source` (admin_added vs
     self_applied).

**Riesgos**:
- **Spam masivo**: incluso con captcha, un script puede saturar el
  proceso. Mitigación: rate limit + dedup por email (un email no puede
  aplicar dos veces al mismo proceso) + auto-flag de duplicados.
- **Compliance Chile (Ley 19.628)**: el form debe incluir consentimiento
  explícito al tratamiento de datos personales con link a la política
  de privacidad del tenant. Mitigación: checkbox obligatorio.
- **PII en URL**: el `process_slug` no debe contener PII.
- **Branding**: el public board debe respetar el branding del tenant
  (logo, colores). Implica usar `tenant.brand_color` etc.

**Acceptance criteria**:
- [ ] URL pública carga sin auth y sin leak de datos sensibles.
- [ ] Aplicación crea candidate con CV en BD.
- [ ] Captcha bloquea bots simples.
- [ ] Rate limit funciona (test con curl).
- [ ] Email de confirmación al candidato (reusa S5.1).
- [ ] Notificación al admin con metadata `kind: 'self_application'`.
- [ ] Branding correcto (logo del tenant).
- [ ] Consentimiento de datos personales auditado.

**Bug review checklist**:
- [ ] Aplicar al mismo proceso 2× con el mismo email → 409 + mensaje
  claro (no duplicado en BD).
- [ ] Slug colisiones: si dos tenants quieren `marketing-2026`,
  validación es por (tenant, slug) único.
- [ ] CV size límite (5MB) — no aceptar más, evita ataque de almacenamiento.
- [ ] El form NO acepta candidatos para procesos `internal` (rechazo
  con 404 — no revelar existencia).
- [ ] Si el proceso pasa a `closed` mientras alguien está llenando el
  form, el submit responde "Proceso ya cerrado" sin perder los datos
  (mostrar mensaje + opción de descargar como CV-PDF).

**Esfuerzo**: 6–8 días (incluye SSG, captcha, branding).

---

### S7.2 — Calendar integration

**Problema actual**: agendar entrevistas requiere coordinación manual
fuera del sistema (Google Meet/Zoom links, calendar invites por email,
recordatorios manuales).

**Alcance**:
1. **Backend**:
   - Nueva entidad `recruitment_interview_slot`:
     - `id`, `candidateId`, `evaluatorId`, `scheduledAt` (timestamptz),
       `durationMinutes` (default 60), `meetingUrl` (nullable),
       `status` (`scheduled` / `cancelled` / `completed` / `no_show`),
       `cancelReason`, `tenantId`.
   - Endpoints:
     - `POST /recruitment/candidates/:id/schedule-interview`
     - `PATCH /recruitment/interview-slots/:id` (reschedule, cancel)
     - `GET /recruitment/candidates/:id/upcoming-interviews`
   - Integración Google Calendar (opcional Sprint A) o solo iCal email
     (.ics adjunto, Sprint B).
   - Recordatorios automáticos (cron) 24h y 1h antes.

2. **Frontend**:
   - Botón "Agendar entrevista" en el detalle del candidato.
   - Modal con: evaluador (dropdown), fecha/hora picker, duración,
     URL de meeting (opcional o generar Meet link automático).
   - Sección "Próximas entrevistas" en el detalle.
   - Email al candidato con .ics adjunto + URL de meeting.

**Riesgos**:
- **Timezone hell**: el evaluador puede estar en UTC-3, candidato en
  UTC+0. Mitigación: persistir todo en UTC, mostrar en TZ del usuario,
  etiquetar el .ics con la TZ correcta.
- **Sync con Google Calendar OAuth**: requiere que cada evaluador
  autentique. Costoso. Mitigación opcional: solo enviar .ics
  (compatible con todos los calendarios) en Sprint B; OAuth en Sprint
  A si la demanda lo justifica.
- **No-show tracking**: ¿qué pasa si nadie marca como no-show? Cron
  que marca `status=completed` después de `scheduledAt + duration`
  para que el flow de scoring siga.

**Acceptance criteria** (Sprint B mínimo):
- [ ] Agendar entrevista crea slot + envía .ics al candidato y al
  evaluador.
- [ ] Cancelar entrevista envía email de cancelación con razón.
- [ ] Recordatorios 24h y 1h antes (cron + notification).
- [ ] La entrevista aparece en el listado del evaluator.
- [ ] No bloquea el flow de submitInterview (puede haber entrevistas
  ad-hoc sin slot agendado).

**Bug review checklist**:
- [ ] DST changes: la entrevista persiste en UTC, el `.ics` la transmite
  correctamente.
- [ ] Doble booking del evaluador: warning pero no error (a veces hay
  paneles).
- [ ] Cancelación NO borra interview existente — solo el slot.
- [ ] El .ics tiene UID estable para que actualizaciones reemplacen el
  evento original.

**Esfuerzo**: 4–7 días (B sin OAuth) / +6 días si A con Google Calendar OAuth.

---

## Plan de ejecución sugerido

### Opción 1 — "Limpiar y consolidar" (recomendado)
**Total**: 5–7 días.
- Solo S5 completo.
- Cierra los 3 gaps detectados en S4 (email, CV archivado, tests).
- Deja base sólida para refactors futuros.
- Sin features grandes, sin riesgos comerciales.

### Opción 2 — "UX visible" (si hay presión comercial)
**Total**: 13–18 días.
- S5 + S6.
- Pipeline visual + bulk + métricas.
- El cliente "ve" la evolución del producto.
- Tests cubren los nuevos flows.

### Opción 3 — "Full extension" (si la roadmap lo justifica)
**Total**: 23–33 días.
- S5 + S6 + S7.
- Job board público + calendar integration.
- Compite head-to-head con Lever / Greenhouse a nivel feature básico.
- Requiere recursos para soporte post-launch (más superficie de bugs).

---

## Riesgos transversales

1. **Regresiones en S1-S4**: cualquier cambio al `recruitment.service`
   puede romper el flow de hire/revert. **Mitigación**: S5.3 (tests)
   debe estar antes de S6/S7.

2. **Performance bajo carga**: el módulo no fue stress-tested. Si
   un cliente hace bulk de 1000 candidatos o un proceso público recibe
   100 aplicaciones/hora, podemos descubrir bottlenecks. **Mitigación**:
   load test al final de S6.

3. **Compliance evolving**: la Ley 19.628 está siendo reformada (2026).
   El plan asume retención 24m; si cambia, S4.2 + S7.1 necesitan ajuste.
   **Mitigación**: parametrizar el período en `tenant.config` en lugar
   de hardcoded.

4. **Email deliverability**: S5.1 + S7.1 dependen de Resend. Si la
   reputación del dominio cae (por spam complaints), todos los emails
   fallan. **Mitigación**: monitor de bounce rate + fallback a SMTP
   manual.

---

## Pasos siguientes

1. **Revisar este plan con stakeholders** (Product Owner + lead técnico).
2. **Decidir opción** (1, 2 o 3) según calendario comercial.
3. **Crear branch** `feat/s5-recruitment-quick-wins` y arrancar S5.1.
4. **Cada subtarea termina con commit independiente + bug review
   exhaustivo** (regla heredada de S1-S4).
5. **Merge a main al cierre de cada sprint** (no por subtarea).

---

**Documento controlado**. Cualquier cambio de scope debe quedar
versionado en este archivo (sufijo `-v2`, `-v3`, etc.) para mantener
trazabilidad de las decisiones.
