# EVA360 — Setup PWA + Web Push (v3.0)

Guía para configurar y operar las notificaciones push en EVA360.

---

## 1. Qué incluye v3.0-P0

- **PWA instalable** desde Chrome Android, Edge, Safari iOS 16.4+, Chrome/Safari/Firefox desktop.
- **Web Push** en 6 eventos:
  1. Evaluación asignada (ciclo lanzado)
  2. Check-in 1:1 agendado
  3. Objetivo pendiente de aprobación
  4. Feedback recibido
  5. Reconocimiento recibido
  6. Encuesta de clima activa
- **Preferencias por usuario**: opt-in global, por evento, quiet hours con timezone.
- **i18n** es / en / pt.
- **Cron cleanup**: subscripciones inactivas >90d se eliminan automáticamente.
- **Métricas**: endpoint admin con total, active last 7d, failures, byBrowser.

---

## 2. Generar VAPID keys (una sola vez)

```bash
cd apps/api
npx web-push generate-vapid-keys --json
```

Output:
```json
{"publicKey": "BNxx...", "privateKey": "yyy..."}
```

**Importante:** guarda estas keys en el password manager del equipo. Si se pierde la private key, TODAS las subscripciones existentes quedan inválidas (los usuarios deben re-activar manualmente).

## 3. Variables de entorno

Agregar en `apps/api/.env` (local) y en Render dashboard (producción):

```
VAPID_PUBLIC_KEY=<public key generada>
VAPID_PRIVATE_KEY=<private key generada>
VAPID_SUBJECT=mailto:soporte@ascenda.cl
PUSH_DISABLED=false
```

**Killswitch:** setear `PUSH_DISABLED=true` desactiva el envío SIN afectar UI ni subscripciones. Útil si hay un incidente y quieres parar pushes inmediatos sin desplegar revert.

La `VAPID_PUBLIC_KEY` se expone al frontend via el endpoint `GET /notifications/push/vapid-key` (autenticado). No es secreta.

---

## 4. Migration DB

Idempotente, seguro de correr múltiples veces:

```bash
cd apps/api
pnpm run db:migrate:push
```

Crea:
- Tabla `push_subscriptions` con FK cascade a `users`.
- Índices `(user_id, tenant_id)` y `(last_used_at)`.
- Columna JSONB `users.notification_prefs`.

En producción (Render), la migration corre automáticamente antes del `start` del proceso (ver `package.json` → `start:prod`).

---

## 5. Generar íconos PWA

Los PNGs se commitean al repo, pero si necesitas regenerarlos (ej: cambio de logo):

```bash
cd apps/web
pnpm run generate:icons
```

Genera 14 archivos PNG desde los SVG fuente en `public/icons/`:
- `icon-{72,96,128,144,152,192,384,512}.png` (todos los tamaños PWA)
- `apple-touch-icon.png` (180x180)
- `icon-{192,512}-maskable.png` (con safe zone 80%)
- `badge-72.png` (monocromo para Android status bar)
- `favicon-{16,32}.png`

SVG fuente:
- `public/icons/icon.svg` — símbolo principal (barras + apex + curva)
- `public/icons/icon-maskable.svg` — variante con safe zone 80%
- `public/icons/badge.svg` — monocromo blanco

---

## 6. Arquitectura técnica

```
Browser                         Backend (NestJS)
────────                        ────────────────

User clicks "Activar"
  │
  ├─→ Notification.requestPermission()
  │
  ├─→ GET /notifications/push/vapid-key
  │                              ─ devuelve { publicKey }
  │
  ├─→ pushManager.subscribe({ applicationServerKey })
  │                              ─ navegador contacta FCM/Mozilla/Apple
  │                              ─ devuelve { endpoint, keys }
  │
  └─→ POST /notifications/push/subscribe
                                 ├─ validar endpoint (whitelist push services)
                                 ├─ upsert en push_subscriptions
                                 └─ 201 Created

Evento ocurre (ej: evaluación asignada)
                                 │
                                 └─→ PushService.sendToUser(userId, payload, 'evaluations')
                                     ├─ Check user.notification_prefs
                                     ├─ Check quiet hours
                                     ├─ Foreach sub: webpush.sendNotification(...)
                                     │  ├─ OK: update last_used_at
                                     │  ├─ 410/404: DELETE sub
                                     │  └─ >=5 fallos: DELETE sub
                                     └─ Timeout 10s por sub (Promise.race)

FCM/Mozilla/Apple entrega
  │
  └─→ SW recibe 'push' event
      ├─ showNotification(title, { body, icon, tag, data })
      └─ User toca → SW 'notificationclick' → clients.openWindow(url)
```

---

## 7. Seguridad

### SSRF prevention
El endpoint del browser se valida contra una whitelist regex (ver `SubscribePushDto`). Solo aceptamos:
- `fcm.googleapis.com`, `android.googleapis.com` (Chrome, Edge)
- `*.push.services.mozilla.com` (Firefox)
- `web.push.apple.com` (Safari)
- `*.notify.windows.com` (Edge Windows)

Esto evita que un atacante registre endpoint=`http://internal-host` y genere requests internas desde nuestro servidor.

### E2E encryption
El payload del push se cifra con las keys `p256dh` + `auth` del browser (Web Push Protocol RFC 8291). El push service intermedio (FCM, etc.) NO puede leer el contenido. Solo el browser del destinatario descifra.

### Audit
Las acciones `push.subscribe` y `push.unsubscribe` no se auditan en v3.0 (volumen esperado bajo). Si se vuelve crítico para GDPR, agregar llamadas a `auditService.log` en PushController.

---

## 8. Operación

### Checklist pre-deploy

- [ ] VAPID keys configuradas en Render
- [ ] `PUSH_DISABLED=false`
- [ ] Migration corrida (automatic via `start:prod`)
- [ ] Netlify headers `netlify.toml` incluyen `/sw.js` Cache-Control max-age=0
- [ ] PNGs en `public/icons/` committed

### Verificar en producción

1. Abrir `https://eva360.ascenda.cl/dashboard` con usuario real.
2. En Chrome DevTools → Application → Manifest → score y preview.
3. Application → Service Workers → ver `/sw.js` "activated and is running".
4. `/perfil` → Activar push → confirmar permiso en el browser.
5. (Dev-only) Botón "Enviar prueba" → debe llegar notif del OS.
6. Click en la notif → abre `/dashboard/perfil`.

### Métricas

```
GET /notifications/push/metrics
Authorization: Bearer <super_admin JWT>
```

Retorna:
```json
{
  "total": 1234,
  "activeLast7d": 980,
  "failuresLast7d": 23,
  "byBrowser": { "Chrome": 650, "Safari": 280, "Firefox": 50 }
}
```

### Incidentes

**Síntoma:** muchos fallos en push logs.
1. Verificar VAPID keys no rotaron inadvertidamente.
2. Verificar endpoint del push service (FCM outage?).
3. Activar killswitch: `PUSH_DISABLED=true` en Render (redeploy 30s).

**Síntoma:** usuario reporta no recibir notifs.
1. `/perfil` → estado del toggle (activo?).
2. DevTools → Application → Service Workers → sw.js está activo?
3. Chrome → Settings → Privacy → Site Settings → Notifications → EVA360 permitido?
4. (Admin) Consultar DB: `SELECT * FROM push_subscriptions WHERE user_id = ?`.
5. Dev: usar `POST /notifications/push/test` para enviar test push.

---

## 9. Rollback

Si la feature causa problemas en producción:

**Opción A — Soft (preferido):**
```bash
# En Render dashboard:
PUSH_DISABLED=true
# Redeploy (30s)
```
La UI sigue funcionando, los pushes no se envían. Subscripciones no se borran.

**Opción B — Revert código:**
```bash
git revert <commit-sha>
git push origin main
# Netlify + Render redeploy (~5 min)
```

La tabla `push_subscriptions` permanece en DB. Si se quiere borrar:
```sql
DROP TABLE push_subscriptions;
ALTER TABLE users DROP COLUMN notification_prefs;
```

---

## 10. Roadmap v3.x

- **v3.0-P1:** Rich notifications con imágenes + action buttons; scheduled reminders (24h antes de deadline); preferences UI granular por evento.
- **v3.0-P2:** Integración Slack/Teams (cross-channel).
- **v3.1:** App nativa iOS/Android (Expo/Capacitor) para usuarios que requieren widgets, modo offline completo, presencia en App Store.

---

_Última actualización: v3.0.0 (2026-04-20)_
