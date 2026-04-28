# EVA360 — Runbook de backups y disaster recovery

Guía operacional para configurar, mantener y ejecutar backups de la base de datos Postgres en producción (Hostinger VPS + docker-compose).

---

## Contexto

- **Qué se backupea:** DB Postgres completa (todos los tenants, users, evaluaciones, etc.). NO se backupean uploads (CVs, exports GDPR) — están en Cloudinary, que tiene su propia durabilidad.
- **Frecuencia:** diaria a las 03:00 AM del VPS.
- **Formato:** `pg_dump -F c -Z 9` (custom format, compresión máxima). Restorable con `pg_restore`.
- **Role utilizado:** `$POSTGRES_USER` (= `eva360`). En el image `postgres:16-alpine` con `POSTGRES_USER=eva360`, ese role se crea con atributo `SUPERUSER`, que implica `BYPASSRLS` automático — los backups funcionan correctamente incluso después de F4 Fase B/C (RLS + FORCE en tablas tenant-scoped).
- **Retención local:** 30 días (configurable via `RETENTION_DAYS` env).
- **Retención off-site (recomendada):** indefinida, con rotación manual si el costo crece. Ver sección "Off-site".

> ⚠️ **NOTA F4 RLS — separación de roles para que RLS proteja realmente**:
>
> En el setup actual, `eva360` es a la vez (a) el rol que la app usa para conectarse y (b) el SUPERUSER que ejecuta backups/migrations. Como SUPERUSER tiene `BYPASSRLS` automático, **las policies RLS son decorativas mientras la app conecte como `eva360`**: cualquier query que ejecute la aplicación bypasea la policy.
>
> Para que RLS proteja de verdad, hace falta separar roles:
>
> | Rol | Privilegios | Uso |
> |---|---|---|
> | `eva360` (existente) | SUPERUSER | Solo backups + migrations + admin |
> | `eva360_app` (nuevo, NOT SUPERUSER) | CONNECT, USAGE, GRANTs explícitos | La app (DATABASE_URL) |
>
> Ver `docs/F4-RLS-FASE-B-RUNBOOK.md` para el procedimiento de role separation. Hasta que se haga, RLS Fase B/C son artefactos preparados pero NO efectivos.

---

## Setup inicial (UNA sola vez por VPS)

SSH a Hostinger. Desde el repo clonado:

```bash
cd ~/docker/eva360
git pull origin main
sudo ./scripts/setup-backups-hostinger.sh
```

Eso:
1. Crea `/root/eva360-backups/`
2. Agrega entrada cron (03:00 AM diaria)
3. Configura logrotate para `/var/log/eva360-backup.log`
4. Corre el primer backup como smoke test

Al terminar deberías ver:

```
✅ Backups automáticos configurados.
  Directorio:           /root/eva360-backups
  Log:                  /var/log/eva360-backup.log
  Cron schedule:        0 3 * * * (cada día a las 03:00 AM del VPS)
```

---

## Off-site upload (recomendado)

Los backups locales no protegen contra: disco corrupto, VPS hackeado, Hostinger borra tu cuenta. Para disaster recovery real hay que subir off-site.

**Opciones baratas** (orden recomendado):

| Proveedor | Costo/100GB mes | Egress | Notas |
|---|---|---|---|
| **Backblaze B2** | ~USD 0.50 | gratis a Cloudflare | El más barato para backups fríos |
| **Cloudflare R2** | ~USD 1.50 | gratis | Zero-egress, ideal si ya usás Cloudflare |
| **Wasabi** | ~USD 0.70 | gratis (dentro de cuota) | Min 1TB commit |
| AWS S3 Glacier | ~USD 0.40 | costoso | Restore lento (horas) |

Todos hablan protocolo S3 — se configura igual:

```bash
# En el VPS:
sudo apt-get install awscli  # si no está

# Agregar al .env del proyecto
cat >> /path/to/eva360/.env <<EOF
BACKUP_S3_BUCKET=eva360-backups
AWS_ACCESS_KEY_ID=<tu_key>
AWS_SECRET_ACCESS_KEY=<tu_secret>
AWS_DEFAULT_REGION=us-east-1
AWS_ENDPOINT_URL=https://s3.us-west-002.backblazeb2.com   # según proveedor
EOF

# Reiniciar para que la cron tome las nuevas vars
# (O pasarlas inline en la crontab; preferible el .env del proyecto)
```

**Verificación manual:**

```bash
sudo BACKUP_S3_BUCKET=eva360-backups \
  AWS_ACCESS_KEY_ID=<key> \
  AWS_SECRET_ACCESS_KEY=<secret> \
  AWS_ENDPOINT_URL=https://... \
  ./scripts/backup-daily.sh
```

En el log debe salir:
```
INFO: Uploading to s3://eva360-backups/
INFO: Upload OK
```

---

## Monitoreo

### Verificación rápida (diaria automatizable)

```bash
./scripts/verify-backup.sh
```

Chequea que:
1. Hay al menos 1 backup en `/root/eva360-backups/`
2. El más reciente tiene menos de 26h (da margen al cron)
3. Tamaño > 1 KB (no es archivo vacío por fallo silencioso)
4. `pg_restore --list` lee el header sin error

Exit code 0 = OK, 1 = problema. Podés engancharlo a tu monitoreo:

```bash
# cron de health check, 1x/día, 1h después del backup
0 4 * * * /path/to/scripts/verify-backup.sh || curl -X POST https://hooks.slack.com/... -d '{"text":"🚨 Backup EVA360 falló"}'
```

### Verificación completa con restore test (mensual)

```bash
./scripts/verify-backup.sh --restore
```

Restaura el último backup a una DB **temporal** dentro del mismo container, corre queries de sanity (COUNT tenants, users), y borra la DB temporal. **No afecta producción.** Tarda 1-5 min según tamaño.

Correr 1 vez al mes. Si falla, es señal de que los backups están corruptos aunque se generen — investigar inmediatamente.

---

## Restore en caso de disaster

**PASOS EN ORDEN. Leer antes de ejecutar.**

### Escenario A — Corrupción de datos o borrado accidental (rollback)

```bash
# 1. Identificar el backup previo al evento
ls -lh /root/eva360-backups/

# 2. Ejecutar restore (pide confirmación + hace safety backup del estado actual)
./scripts/backup-restore.sh /root/eva360-backups/eva360-2026-04-17_03-00.dump

# 3. Si algo sale mal, rollback al safety backup (que se creó en paso 2)
./scripts/backup-restore.sh /root/eva360-backups/pre-restore-YYYY-MM-DD_HH-MM.dump
```

El script `backup-restore.sh`:
- Pide escribir literal `CONFIRMAR` antes de proceder (evita fat-finger)
- Crea un backup de seguridad del estado actual antes
- Hace `pg_restore --clean --if-exists --no-owner`

### Escenario B — VPS perdido / Disco dañado (DR completo)

1. **Aprovisionar nuevo VPS** en Hostinger (mismas specs). Instalar Docker + docker-compose.

2. **Bajar último backup desde off-site:**
   ```bash
   aws s3 cp s3://eva360-backups/eva360-LATEST.dump /root/eva360-backups/ \
     --endpoint-url <endpoint>
   ```
   Si no tenés off-site configurado → **tenés un problema de compliance GDPR serio**. El RPO (recovery point objective) pasó de 24h a "pérdida total". Investigar qué data puede reconstruirse desde otras fuentes (emails de clientes, logs externos).

3. **Clonar repo, copiar `.env` (del backup personal), levantar containers:**
   ```bash
   git clone https://github.com/TESTMODOPACK/EvaPro ~/docker/eva360
   cd ~/docker/eva360
   # Copiar .env manualmente desde backup seguro personal
   docker compose up -d db  # solo DB primero, para restaurar antes de arrancar API
   ```

4. **Restaurar el dump:**
   ```bash
   ./scripts/backup-restore.sh /root/eva360-backups/eva360-LATEST.dump
   ```

5. **Levantar resto y validar:**
   ```bash
   docker compose up -d
   docker compose ps
   # Smoke test: login como super_admin, verificar que 1-2 tenants responden
   ```

6. **Apuntar DNS al nuevo VPS** (Cloudflare/Hostinger DNS).

7. **Notificar a clientes** del downtime (tenés audit logs + emails de contacto en DB recuperada).

**RTO estimado** (recovery time objective): 2-4h con off-site configurado, 8-24h sin.

---

## Alerting (recomendado)

Cuando el backup diario falle, querés enterarte en minutos, no cuando intentás restaurar en emergencia. Opciones:

1. **Sentry cron monitoring** (si ya usás Sentry para la API): envolver `backup-daily.sh` con:
   ```bash
   curl -s https://sentry.io/api/0/organizations/<org>/monitors/<monitor-id>/checkins/ \
     -H "Authorization: DSN <dsn>" \
     -d '{"status":"ok"}' # o "error" si falló
   ```

2. **Slack webhook simple**:
   ```bash
   # Al final de backup-daily.sh, o en un wrapper:
   if ! ./scripts/backup-daily.sh; then
     curl -X POST https://hooks.slack.com/... \
       -d '{"text":"🚨 Backup EVA360 falló en '"$(date)"'"}'
   fi
   ```

3. **Healthchecks.io** (gratis hasta 20 checks): ping un URL al principio y al final del backup. Si no llegan 2 pings en 24h, te llega email/SMS.

---

## Checklist post-setup

- [ ] `setup-backups-hostinger.sh` corrió OK
- [ ] `crontab -l` muestra la entrada del backup
- [ ] Primer backup existe en `/root/eva360-backups/`
- [ ] `verify-backup.sh` retorna exit 0
- [ ] (Opcional pero recomendado) off-site S3/B2 configurado
- [ ] (Opcional pero recomendado) alerta Slack/email en fallo
- [ ] (Opcional) `verify-backup.sh --restore` corrió OK (test de restore)
- [ ] Agendado: `verify-backup.sh --restore` mensual en calendario
- [ ] Agendado: test de DR completo cada 6 meses (reconstruir en VPS alterno)

---

## Preguntas frecuentes

**¿Por qué 30 días de retención?** Balance entre costo de storage (cada dump ~50-500MB según tamaño) y poder rollback ante bug que tardó días en notarse.

**¿Puedo bajar un backup a mi laptop?** Sí, con `scp`:
```bash
scp root@tu-vps:/root/eva360-backups/eva360-2026-04-17_03-00.dump ~/Desktop/
```
Tiene datos sensibles (passwords hasheadas, PII, etc.) — manejarlo con cuidado.

**¿Cuánto crece la DB?** Depende del volumen de evaluaciones por tenant. Orden de magnitud: 20 tenants × 100 users × 1 ciclo/trimestre = ~500MB/año base. Con audit logs puede crecer más rápido.

**¿Puedo recuperar a una fecha específica (point-in-time)?** Solo con los dumps diarios. Para point-in-time real habría que configurar WAL archiving (más complejo, costo mayor, no implementado). Por ahora: el último dump antes del evento es lo más granular que tenés.
