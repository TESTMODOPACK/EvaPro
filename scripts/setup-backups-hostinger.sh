#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
# setup-backups-hostinger.sh — Instalador one-shot de backups diarios
# ══════════════════════════════════════════════════════════════════════
#
# Configura el backup diario de Postgres en el VPS de Hostinger.
# Corre UNA VEZ tras el primer deploy (o tras un VPS nuevo).
#
# Uso:
#   sudo ./scripts/setup-backups-hostinger.sh
#
# Lo que hace:
#   1. Verifica que docker + container eva360_db están corriendo
#   2. Crea /root/eva360-backups (directorio de destino)
#   3. Agrega entrada cron diaria a las 03:00 AM (sin duplicar si existe)
#   4. Configura logrotate para que /var/log/eva360-backup.log no crezca
#   5. Corre backup-daily.sh una vez para validar end-to-end
#   6. Reporta resultado (dump size, retention, próxima ejecución)
#
# Off-site upload (opcional, después de la instalación inicial):
#   Agregá al .env del VPS:
#     BACKUP_S3_BUCKET=eva360-backups
#     AWS_ACCESS_KEY_ID=...
#     AWS_SECRET_ACCESS_KEY=...
#     AWS_ENDPOINT_URL=https://<cuenta>.r2.cloudflarestorage.com  # o B2/S3
#   Y asegurate de instalar aws-cli: `apt-get install awscli`
#
# ══════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="${SCRIPT_DIR}/backup-daily.sh"
BACKUP_DIR="${BACKUP_DIR:-/root/eva360-backups}"
LOG_FILE="/var/log/eva360-backup.log"
CRON_LINE="0 3 * * * cd $(cd "${SCRIPT_DIR}/.." && pwd) && ./scripts/backup-daily.sh >> ${LOG_FILE} 2>&1"

# ── Helpers ───────────────────────────────────────────────────────────
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*" >&2; }

# ── Pre-flight ────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════"
echo "  EVA360 — Setup de backups automáticos"
echo "═══════════════════════════════════════════════════"
echo ""

if [ "$(id -u)" -ne 0 ]; then
  red "Este script debe correr como root (o con sudo)."
  red "   sudo ./scripts/setup-backups-hostinger.sh"
  exit 1
fi

if [ ! -x "${BACKUP_SCRIPT}" ]; then
  yellow "backup-daily.sh no es ejecutable, aplicando chmod +x"
  chmod +x "${BACKUP_SCRIPT}"
fi

if ! command -v docker >/dev/null 2>&1; then
  red "docker no está instalado. Abortando."
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^eva360_db$"; then
  red "Container eva360_db no está corriendo. Levantalo con 'docker compose up -d' primero."
  exit 1
fi

green "✓ Pre-flight OK (root, docker, container eva360_db up)"
echo ""

# ── Paso 1: directorio de backups ─────────────────────────────────────
echo "[1/5] Preparando directorio de backups…"
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"  # Solo root lee/escribe — backups tienen datos sensibles
green "  ✓ ${BACKUP_DIR} listo (permisos 700)"
echo ""

# ── Paso 2: cron ──────────────────────────────────────────────────────
echo "[2/5] Configurando cron (03:00 AM diariamente)…"

# Crear crontab si no existe, y agregar línea solo si no está ya
(crontab -l 2>/dev/null || true) > /tmp/eva360-crontab.tmp

if grep -Fq "backup-daily.sh" /tmp/eva360-crontab.tmp; then
  yellow "  ⚠ Ya existe una entrada cron para backup-daily.sh. Revisá 'crontab -l' si querés actualizarla."
else
  echo "${CRON_LINE}" >> /tmp/eva360-crontab.tmp
  crontab /tmp/eva360-crontab.tmp
  green "  ✓ Cron agregado: ${CRON_LINE}"
fi
rm -f /tmp/eva360-crontab.tmp
echo ""

# ── Paso 3: logrotate ─────────────────────────────────────────────────
echo "[3/5] Configurando logrotate para ${LOG_FILE}…"
cat > /etc/logrotate.d/eva360-backup <<EOF
${LOG_FILE} {
    weekly
    rotate 12
    compress
    missingok
    notifempty
    copytruncate
}
EOF
green "  ✓ logrotate configurado (12 semanas de retención, rotación semanal)"
echo ""

# ── Paso 4: primera corrida ───────────────────────────────────────────
echo "[4/5] Ejecutando backup-daily.sh para validar setup…"
echo ""
if BACKUP_DIR="${BACKUP_DIR}" "${BACKUP_SCRIPT}"; then
  latest=$(ls -t "${BACKUP_DIR}"/eva360-*.dump 2>/dev/null | head -1)
  if [ -n "${latest}" ]; then
    size=$(du -h "${latest}" | cut -f1)
    green "  ✓ Primer backup exitoso: ${latest} (${size})"
  else
    red "  ✗ backup-daily.sh terminó OK pero no se encontró el archivo. Revisá manualmente."
    exit 1
  fi
else
  red "  ✗ Primer backup falló. Revisá los logs arriba."
  exit 1
fi
echo ""

# ── Paso 5: resumen ────────────────────────────────────────────────────
echo "[5/5] Resumen de instalación"
echo ""
green "✅ Backups automáticos configurados."
echo ""
echo "  Directorio:           ${BACKUP_DIR}"
echo "  Log:                  ${LOG_FILE}"
echo "  Cron schedule:        0 3 * * * (cada día a las 03:00 AM del VPS)"
echo "  Retención local:      30 días"
echo "  Rotación logs:        semanal, 12 semanas retención comprimida"
echo ""
echo "Próximos pasos recomendados:"
echo "  1. Off-site upload (B2/R2/S3): agregar BACKUP_S3_BUCKET + AWS creds al .env"
echo "  2. Test de restore mensual: ./scripts/verify-backup.sh"
echo "  3. Monitoreo: agregar el contenido de ${LOG_FILE} a tu observability stack"
echo ""
echo "Para ver los backups actuales:"
echo "  ls -lh ${BACKUP_DIR}/"
echo ""
echo "Para restaurar en caso de disaster:"
echo "  ./scripts/backup-restore.sh ${BACKUP_DIR}/eva360-YYYY-MM-DD_HH-MM.dump"
echo ""
