# Roadmap v3.x — features estratégicas pendientes

Este documento lista **features grandes de producto** que se analizaron y
dejaron pendientes intencionalmente por timing de mercado, no por limitación
técnica. Se priorizan cuando el contexto comercial lo justifique (más
clientes, deals enterprise concretos, presupuesto dev disponible).

Para deuda técnica puntual (refactors, fixes de arquitectura), ver
[`FASES_PENDIENTES.md`](./FASES_PENDIENTES.md).

---

## Índice

1. [Integraciones — Slack + Teams](#1-integraciones--slack--teams)
2. [SSO SAML + SCIM provisioning](#2-sso-saml--scim-provisioning)
3. [App nativa iOS/Android](#3-app-nativa-iosandroid)
4. [Rich notifications + scheduled reminders](#4-rich-notifications--scheduled-reminders)
5. [Certificaciones enterprise (SOC 2, ISO 27001)](#5-certificaciones-enterprise)
6. [API pública + Marketplace integraciones](#6-api-pública--marketplace-integraciones)
7. [Status page + customer success tooling](#7-status-page--customer-success-tooling)
8. [Marketing evidence (case studies, G2)](#8-marketing-evidence-case-studies-g2)
9. [Deuda técnica v2.x heredada](#9-deuda-técnica-v2x-heredada)

---

## 1. Integraciones — Slack + Teams

**Estado:** analizado a fondo (plan técnico completo armado 2026-04-20).
**Prioridad:** media-alta cuando se alcancen 10+ clientes mid-market.
**Costo:** $0 externo · ~35 días-dev (Slack solo: ~20 días, Teams solo: ~24 días).

### Por qué pendiente

Valor alto pero requiere volumen de clientes para justificar el esfuerzo.
Con pocos clientes, el ROI por dev-day invertido es menor que features que
afectan al 100% de usuarios actuales.

### Trigger para activar

Arrancar cuando se cumpla **al menos uno** de:
- 10+ clientes mid-market activos (50–500 empleados).
- 3+ deals en pipeline donde "integración Slack/Teams" aparece como requirement.
- Competidor directo (Rankmi, Buk) lanza integración — necesitamos match.
- NPS de clientes actuales menciona el gap explícitamente.

### Alcance resumido

**Slack (MVP 20 días):**
- OAuth install + token cifrado en DB por tenant.
- User mapping automático por email + fallback manual.
- 6 eventos con Block Kit rico (botones "Evaluar", "Responder", etc.):
  evaluación asignada, check-in agendado, objetivo por aprobar, feedback
  recibido, reconocimiento recibido, encuesta activa.
- Canal público opcional para reconocimientos (`#kudos`).
- Slash commands: `/eva360 pendientes`, `/eva360 feedback @user`, `/eva360 ayuda`.
- UI `/dashboard/ajustes/integraciones`.
- Opt-out por canal en `/perfil`.

**Teams (MVP 24 días):**
- App manifest zip + sideload (sin publish en Teams Store).
- OAuth vía Microsoft Graph + refresh token automático.
- AdaptiveCards para los mismos 6 eventos.
- Messaging extensions (equivalente a slash commands).
- Sandbox dev Microsoft 365 para testing.

**Comunes:**
- Nueva tabla `tenant_integrations` con access_token cifrado (AES-256-GCM).
- Nueva tabla `integration_user_mappings` (eva_user ↔ slack_user).
- Nueva tabla `integration_message_log` para audit y métricas.
- `NotificationsDispatcher` central que orquesta email + push + slack + teams.
- Métricas admin en `/dashboard/system-metrics`: tenants conectados, mensajes
  enviados, tasa éxito por canal.

### Pre-requisitos técnicos

- Registrar Slack App en api.slack.com (publisher: Ascenda).
- Registrar app en Microsoft Partner Center / Azure AD.
- Configurar redirect URIs en dominio estable (`api.eva360.ascenda.cl`).
- Generar `INTEGRATION_TOKEN_ENCRYPTION_KEY` (32 bytes hex) y guardar en
  password manager del equipo.
- Workspace Slack de staging + tenant Microsoft 365 de staging.

### Decisiones ya tomadas (documentadas para cuando se retome)

- **Orden:** Slack primero, Teams después. Razones: Slack más simple (OAuth
  directo, sin manifest sideload), mercado chileno mid-market 60% Slack,
  validar valor antes de Teams.
- **Marketplaces:** NO publicar en Slack App Directory / Teams App Store
  en MVP. Clientes instalan via "Add custom app". Publicar cuando haya 10+
  clientes usando la integración (reviews tardan 2–4 semanas).
- **Reconocimientos públicos:** opt-in, no default. Admin elige canal después
  de conectar.
- **Bot name:** "EVA360" (mismo nombre del producto).
- **Feature flag:** activable por plan (Growth/Pro/Enterprise). Killswitch
  global `INTEGRATIONS_DISABLED=true`.

### Plan detallado

Plan completo de 6 sprints (A–F) con criterios de aceptación y timeline
semana-por-semana disponible en el historial de planning del equipo
(2026-04-20). Replicar la estructura cuando se retome.

---

## 2. SSO SAML + SCIM provisioning

**Estado:** analizado a alto nivel.
**Prioridad:** crítica cuando aparezca primer deal enterprise (>500 empleados).
**Costo:** $0 externo · ~25 días-dev (SAML 15 días + SCIM 11 días).

### Por qué pendiente

Hoy no hay clientes enterprise en pipeline. Implementarlo antes de necesitarlo
es desperdicio: la complejidad de testing (requiere IdP sandbox) y la
documentación por IdP no se amortiza con clientes actuales que no lo exigen.

### Trigger para activar

- Primer deal serio con empresa >500 empleados donde "SSO SAML" esté en RFP.
- Pipeline de mínimo 3 deals enterprise concurrentes (justifica el costo).
- Requerimiento de SOC 2 Type II (el auditor lo exige para puntaje).

### Alcance resumido

**SAML SSO (15 días):**
- Librería `@node-saml/passport-saml`.
- Nueva entity `tenant_sso_config` con metadata IdP, cert, attribute mapping.
- Endpoints `/auth/saml/:tenantSlug/{login,callback,metadata}`.
- JIT user provisioning (crear user en EVA al primer login si no existe).
- UI `/dashboard/ajustes/sso` con upload metadata XML + botón "Test SSO".
- Soporte Okta, Azure AD (Microsoft Entra), Google Workspace, ADFS.
- Login actual adaptado: si tenant tiene SSO enabled, redirige automático.
- `super_admin` mantiene login email+password para soporte.

**SCIM (11 días):**
- Librería `scimmy` o implementación propia.
- Endpoints `/scim/v2/Users` (GET, POST, PATCH, DELETE) + `/scim/v2/Groups`.
- Schema SCIM 2.0 compliance (`urn:ietf:params:scim:schemas:core:2.0:User`).
- Bearer token fijo por tenant para auth.
- Auto-deactivate al recibir `active: false` del IdP.
- Audit log de cada operación.

### Caveats conocidos

- **Complejidad de testing:** cada IdP tiene cuirks. Okta dev edition es gratis
  (100 users). Azure AD free tier disponible. Google Workspace requiere cuenta
  pagada básica.
- **Certificados rotan cada 1-2 años:** monitorear expiración y permitir update
  sin downtime.
- **Clock skew:** SAML usa timestamps con margen ±5 min. Servidor NTP obligatorio.
- **Mixed mode:** durante migración, mismo tenant puede tener users con SSO y
  otros sin. El código debe soportar ambos.

---

## 3. App nativa iOS/Android

**Estado:** analizado conceptualmente.
**Prioridad:** baja (PWA v3.0-P0 cubre 80% de casos de uso).
**Costo:** ~$15-25k si se hace con Expo/Capacitor reutilizando código Next.js.

### Por qué pendiente

La PWA desplegada en v3.0-P0 ya permite instalar EVA360 desde home screen
en Chrome Android + Safari iOS 16.4+, con push notifications funcionales.
Invertir en app nativa antes de validar adopción PWA es prematuro.

### Trigger para activar

- Métricas PWA muestran <15% de instalación tras 2 meses → usuarios
  prefieren app "real" desde stores.
- Feedback explícito de 3+ clientes pidiendo app en App Store.
- Marketing necesita presencia en stores para SEO y credibilidad.
- Features que requieren acceso nativo: widgets home screen (iOS), Face ID
  custom, modo offline completo con sync automático.

### Alcance resumido

- **Tech:** Expo (React Native) o Capacitor, reusando componentes Next.
- **Scope mínimo:** login + dashboard + pendientes + notif push + feedback.
- **Stores:** $99/año Apple Developer + $25 single Google Play.
- **Review time:** Apple 1-7 días, Google <24h.
- **CI/CD:** EAS Build (Expo) o Ionic AppFlow (Capacitor).
- **Tiempo:** ~3-4 meses con 1 dev especializado.

---

## 4. Rich notifications + scheduled reminders

**Estado:** diferido desde v3.0-P0 (push básico ya entregado).
**Prioridad:** media si métricas de engagement post-push se estancan.
**Costo:** ~5 días-dev.

### Alcance

- **Rich notifications:** imágenes en notif (avatar del emisor, foto del reconocimiento),
  action buttons inline ("Aprobar" / "Rechazar" sin abrir app).
  Soportado en Chrome Android/desktop y Firefox. Safari iOS limitado.
- **Scheduled reminders:** cron genera push 24h y 2h antes del deadline de
  evaluación/check-in/objetivo.
- **UI granular de preferencias:** en `/perfil`, toggles por tipo de evento
  (evaluaciones, feedback, reconocimientos, etc.). Quiet hours con picker
  visual. Ya soportado en backend v3.0-P0.

### Trigger

- Opt-in rate push <30% tras 1 mes → necesitamos mejor UX.
- Usuarios reportan "demasiadas notificaciones" → granular opt-out.

---

## 5. Certificaciones enterprise

**Estado:** no iniciado.
**Prioridad:** alta cuando aparezca primer deal >500 empleados.
**Costo:** SOC 2 Type I $5-8k, Type II +$10k. ISO 27001 $15-30k.

### Rutas posibles

- **SOC 2 Type I** (3 meses, ~$5-8k): snapshot de controles en un momento.
  Suficiente para muchos deals enterprise para "empezar conversaciones".
- **SOC 2 Type II** (6-12 meses post Type I, +$10k): controles operando por
  6+ meses. Requerido por clientes más sofisticados.
- **ISO 27001** (~12 meses, $15-30k): estándar internacional, más valorado
  en Europa/Latam que SOC 2.
- **CSA STAR** (gratis self-assessment): menos valor pero entry point.

### Ya tenemos implementado (runway hacia certificación)

- Cross-tenant defense (P0-P7).
- Audit logs con retention.
- 2FA para super_admin.
- CORS strict + CSP headers (P1).
- Cron locks para crons multi-replica.
- Backup diario automático.
- Sentry para error tracking.
- Advisory locks para AI (anti-race).

### Gap para cumplir SOC 2

- Documentación formal de procesos (política de seguridad, DRP, incident
  response playbook).
- Access reviews trimestrales documentados.
- Penetration test anual de tercero (~$3-5k).
- Endpoint monitoring + vulnerability scanning.
- Training de seguridad para el equipo.

---

## 6. API pública + Marketplace integraciones

**Estado:** no iniciado.
**Prioridad:** media una vez haya masa crítica de clientes.
**Costo:** ~4 semanas para API + docs + rate limiting + auth.

### Alcance

- OpenAPI/Swagger specs publicadas.
- API keys con scopes por cliente (read-only, read-write, admin).
- Rate limiting configurable por plan.
- Documentación en Stoplight o Mintlify.
- SDK mínimo en Node.js + Python.
- Ejemplos de integración: Workday import, BambooHR sync, custom reporting.

### Valor estratégico

- Clientes enterprise con equipos internos de integración lo demandan.
- Permite que terceros construyan integraciones (HRIS, payroll, learning)
  sin que nosotros las implementemos.
- Abre camino a Marketplace tipo Salesforce AppExchange (muy largo plazo).

---

## 7. Status page + customer success tooling

**Estado:** no iniciado.
**Prioridad:** baja-media.
**Costo:** ~$100/mes statuspage.io, 1 día setup.

### Alcance

- **Status page pública:** status.eva360.ascenda.cl con uptime API, web, DB,
  Resend, Stripe, MercadoPago.
- **Incident communication:** template para email a clientes afectados.
- **On-call rotation:** documentada en Notion/Slack con escalation path.
- **SLA formal:** 99.5% o 99.9% uptime según plan, con créditos si se incumple.
- **Customer health score:** métrica interna (usage + engagement + support
  tickets) para identificar clientes en riesgo de churn.

### Trigger

- Primer downtime de >30 min sin communicación proactiva → cliente pierde
  confianza. Crear status page antes.

---

## 8. Marketing evidence (case studies, G2)

**Estado:** no iniciado.
**Prioridad:** media para posicionamiento competitivo.
**Costo:** ~$3k marketing + tiempo de PM.

### Alcance

- **3-5 case studies** en video (clientes satisfechos hablando).
- **Listing en G2** con reviews (incentivadas con Amazon gift cards $20).
- **Listing en Capterra + Software Advice**.
- **Comparativas propias** ("EVA360 vs Lattice", "EVA360 vs Buk") en blog
  para SEO competitivo.
- **Gartner Peer Insights** cuando haya 10+ reviews.

### Por qué pendiente

Sin customer stories firmados + quote + logo permission, no se puede
publicar. Esperar hasta que clientes actuales acepten dar testimonial
público.

---

## 9. Deuda técnica v2.x heredada

Los siguientes ítems estaban planificados durante v2.x pero se decidieron
diferir. Son **refactors de arquitectura** que no afectan features actuales
pero mejoran mantenibilidad.

### 9.1 Status varchar → enum (13 entidades)

**Contexto:** 13 entidades usan `status` como varchar con valores string
libres. Debería ser `enum` PostgreSQL para validación en DB.

**Impacto:** medio. Cambio DB delicado, requiere DOWN migration plan y
testing de rollback exhaustivo.

**Razón de postergar:** no bloquea nada. Hacerlo solo cuando haya ventana
dedicada sin otros cambios en los mismos módulos para evitar conflictos
de merge.

### 9.2 Dual-write FK migration (4 entidades)

**Contexto:** hay que migrar 4 entidades del patrón "texto libre" al patrón
FK a tabla de catálogo (igual que hicimos con Departments):
- `OrgDevInitiative` (`targetDepartments` array de strings)
- `Recruitment` processes (`department` string)
- `RoleCompetency` (`position` string)
- `CalibrationSession` (`targetDepartments`)

**Impacto:** cada entidad son ~8 etapas (dual-write, backfill, verify, flip,
cleanup). Total ~4 sesiones dedicadas.

**Razón de postergar:** trabajo grande independiente. Arrancar cuando haya
1 sprint completo sin otras prioridades urgentes.

### 9.3 Rolling deploy blue/green con 2 VPS

**Contexto:** hoy deployamos con 1 VPS Hostinger. Cualquier deploy tiene
downtime de ~30s mientras el container reinicia. Con 2 VPS + nginx con
retry + health checks, podríamos hacer zero-downtime.

**Impacto:** alto (DevOps), bajo funcional. Solo importa cuando haya SLA
firme con clientes.

**Razón de postergar:** requiere staging dedicado, segundo VPS, setup de
nginx reverse proxy, health checks, CI/CD pipeline actualizado. Ya está
documentado el approach en `docs/OPS_RUNBOOK.md` (sección P1.9 del sprint
original). Activar cuando SOC 2 o SLA enterprise lo exija.

---

## Convención de priorización

Cuando se retome este roadmap, aplicar este framework para ordenar:

1. **Trigger claro presente:** hay evento concreto (deal perdido, métrica
   baja, cliente pidiéndolo) → prioridad alta.
2. **ROI por día-dev:** valor estimado / días de implementación → ordenar
   descendente.
3. **Dependencias:** ¿desbloquea otras features? Ej: SSO desbloquea deals
   enterprise que también exigen SCIM + SOC 2.
4. **Riesgo de mercado:** ¿competidor nos está ganando ahí? → urgente.
5. **Readiness:** ¿tenemos pre-requisitos listos (clientes beta, sandbox,
   presupuesto)? Si falta, no se puede arrancar aunque la prioridad sea alta.

---

## Cómo agregar un ítem nuevo

1. ID correlativo de sección (`10.`, `11.`, ...).
2. Campos obligatorios: Estado, Prioridad, Costo, Por qué pendiente,
   Trigger para activar, Alcance.
3. Si hay plan técnico detallado elaborado (como Slack + Teams), mencionar
   fecha y referencia al historial del equipo.
4. Actualizar el índice del inicio del archivo.

---

_Última actualización: 2026-04-20_
_Versión actual: v3.0.0 (PWA + Web Push)_
