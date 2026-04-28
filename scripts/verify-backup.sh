#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
# verify-backup.sh — Valida que los backups están sanos
# ══════════════════════════════════════════════════════════════════════
#
# Uso:
#   ./scripts/verify-backup.sh              # quick check (local)
#   ./scripts/verify-backup.sh --restore    # restore test en DB temp (completo)
#
# Qué chequea (modo quick):
#   1. Existe al menos un backup en los últimos 24h
#   2. El archivo más reciente es > 1KB (no corrupto)
#   3. `pg_restore --list` no devuelve error (magic bytes OK)
#
# Qué chequea (modo --restore):
#   Todo lo anterior + restaurar en una DB temporal dentro del mismo
#   container y correr 1 query de sanity (COUNT tenants, users). No
#   afecta la DB de producción.
#
# Exit codes:
#   0 = todo OK
#   1 = backup faltante, corrupto, o restore fallido
#
# ══════════════════════════════════════════════════════════════════════

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/root/eva360-backups}"
CONTAINER_NAME="${CONTAINER_NAME:-eva360_db}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"  # 26h para dar margen a deploys cron
MODE="${1:-quick}"

# ── Helpers ───────────────────────────────────────────────────────────
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*" >&2; }

# ── Paso 1: existe al menos un backup en BACKUP_DIR ───────────────────
if [ ! -d "${BACKUP_DIR}" ]; then
  red "✗ Directorio no existe: ${BACKUP_DIR}"
  exit 1
fi

latest=$(ls -t "${BACKUP_DIR}"/eva360-*.dump 2>/dev/null | head -1 || true)
if [ -z "${latest}" ]; then
  red "✗ No hay backups en ${BACKUP_DIR}/"
  exit 1
fi

green "✓ Backup más reciente: ${latest}"

# ── Paso 2: antigüedad dentro de límite ───────────────────────────────
age_seconds=$(( $(date +%s) - $(stat -c%Y "${latest}" 2>/dev/null || stat -f%m "${latest}") ))
age_hours=$(( age_seconds / 3600 ))

if [ "${age_hours}" -gt "${MAX_AGE_HOURS}" ]; then
  red "✗ Backup viejo: ${age_hours}h (máximo tolerado: ${MAX_AGE_HOURS}h)."
  red "   Revisá si el cron está corriendo: crontab -l | grep backup"
  exit 1
fi
green "✓ Antigüedad: ${age_hours}h (OK, máximo tolerado ${MAX_AGE_HOURS}h)"

# ── Paso 3: tamaño no sospechoso ──────────────────────────────────────
size_bytes=$(stat -c%s "${latest}" 2>/dev/null || stat -f%z "${latest}")
if [ "${size_bytes}" -lt 1024 ]; then
  red "✗ Backup sospechosamente chico: ${size_bytes} bytes"
  exit 1
fi
size_human=$(du -h "${latest}" | cut -f1)
green "✓ Tamaño: ${size_human}"

# ── Paso 4: header pg_restore válido ──────────────────────────────────
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  red "✗ Container '${CONTAINER_NAME}' no está corriendo."
  exit 1
fi

# pg_restore --list lee el header. Si está corrupto, error. No modifica nada.
if ! docker exec -i "${CONTAINER_NAME}" pg_restore --list > /dev/null < "${latest}" 2>&1; then
  red "✗ pg_restore --list falló: header corrupto o archivo no-válido."
  exit 1
fi
green "✓ Header pg_restore OK (archivo es un dump válido)"

# ── Modo quick termina acá ────────────────────────────────────────────
if [ "${MODE}" != "--restore" ]; then
  echo ""
  green "✅ Verificación rápida: OK"
  echo ""
  echo "Para validación completa con restore test (más lento, no afecta prod):"
  echo "  $0 --restore"
  exit 0
fi

# ── Paso 5 (solo --restore): restore a DB temporal ────────────────────
echo ""
yellow "Modo --restore: restaurando a DB temporal para validación completa…"

TMP_DB="eva360_verify_$(date +%s)"
echo "  DB temporal: ${TMP_DB}"

# IMPORTANTE: usamos `postgres` superuser para createdb/pg_restore/psql
# en la BD temporal. Si Fase B/C de F4 RLS esta activa, el dump incluye
# ALTER TABLE FORCE ROW LEVEL SECURITY — al restaurar como eva360
# (owner), los INSERTs fallan por WITH CHECK. Postgres superuser tiene
# BYPASSRLS automatico.
docker exec -T "${CONTAINER_NAME}" sh -c \
  "createdb -U postgres ${TMP_DB}" || {
    red "✗ No se pudo crear DB temporal"
    exit 1
  }

# Cleanup en cualquier salida
cleanup() {
  docker exec -T "${CONTAINER_NAME}" sh -c \
    "dropdb -U postgres --if-exists ${TMP_DB}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Restore — postgres superuser para bypass RLS (ver nota arriba)
if docker exec -i "${CONTAINER_NAME}" sh -c \
    "pg_restore -U postgres -d ${TMP_DB} --no-owner" < "${latest}" 2>/dev/null; then
  green "  ✓ Restore en DB temporal OK"
else
  red "  ✗ Restore falló"
  exit 1
fi

# Sanity queries — chequeo de count en 3 tablas representativas:
#   - `tenants` (sin tenant_id, NUNCA recibe RLS — debe tener > 0)
#   - `users` (recibe RLS en Fase C — debe tener > 0)
#   - `evaluation_responses` (PRIMERA tabla con RLS, F4 Fase B)
#
# Si `evaluation_responses` queda en 0 mientras tenants/users tienen
# data, indica que pg_dump fue ejecutado por un role no-superuser sin
# bypass de RLS — bug critico en backup-daily.sh. Ver F4-RLS-FASE-B-RUNBOOK.md
tenant_count=$(docker exec -T "${CONTAINER_NAME}" sh -c \
  "psql -U postgres -d ${TMP_DB} -tA -c 'SELECT COUNT(*) FROM tenants'")
user_count=$(docker exec -T "${CONTAINER_NAME}" sh -c \
  "psql -U postgres -d ${TMP_DB} -tA -c 'SELECT COUNT(*) FROM users'")
# evaluation_responses puede legitimamente tener 0 filas en BD virgen;
# solo gritamos si las OTRAS tablas tienen data Y eval_responses esta vacia.
eval_count=$(docker exec -T "${CONTAINER_NAME}" sh -c \
  "psql -U postgres -d ${TMP_DB} -tA -c 'SELECT COUNT(*) FROM evaluation_responses'" \
  2>/dev/null || echo "0")

echo "  Tenants:              ${tenant_count}"
echo "  Users:                ${user_count}"
echo "  Evaluation responses: ${eval_count}"

if [ "${tenant_count}" -lt 1 ] || [ "${user_count}" -lt 1 ]; then
  red "  ✗ Restore ejecutó pero data crítica está vacía — posible backup incompleto"
  exit 1
fi

# Detector de bug RLS en backup: si tenants > 0 y users > 0 pero
# evaluation_responses = 0, es muy probable que pg_dump corra como
# eva360 (owner) sobre tablas con FORCE RLS sin GUC seteado. El backup
# es silenciosamente incompleto.
if [ "${tenant_count}" -gt 0 ] && [ "${user_count}" -gt 5 ] && [ "${eval_count}" -lt 1 ]; then
  red "  ⚠ ALERTA: tenants=${tenant_count}, users=${user_count}, pero evaluation_responses=0."
  red "    Probable causa: pg_dump corre con role NO-superuser y RLS está activo (F4 Fase B/C)."
  red "    Fix: backup-daily.sh debe usar 'pg_dump -U postgres' (BYPASSRLS)."
  red "    Ver scripts/backup-daily.sh y docs/F4-RLS-FASE-B-RUNBOOK.md."
  exit 1
fi

green "  ✓ Sanity queries OK"
echo ""
green "✅ Verificación completa con restore: OK"
