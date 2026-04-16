# Guía de instalación — Grupos A+B+C en producción

Esta guía documenta **todo** lo necesario para activar las features de los Grupos A (GDPR+Unsubscribe), B (Stripe+MercadoPago+Dunning+Trial Nurture) y C (Password policy+SSO OIDC+Impersonación) en producción.

**Regla importante**: el deploy funciona sin ninguna env var nueva — todas las features nuevas se activan solo cuando la env var correspondiente está presente. Esto te permite mergear a main sin romper nada y activar cada feature cuando estés listo.

---

## 🚀 Quick start — Deploy en Hostinger (Docker Compose)

Este es el flujo para este deploy específicamente.

### Paso A: Mergear el PR a main

Desde GitHub, revisar y mergear el PR `develop → main`.

### Paso B: Conectar al server Hostinger por SSH

```bash
ssh usuario@tu-server-hostinger
cd /ruta/a/EvaPro
```

### Paso C: Actualizar env vars (ANTES del pull)

El servidor tiene un archivo `.env` (o `docker-compose.override.yml`) con las env vars actuales. Hay que **agregar** las nuevas sin pisar las existentes. Edita tu archivo de variables:

```bash
nano .env    # o el archivo que uses
```

Agregá al final, **solo las que vas a usar** (todas opcionales; el deploy no crashea si faltan):

```dotenv
# ─── Grupos A+B+C — env vars nuevas ──────────────────────────────────────
# Todas opcionales. Si una falta, el feature correspondiente se deshabilita
# silenciosamente — NO rompe el boot.

# API_URL — URL pública del backend. Requerida si activás SSO o MercadoPago.
# Sin slash final. Ejemplo:
# API_URL=https://eva360-api.tudominio.com

# SSO (solo si vas a activar OIDC por tenant)
# Generá con: openssl rand -hex 32
# SSO_SECRET_KEY=...

# Stripe (live mode — ver sección 4 de esta guía para registro)
# STRIPE_SECRET_KEY=sk_live_...
# STRIPE_WEBHOOK_SECRET=whsec_...

# MercadoPago (live mode — ver sección 5)
# MERCADOPAGO_ACCESS_TOKEN=APP_USR-...
# MERCADOPAGO_WEBHOOK_SECRET=...
```

Guardá (`Ctrl+O`, `Enter`, `Ctrl+X`).

### Paso D: Deploy con tu workflow habitual

Ejecutá tu secuencia usual de comandos en el server:

```bash
git fetch && git reset --hard origin/main
docker compose build --no-cache api web
docker compose up -d
docker image prune -f
```

### Paso E: Verificar el arranque

Logs del API:

```bash
docker compose logs -f api | head -50
```

Debés ver:
```
[startup] Calibration + GDPR tables ensured
[startup] Column fixes checked (N columns)
[Nest] LOG [NestApplication] Nest application successfully started
```

Si activaste Stripe:
```
[Nest] LOG [StripeProvider] Stripe provider ready
```

Si activaste MercadoPago:
```
[Nest] LOG [MercadoPagoProvider] MercadoPago provider ready
```

Si no setaste una env var, vas a ver un warning pero el server arranca igual:
```
[Nest] WARN [StripeProvider] STRIPE_SECRET_KEY not set — Stripe provider is DISABLED
```

### Paso F: Smoke test

Ir a `https://tu-app.com/dashboard/perfil` y scroll al final — debés ver el card **"Privacidad y datos personales"**. Si aparece, el deploy está OK.

Continúa con [sección 9 — Verificación post-deploy](#9-verificación-post-deploy) para el checklist completo.

### Script todo-en-uno para el server Hostinger

Guardá este script como `deploy-grupos-abc.sh` en el server (NO lo commitees):

```bash
#!/usr/bin/env bash
# deploy-grupos-abc.sh — Deploy de Grupos A+B+C en Hostinger.
# Correr desde la raíz del repo en el server, DESPUÉS de haber editado
# el .env con las env vars nuevas opcionales.
set -euo pipefail

echo "▶ 1/4 Pull de main..."
git fetch
git reset --hard origin/main

echo "▶ 2/4 Rebuild de imágenes (sin cache)..."
docker compose build --no-cache api web

echo "▶ 3/4 Levantando contenedores..."
docker compose up -d

echo "▶ 4/4 Limpiando imágenes huérfanas..."
docker image prune -f

echo ""
echo "▶ Esperando que el API responda al healthcheck..."
for i in $(seq 1 30); do
  if docker compose logs api --tail=100 2>/dev/null | grep -q "Nest application successfully started"; then
    echo "✅ API arriba"
    break
  fi
  sleep 2
done

echo ""
echo "▶ Verificando features activadas (ninguna requerida):"
docker compose logs api --tail=100 | grep -E "StripeProvider|MercadoPagoProvider|SSO|GDPR|Calibration" || echo "(sin output — revisar logs completos con: docker compose logs api | head -100)"

echo ""
echo "✅ Deploy completado. Smoke test:"
echo "   - Dashboard: https://tu-app.com/dashboard/perfil (ver card 'Privacidad y datos')"
echo "   - API health: curl https://tu-api.com/health"
```

Uso:
```bash
chmod +x deploy-grupos-abc.sh
./deploy-grupos-abc.sh
```

---

## 📋 Índice

1. [Deploy inicial (sin features nuevas)](#1-deploy-inicial-sin-features-nuevas)
2. [Activar GDPR](#2-activar-gdpr--no-requiere-registro-externo)
3. [Activar Unsubscribe](#3-activar-unsubscribe-automático-con-el-deploy)
4. [Registrar y activar Stripe](#4-registrar-y-activar-stripe)
5. [Registrar y activar MercadoPago](#5-registrar-y-activar-mercadopago)
6. [Activar SSO](#6-activar-sso-opcional)
7. [Activar Password Policy + Impersonación](#7-activar-password-policy--impersonación-automático-con-el-deploy)
8. [Script todo-en-uno para generar secretos](#8-script-todo-en-uno-para-generar-secretos)
9. [Verificación post-deploy](#9-verificación-post-deploy)
10. [Rollback](#10-rollback)

---

## 1. Deploy inicial (sin features nuevas)

### 1.1. Mergear el PR

1. Revisar y aprobar el PR `develop → main` en GitHub.
2. Mergear. Render/Netlify disparan deploy automático.

### 1.2. Verificar el boot

El script `cleanup-orphans.ts` corre al arranque y crea idempotentemente:
- Tablas: `gdpr_requests`, `payment_sessions`, `password_history`, `oidc_configurations`.
- Columnas: `users.password_changed_at`, `users.failed_login_attempts`, `users.locked_until`, `invoices.dunning`, `subscriptions.nurture_emails_sent`.

**No requiere migration manual.** Verificar en logs:

```
[startup] Calibration + GDPR tables ensured
[startup] Column fixes checked (N columns)
```

### 1.3. Smoke test

Con el deploy arriba, **TODO lo que funcionaba antes sigue funcionando**. Login normal, recordatorios, reportes, etc.

Para verificar que los Grupos A y C activaron correctamente (no requieren config):

- **`/dashboard/perfil`** → scroll al final → debe verse card **"Privacidad y datos personales"** (GDPR).
- **`/dashboard/perfil`** → input "Nueva contraseña" → escribí algo → debe aparecer barra de fortaleza + checklist.
- **`/dashboard/ajustes`** (como tenant_admin) → debe haber 2 tabs nuevas: **"Privacidad y datos"** y **"Seguridad"**.
- **`/dashboard/tenants`** (como super_admin) → cada fila tiene botón **"Impersonar"**.

Si todo eso se ve, el deploy base está OK.

---

## 2. Activar GDPR — no requiere registro externo

**Ya funciona por defecto** con el deploy. Requisitos pre-existentes:
- Cloudinary configurado (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`). Ya estaba seteado para CVs.
- Resend configurado (`RESEND_API_KEY`, `EMAIL_FROM`). Ya estaba seteado.

No hay nada extra que hacer. El export de datos genera un ZIP y lo sube a Cloudinary; el link llega por email.

---

## 3. Activar Unsubscribe — automático con el deploy

Los emails transaccionales ya salen con footer **"Darse de baja"** y header `List-Unsubscribe`. El usuario hace click → llega a `/unsubscribe?token=xxx` → gestiona preferencias.

**Nada que configurar.** Tokens usan `JWT_SECRET` (ya existente).

---

## 4. Registrar y activar Stripe

### 4.1. Crear cuenta Stripe (si no existe)

1. Ir a **https://stripe.com** → "Start now".
2. Registrarse con email corporativo.
3. Completar onboarding:
   - Business type: **"Company"**.
   - Country: **Chile** (o el país donde facturás).
   - Business name, RUT/Tax ID, dirección.
   - Cuenta bancaria para recibir los cobros (puede agregarse después para test).
4. Verificar email.

### 4.2. Generar las claves

1. Dashboard Stripe → **Developers** → **API keys**.
2. Tenés 2 sets de claves:
   - **Test mode** (empiezan con `sk_test_...`, `pk_test_...`): para desarrollo.
   - **Live mode** (empiezan con `sk_live_...`, `pk_live_...`): para producción.

Para PRODUCCIÓN usar las **live**. Copiar:
- `Secret key` → va a `STRIPE_SECRET_KEY`.
- `Publishable key` → no la usamos en el backend pero guardala para eventual Stripe Elements en el frontend.

### 4.3. Configurar webhook

1. Dashboard Stripe → **Developers** → **Webhooks** → **+ Add endpoint**.
2. Endpoint URL: `https://TU-API.com/webhooks/stripe` (reemplazá por tu dominio real de API, ej: `https://eva360-api.onrender.com/webhooks/stripe`).
3. **Events to send** — seleccionar:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `payment_intent.payment_failed`
4. Click **"Add endpoint"**.
5. En la pantalla siguiente, copiar el **"Signing secret"** (empieza con `whsec_...`) → va a `STRIPE_WEBHOOK_SECRET`.

### 4.4. Setear env vars

En Render (o donde tengas el backend):

| Variable | Valor |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |

Redeploy. En los logs debería aparecer:
```
[Nest] LOG [StripeProvider] Stripe provider ready
```

### 4.5. Probar en test mode primero

Antes de ir a live, probar con las claves de test (`sk_test_...`, `whsec_test_...`):
- Stripe provee tarjetas de prueba: `4242 4242 4242 4242` (any future date, any CVC, any ZIP) → exitoso.
- `4000 0000 0000 0341` → falla en webhook.

---

## 5. Registrar y activar MercadoPago

### 5.1. Crear cuenta MercadoPago

1. Ir a **https://www.mercadopago.cl** (o `.com.ar`, `.com.mx`, `.com.br` según país).
2. Registrarse con email corporativo.
3. Completar verificación de identidad (RUT para Chile, CUIT para Argentina, etc.).
4. Completar datos de cuenta bancaria para recibir liquidaciones.

### 5.2. Crear aplicación en Developers

1. Dashboard MP → **"Tus integraciones"** → **"Crear aplicación"**.
2. Nombre: `Eva360`.
3. Modelo de integración: **"Pagos online en productos y servicios"** → **"Online"**.
4. Solución: **"Checkout Pro"**.
5. **No pedir información de tarjeta** (nuestra integración usa Preference + init_point).

### 5.3. Obtener credenciales

1. Dentro de la aplicación creada → pestaña **"Credenciales"**.
2. Dos ambientes:
   - **Credenciales de prueba** (test).
   - **Credenciales de producción** (live).
3. Para producción, copiar:
   - **Access Token** (empieza con `APP_USR-...`) → va a `MERCADOPAGO_ACCESS_TOKEN`.

### 5.4. Configurar webhook (notificaciones)

1. Dashboard MP → Tu aplicación → **"Webhooks"** → **"Configurar notificaciones"**.
2. URL: `https://TU-API.com/webhooks/mercadopago`.
3. Eventos a escuchar: **"Pagos"** (tick en `payment`).
4. Guardar.
5. **"Clave secreta"** (para firmar): generala y copiala → va a `MERCADOPAGO_WEBHOOK_SECRET`.

### 5.5. Setear env vars

| Variable | Valor |
|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | `APP_USR-...` |
| `MERCADOPAGO_WEBHOOK_SECRET` | `<clave secreta del paso 5.4>` |
| `API_URL` | `https://tu-api.com` (sin slash final) ⚠️ obligatorio |

Redeploy. Logs:
```
[Nest] LOG [MercadoPagoProvider] MercadoPago provider ready
```

### 5.6. Probar en ambiente de prueba

MP provee usuarios de test: `https://www.mercadopago.cl/developers/panel/app/test-accounts`. Crear uno y usarlo para probar el flujo antes de ir a producción.

---

## 6. Activar SSO (opcional)

SSO solo tiene sentido si tenés clientes enterprise que lo pidan. Cada tenant configura su propio IdP desde `/ajustes` → tab "Seguridad" → "Single Sign-On (OIDC)".

### 6.1. Generar la key de encriptación

SSO encripta el `client_secret` del IdP con AES-256-GCM. Necesitás una key:

```bash
openssl rand -hex 32
# Ejemplo: 3a7f9c2e8b5d4f1a...
```

### 6.2. Setear env var

| Variable | Valor |
|---|---|
| `SSO_SECRET_KEY` | `<64 hex chars del paso 6.1>` |
| `API_URL` | `https://tu-api.com` (obligatorio si no estaba seteado) |

### 6.3. Instrucciones para el cliente final (tenant_admin)

El cliente entra a `/dashboard/ajustes` → tab **"Seguridad"** → formulario **"Single Sign-On (OIDC)"**. Ahí pega:

- **Issuer URL**: según su IdP:
  - Google Workspace: `https://accounts.google.com`
  - Microsoft Entra: `https://login.microsoftonline.com/<tenant-id>/v2.0`
  - Okta: `https://<empresa>.okta.com/oauth2/default`
  - Auth0: `https://<tenant>.auth0.com`
  - Keycloak: `https://<host>/realms/<realm>`
- **Client ID**: lo obtiene registrando Eva360 como "App" en su IdP. En la configuración del IdP debe agregar el Redirect URI: `https://tu-api.com/auth/sso/callback`.
- **Client Secret**: lo obtiene del IdP al crear la app.
- **Dominios permitidos**: lista de dominios de email que acepta el SSO, ej: `acme.com, acme.cl`.
- **Mapeo de roles** (JSON): ej: `{"tenant_admin": ["groups:eva-admins"], "manager": ["groups:managers"]}`. Si no mapea, los users entran como `employee`.
- **Activar SSO**: ✓.
- **Forzar SSO** (opcional): bloquea login con password para usuarios cuyo email termina en los dominios permitidos.

Tras guardar, el backend valida el issuer (hace discovery) y encripta el secret. Si el issuer es inválido, falla con error claro.

### 6.4. Del lado del usuario final

Cuando un user escribe su email en `/login`, el sistema detecta que es un email SSO-enabled y muestra **"Tu organización usa SSO"** + botón **"Iniciar con SSO"**.

---

## 7. Activar Password Policy + Impersonación — automático con el deploy

### Password policy

- **Defaults** (aplicados a todos los tenants sin config): 8 chars, mayús/minús/número, sin expiry, sin history, lockout a 5 intentos por 15 min.
- Para customizar, el tenant_admin va a `/dashboard/ajustes` → tab **"Seguridad"** → **"Política de contraseñas"**. Setea lo que necesite y guarda.

### Impersonación

Los super_admin ven el botón **"Impersonar"** en `/dashboard/tenants` automáticamente. Cada sesión dura máx. 1 hora, queda auditada, y el tenant_admin real recibe email notificándolo.

**Nada que configurar.** Usa `JWT_SECRET` ya existente.

---

## 8. Script todo-en-uno para generar secretos

Correr una sola vez para generar los secretos nuevos:

```bash
#!/usr/bin/env bash
# generate-new-secrets.sh — Genera las env vars nuevas para Grupos A+B+C.
# Uso: bash generate-new-secrets.sh > nuevos-secretos.txt

set -e

echo "# ====== Env vars nuevas para Grupos A+B+C ======"
echo "# Generado el $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# NO commitear este archivo. Pegalo en Render / Vercel / tu secret manager."
echo ""

echo "# --- SSO (opcional, solo si vas a activar SSO) ---"
echo "SSO_SECRET_KEY=$(openssl rand -hex 32)"
echo ""

echo "# --- API_URL (obligatoria si activás SSO o MercadoPago) ---"
echo "# Reemplazá por la URL pública real del backend, sin slash final."
echo "# API_URL=https://eva360-api.onrender.com"
echo ""

echo "# --- Stripe (opcional — completar desde Dashboard Stripe) ---"
echo "# STRIPE_SECRET_KEY=sk_live_..."
echo "# STRIPE_WEBHOOK_SECRET=whsec_..."
echo ""

echo "# --- MercadoPago (opcional — completar desde Dashboard MP) ---"
echo "# MERCADOPAGO_ACCESS_TOKEN=APP_USR-..."
echo "# MERCADOPAGO_WEBHOOK_SECRET=..."
```

Hacelo ejecutable y correlo:

```bash
chmod +x generate-new-secrets.sh
./generate-new-secrets.sh > nuevos-secretos.txt
cat nuevos-secretos.txt
# Copiá el contenido al dashboard de Render/Netlify/etc.
rm nuevos-secretos.txt   # después de copiar, borrarlo
```

**Importante**: agregá `nuevos-secretos.txt` a tu `.gitignore` si no está.

---

## 9. Verificación post-deploy

Checklist de 10 minutos para validar que todo funciona:

### Smoke base (sin config nueva)

- [ ] Deploy arranca sin crash. Logs muestran `[startup] Calibration + GDPR tables ensured`.
- [ ] Login con user existente funciona igual que antes.
- [ ] `/dashboard/perfil` → card "Privacidad y datos" visible.
- [ ] `/dashboard/perfil` → cambiar password muestra strength meter.
- [ ] `/dashboard/ajustes` (tenant_admin) → tabs "Privacidad" y "Seguridad" visibles.
- [ ] Footer de cualquier email (ej: reenviar `sendCycleLaunched` desde `/notificaciones` test endpoint) → link "Darse de baja" visible.
- [ ] `/unsubscribe?token=xxx-fake` → pantalla "Enlace inválido o expirado".

### Con Stripe configurado

- [ ] `GET /payments/providers` retorna `[{ name: 'stripe', enabled: true }, ...]`.
- [ ] `/mi-suscripcion` con factura pendiente → botón "Pagar" → modal muestra "Pagar con Stripe".
- [ ] Completar checkout con `4242 4242 4242 4242` → redirect a `/pago/exitoso`.
- [ ] Verificar que la factura quedó como `paid` en `/facturacion` (super_admin).

### Con MercadoPago configurado

- [ ] Idem Stripe pero con usuario de test de MP.

### Con SSO configurado en un tenant de prueba

- [ ] Desde `/ajustes` → Seguridad → configurar OIDC con tu IdP de prueba (Auth0 dev tenant funciona).
- [ ] Hacer logout. En `/login` escribir un email con dominio de ese tenant → debe aparecer banner "Tu organización usa SSO".
- [ ] Click "Iniciar con SSO" → redirect al IdP → autenticar → volver a dashboard.

### Impersonación

- [ ] Como super_admin: `/dashboard/tenants` → cualquier tenant activo → "Impersonar" → ingresar motivo → dashboard aparece con banner rojo.
- [ ] Intentar `/dashboard/perfil` → cambiar password → debe rechazar con 403.
- [ ] Click "Salir de impersonación" → vuelve a vista super_admin.
- [ ] Verificar que el tenant_admin del target recibió email notificando el acceso.

---

## 10. Rollback

Si algo sale mal y necesitás revertir:

### 10.1. Revert del código

```bash
git revert <sha-del-commit>
git push origin main
```

El deploy automático vuelve al código anterior.

### 10.2. Revert de schema

**NO es necesario rollback de schema** — los cambios son aditivos:
- Tablas nuevas (`gdpr_requests`, `payment_sessions`, `password_history`, `oidc_configurations`) quedan pero sin uso.
- Columnas nuevas en `users`, `invoices`, `subscriptions` son nullable/default — no rompen el código viejo.

Si querés limpiar las tablas nuevas (opcional, no crítico):

```sql
DROP TABLE IF EXISTS gdpr_requests;
DROP TABLE IF EXISTS payment_sessions;
DROP TABLE IF EXISTS password_history;
DROP TABLE IF EXISTS oidc_configurations;

ALTER TABLE users DROP COLUMN IF EXISTS password_changed_at;
ALTER TABLE users DROP COLUMN IF EXISTS failed_login_attempts;
ALTER TABLE users DROP COLUMN IF EXISTS locked_until;
ALTER TABLE invoices DROP COLUMN IF EXISTS dunning;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS nurture_emails_sent;
```

### 10.3. Deshabilitar features individualmente sin revert

Si un feature específico causa problemas, **basta con quitar la env var**:

- **Sin `STRIPE_SECRET_KEY`** → Stripe desactivado. El botón "Pagar" muestra "No hay métodos" si tampoco hay MP.
- **Sin `MERCADOPAGO_ACCESS_TOKEN`** → idem.
- **Sin `SSO_SECRET_KEY`** → endpoints `/auth/sso/*` retornan 503.
- GDPR, Unsubscribe, Password Policy e Impersonación **no pueden deshabilitarse** por env var (usan infra ya existente). Si necesitás deshabilitarlos, hacé revert del código.

---

## 📞 Soporte

Si algo de esta guía no queda claro o falla en tu entorno, los lugares clave para debuggear:

- **Logs del backend**: `pino` en stdout (visibles en Render dashboard → Logs).
- **Audit trail**: tabla `audit_logs` — filtrar por `action LIKE 'gdpr%'`, `payment%`, `sso%`, `impersonation%`.
- **Cloudinary**: para exports GDPR, verificar que el upload se hizo (ver folder `evapro/gdpr-exports/`).
- **Stripe / MP dashboards**: cada webhook tiene log de delivery y retry.

Gaps conocidos y deuda técnica están documentados en el mensaje del commit y en el plan file (`swirling-exploring-canyon.md` del agente).
