#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
# backup-restore.sh — Restaurar un backup de Eva360
# ══════════════════════════════════════════════════════════════════════
#
# Uso:
#   ./scripts/backup-restore.sh /root/eva360-backups/eva360-2026-04-11_03-00.dump
#
# Lo que hace:
#   1. Confirmacion interactiva (pide escribir "CONFIRMAR" literal)
#   2. Crea un backup de seguridad del estado ACTUAL antes de restaurar
#   3. pg_restore del archivo .dump con --clean --if-exists
#   4. Log de exito/fallo
#
# IMPORTANTE: Este script BORRA y REESCRIBE la base de datos. Usarlo solo
# para disaster recovery real o para probar un backup en staging.
#
# ══════════════════════════════════════════════════════════════════════

set -euo pipefail

BACKUP_FILE="${1:-}"
CONTAINER_NAME="${CONTAINER_NAME:-eva360_db}"
BACKUP_DIR="${BACKUP_DIR:-/root/eva360-backups}"

if [ -z "${BACKUP_FILE}" ]; then
  echo "Uso: $0 <ruta/al/backup.dump>"
  echo ""
  echo "Backups disponibles en ${BACKUP_DIR}:"
  ls -lh "${BACKUP_DIR}"/eva360-*.dump 2>/dev/null || echo "  (ninguno)"
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "ERROR: El archivo no existe: ${BACKUP_FILE}" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "ERROR: Container '${CONTAINER_NAME}' no esta corriendo" >&2
  exit 1
fi

echo ""
echo "==========================================================="
echo "  ATENCION: Esta operacion va a REEMPLAZAR toda la BD"
echo "==========================================================="
echo ""
echo "  Archivo a restaurar: ${BACKUP_FILE}"
echo "  Container: ${CONTAINER_NAME}"
echo ""
echo "  Se creara un backup de seguridad del estado actual antes"
echo "  de empezar el restore, en caso de que necesites volver."
echo ""
read -p "  Para continuar escribe exactamente 'CONFIRMAR': " answer

if [ "${answer}" != "CONFIRMAR" ]; then
  echo "Cancelado."
  exit 0
fi

# ── 1) Backup de seguridad del estado actual ──────────────────────────
echo ""
echo "[1/2] Creando backup de seguridad del estado actual..."
safety_backup="${BACKUP_DIR}/pre-restore-$(date +%Y-%m-%d_%H-%M).dump"
mkdir -p "${BACKUP_DIR}"
# IMPORTANTE: pg_dump como `postgres` superuser, NO `$POSTGRES_USER`. Las
# tablas con RLS + FORCE (F4 Fase B/C) se aplican al owner — pg_dump como
# eva360 sin GUC exporta 0 filas. Superuser tiene BYPASSRLS automatico.
docker exec -t "${CONTAINER_NAME}" sh -c \
  'pg_dump -U postgres -d "$POSTGRES_DB" -F c -Z 9' > "${safety_backup}"
echo "  Safety backup guardado en: ${safety_backup}"

# ── 2) pg_restore ─────────────────────────────────────────────────────
echo ""
echo "[2/2] Restaurando ${BACKUP_FILE}..."
# pg_restore como postgres superuser por la misma razon: los INSERTs a
# tablas con FORCE RLS fallan via WITH CHECK si el role no es superuser
# y no hay GUC seteado. Postgres bypassea automatico.
# NO usar --no-owner: necesitamos que las tablas queden owned por
# `eva360` (no `postgres`) para que cleanup-orphans.ts pueda hacer
# ALTER TABLE / CREATE TABLE al startup del API. pg_restore como
# superuser tiene permiso para ejecutar las ALTER OWNER del dump.
if docker exec -i "${CONTAINER_NAME}" sh -c \
    'pg_restore -U postgres -d "$POSTGRES_DB" --clean --if-exists' < "${BACKUP_FILE}"; then
  echo ""
  echo "✔ Restore completado exitosamente."
  echo "  Si el sistema no funciona, puedes volver atras con:"
  echo "    $0 ${safety_backup}"
else
  echo ""
  echo "✖ pg_restore fallo. Intenta revertir con:"
  echo "    $0 ${safety_backup}"
  exit 1
fi
