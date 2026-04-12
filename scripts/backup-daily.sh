#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
# backup-daily.sh — pg_dump diario del tenant demo + retencion 30 dias
# ══════════════════════════════════════════════════════════════════════
#
# Uso manual:
#   ./scripts/backup-daily.sh
#
# Uso en cron (VPS Hostinger):
#   # Ejecutar todos los dias a las 03:00 AM
#   0 3 * * * cd /root/EvaPro && ./scripts/backup-daily.sh >> /var/log/eva360-backup.log 2>&1
#
# Que hace:
#   1. pg_dump del container eva360_db en formato custom (comprimido)
#   2. Guarda en /root/eva360-backups/YYYY-MM-DD_HH-MM.dump
#   3. Sube a S3/R2 si BACKUP_S3_BUCKET esta definido (opcional Fase 0)
#   4. Borra backups locales con mas de 30 dias de antiguedad
#   5. Loggea exito/fallo via `logger` (journalctl)
#
# Restaurar un backup:
#   docker compose exec -T db pg_restore -U $POSTGRES_USER -d $POSTGRES_DB -c < /ruta/al/backup.dump
#
# ══════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/root/eva360-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
CONTAINER_NAME="${CONTAINER_NAME:-eva360_db}"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M)
BACKUP_FILE="${BACKUP_DIR}/eva360-${TIMESTAMP}.dump"
LOG_TAG="eva360-backup"

# ── Helpers ───────────────────────────────────────────────────────────
log_info() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO: $*"
  command -v logger >/dev/null 2>&1 && logger -t "${LOG_TAG}" -p user.info "$*" || true
}

log_error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2
  command -v logger >/dev/null 2>&1 && logger -t "${LOG_TAG}" -p user.err "$*" || true
}

# ── Pre-flight checks ─────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  log_error "docker no esta instalado — aborting"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  log_error "Container '${CONTAINER_NAME}' no esta corriendo — aborting"
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

# ── pg_dump ───────────────────────────────────────────────────────────
log_info "Starting pg_dump to ${BACKUP_FILE}"
start_ts=$(date +%s)

# Usa las variables de entorno del container (POSTGRES_USER, POSTGRES_DB)
# para que este script funcione sin importar como esten seteadas las
# credenciales en el .env del VPS.
if ! docker exec -t "${CONTAINER_NAME}" sh -c \
    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F c -Z 9' > "${BACKUP_FILE}"; then
  log_error "pg_dump failed"
  rm -f "${BACKUP_FILE}"
  exit 1
fi

size_bytes=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null || echo "?")
duration=$(($(date +%s) - start_ts))
log_info "pg_dump OK — ${BACKUP_FILE} (${size_bytes} bytes, ${duration}s)"

# Sanity check: backup no puede ser <1KB (probablemente pg_dump fallo silencioso)
if [ "${size_bytes}" != "?" ] && [ "${size_bytes}" -lt 1024 ]; then
  log_error "Backup file es sospechosamente chico (${size_bytes} bytes) — aborting cleanup"
  exit 1
fi

# ── Upload a S3/R2 (opcional) ─────────────────────────────────────────
# Si BACKUP_S3_BUCKET esta definido, sube el backup. Soporta AWS CLI con
# el endpoint configurado para R2/Wasabi/etc. via variables estandar
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL.
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  if command -v aws >/dev/null 2>&1; then
    log_info "Uploading to s3://${BACKUP_S3_BUCKET}/"
    if aws s3 cp "${BACKUP_FILE}" "s3://${BACKUP_S3_BUCKET}/$(basename "${BACKUP_FILE}")" --quiet; then
      log_info "Upload OK"
    else
      log_error "Upload failed — backup local preservado"
    fi
  else
    log_error "BACKUP_S3_BUCKET definido pero 'aws' CLI no instalado — skipping upload"
  fi
fi

# ── Retencion local ───────────────────────────────────────────────────
log_info "Cleaning up backups older than ${RETENTION_DAYS} days"
deleted=$(find "${BACKUP_DIR}" -name "eva360-*.dump" -type f -mtime +${RETENTION_DAYS} -print -delete | wc -l)
log_info "Deleted ${deleted} old backup(s)"

log_info "Backup job finished successfully"
exit 0
