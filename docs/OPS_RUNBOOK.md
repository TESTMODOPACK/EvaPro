# EVA360 — Runbook operacional

Guía complementaria al `BACKUPS_RUNBOOK.md`. Cubre deploys, log rotation, observability y rolling updates en Hostinger VPS con docker-compose.

---

## Deploys estándar (con downtime corto)

Actual. El comando habitual hoy:

```bash
cd ~/docker/eva360
git fetch && git reset --hard origin/main
docker compose build --no-cache api  # o web, o ambos
docker compose up -d api
docker image prune -f
```

**Downtime esperado:** 30–90 segundos (container viejo se detiene antes de que el nuevo esté listo).

Impacto en usuarios: requests en vuelo reciben 502 durante la ventana. Pagos, uploads y submisiones pueden fallar mid-operación.

Para deploys de features poco críticos (cambios de texto, estilos) este downtime es aceptable. Para cambios que afectan pagos o webhooks → usar estrategia rolling (sección siguiente).

---

## Deploy zero-downtime (rolling)

**Cuándo usarlo:**
- Cambios que tocan webhooks de pago (Stripe/MP reintenta 3x, pero 502 durante el window puede causar desorden)
- Ventanas de alta carga (horarios de evaluación masiva 9–17hs CL)
- Releases que requieren "no perder ningún request"

**Cómo hacerlo en 1 VPS (sin blue/green):**

Docker-compose permite recrear un servicio sin tocar los demás. La clave es subir la nueva imagen **antes** de bajar la vieja y dejar que el healthcheck confirme que la nueva responde. Nginx hace reintentos a upstream si el primer intento falla → el usuario ve una espera de 1–3s pero no un error.

```bash
cd ~/docker/eva360
git fetch && git reset --hard origin/main

# 1. Build de la nueva imagen EN PARALELO al api actual corriendo
docker compose build --no-cache api

# 2. Recreate el servicio api con la nueva imagen. --no-deps evita
#    que levante/baje la db o el web. Docker Compose v2 hace esto de
#    forma sequencial: baja el viejo → levanta el nuevo. Hay un gap
#    de ~10-30s dependiendo del start_period del healthcheck.
docker compose up -d --no-deps api

# 3. Esperar a que el nuevo pase healthcheck antes de limpiar imágenes
#    y dar por OK el deploy. start_period del api es 90s.
timeout 120 bash -c 'until docker inspect eva360_api --format "{{.State.Health.Status}}" | grep -q healthy; do echo "esperando healthy..."; sleep 5; done'

# 4. Si llegó a healthy, cleanup
docker compose logs --tail=20 api | grep -iE 'running|error'
docker image prune -f
```

**Caveat:** durante el `up -d api`, hay ~10–30s donde el container viejo ya terminó y el nuevo no arrancó. Nginx recibe 502/503. Para mitigar completamente hay que montar un setup con 2 réplicas balanceadas (ver "Blue/green futuro" abajo) — por ahora con 20 tenants y poca concurrencia sincrónica no amerita esa complejidad.

**Smoke test post-deploy:**

```bash
# 1. Health
curl -fsS https://eva360.ascenda.cl/api/health/live
# 2. Login endpoint responde 4xx (no 5xx) sin credenciales
curl -s -o /dev/null -w "%{http_code}\n" https://eva360.ascenda.cl/api/auth/login
# 3. Web sirve
curl -fsS https://eva360.ascenda.cl/login > /dev/null && echo OK
```

Si cualquiera falla → rollback:

```bash
git reset --hard <sha-previo>
docker compose build --no-cache api
docker compose up -d --no-deps api
```

---

## Log rotation

Los containers loguean a stdout. Docker persiste esos logs en `/var/lib/docker/containers/<id>/*-json.log`. Sin rotación, en semanas/meses llenan el disco y el API se detiene silenciosamente.

**Configurado automáticamente** en `docker-compose.yml` — cada servicio tiene:

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "50m"
    max-file: "5"
```

Esto da hasta 250 MB de logs por servicio (5 archivos × 50MB) con rotación FIFO. Se aplica al hacer `docker compose up -d` — no requiere restart del engine Docker.

**Verificación:**

```bash
docker inspect eva360_api --format '{{json .HostConfig.LogConfig}}'
# Debe mostrar: {"Type":"json-file","Config":{"max-file":"5","max-size":"50m"}}
```

Si un servicio se creó antes de este setting, hay que recrearlo:

```bash
docker compose up -d --force-recreate <servicio>
```

---

## Monitoreo de recursos del VPS

### Disco

```bash
df -h /
# Alertar si > 80%
```

Principales consumidores en VPS de EVA360:
- `/var/lib/docker/` — imágenes + logs + volumes
- `/root/eva360-backups/` — backups rotativos (máx 30 días × ~500MB = 15 GB típico)
- `/var/log/eva360-backup.log` — rotado por logrotate semanal

Limpieza manual si llena:

```bash
docker system prune -af            # Borra imágenes/containers no usados
docker image prune -af             # Solo imágenes
docker volume ls                   # Ver volumes, NO borrar sin respaldo (postgres_data!)
```

### Memoria

```bash
docker stats --no-stream
# Cada servicio debe estar bajo su mem_limit (api 768m, web 384m, db 512m, nginx 64m)
```

Si api llegó al límite repetidamente → revisar heap dumps o considerar subir mem_limit en `docker-compose.yml`.

### CPU

```bash
top                                 # Load average del VPS completo
docker stats --no-stream | awk '{print $1, $2, $3}'
```

Pico típico: `autoCloseCycles` + `processAutoRenewals` ejecutan de madrugada (00:00 y 02:00 UTC-3) — CPU spike es normal.

---

## Métricas Prometheus

`/metrics` expone métricas Prometheus (protegido con basic auth via `METRICS_USER` / `METRICS_PASSWORD` del `.env`).

Si Prometheus + Grafana está configurado, dashboards recomendados:

- **Request rate** (requests/s por endpoint)
- **p95 latency** de endpoints críticos (/login, /payments/*, /evaluations/*)
- **Cron job duration** (especialmente dunning y auto-renewals)
- **AI calls** (counter por tenant, alert si > quota del plan)
- **DB connection pool** (utilization, waits)

Si no hay setup de monitoring aún: ver `.env.example` sección "Metricas Prometheus".

---

## Alertas recomendadas

Para operar EVA360 con 20+ tenants, recomiendo configurar alertas en al menos estos escenarios:

| Condición | Severidad | Canal | Acción |
|---|---|---|---|
| Healthcheck `/api/health/live` down > 2 min | Crítica | PagerDuty/SMS | On-call responde |
| Disco `/` > 85% | Alta | Slack | Run `docker system prune -af` |
| Backup diario no completó | Alta | Email + Slack | Ver `BACKUPS_RUNBOOK.md` |
| Cron `escalateOverdueInvoices` falló | Alta | Slack | Review audit log + retry |
| `/metrics` retorna HTTP error rate > 5% | Media | Slack | Ver `/api/health/ready` + logs |
| DB connections > 18/20 pool | Media | Slack | Revisar queries lentas |

Si no hay Slack/PagerDuty configurado, mínimo: cron local que chequea `/health/live` cada 5 min y manda email al admin si falla.

---

## Rollback

### Rollback de código (rápido)

```bash
cd ~/docker/eva360
git log --oneline -10                # Ver commits recientes, identificar el bueno
git reset --hard <sha-bueno>
docker compose build --no-cache api
docker compose up -d api
```

### Rollback de DB (DR completo)

Ver `BACKUPS_RUNBOOK.md` sección "Restore en caso de disaster".

---

## Checklist de release

Antes de mergear a main:

- [ ] Typecheck pasó (`npx tsc --noEmit` en api y web)
- [ ] Build pasó (`npx nest build` y `npx next build`)
- [ ] Tests unitarios pasaron (si aplica)
- [ ] Bug review exhaustivo de los cambios
- [ ] Si hay migrations de schema: script documentado en `cleanup-orphans.ts` o SQL manual
- [ ] Commit message claro (qué/por qué/cómo)

Después del deploy a Hostinger:

- [ ] `docker compose ps` — todos healthy
- [ ] `docker compose logs --tail=30 api` — sin errores
- [ ] Smoke test manual (login, 1 operación crítica del cambio)
- [ ] Si tocó backups/crons/auth: correr script de verificación correspondiente
- [ ] Tag git con versión si el cambio es notable

---

## Futuro — Blue/green con 2 VPS

El setup actual (1 VPS + docker-compose) tiene un techo: downtime mínimo durante deploys. Para eliminarlo completamente:

1. **2 VPS en Hostinger** (o 1 VPS + 1 droplet en DigitalOcean como backup)
2. **Cloudflare DNS con 2 A records** (uno por VPS)
3. **Cloudflare Load Balancer** (o simplemente switch de DNS TTL bajo: 60s)
4. Deploy en VPS B (mientras A sirve) → health check A → switch DNS → decommission A

**Cuándo justifica la migración:** cuando haya SLA contractual con algún tenant que no tolere 60s de downtime, o cuando tráfico supere lo que 1 VPS puede manejar (~100 req/s sostenido).

Por ahora (20+ tenants, trafico moderado): el rolling deploy con 1 VPS alcanza.
