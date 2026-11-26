#!/usr/bin/env bash
# Respaldo del código de AI Crypto Investor (sin node_modules, .venv,
# .git ni cachés). Uso: ./scripts/backup-code.sh [destino]
# Por defecto crea ~/workspace/ai-crypto-investor-backup-YYYY-MM-DD.tar.gz
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATE="${1:-$(date +%F)}"
DEST="${2:-$HOME/workspace/ai-crypto-investor-backup-$DATE.tar.gz}"
# Las exclusiones usan el nombre del checkout (en un worktree es
# ai-crypto-investor-mejoras-v1, no ai-crypto-investor): con el nombre
# fijo, el respaldo del worktree incluía frontend/node_modules (~500 MB).
BASE="$(basename "$ROOT")"

tar \
  --exclude="$BASE/frontend/node_modules" \
  --exclude="$BASE/backend/.venv" \
  --exclude="$BASE/.git" \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  -czf "$DEST" -C "$(dirname "$ROOT")" "$BASE"

# 2026-11-09: un respaldo que no se verifica es solo un archivo con
# buen nombre: si el tarball sale corrupto (disco lleno, corte a mitad
# de escritura) el fallo debe verse AHORA, no el día que haga falta
# restaurar. Se lista el contenido y, si falla, se borra el archivo
# corrupto para que nadie lo confunda con un respaldo válido.
if ! tar -tzf "$DEST" >/dev/null; then
  echo "Respaldo CORRUPTO (verificación falló): $DEST" >&2
  rm -f "$DEST"
  exit 1
fi

echo "Respaldo creado y verificado: $DEST"
