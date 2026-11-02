#!/usr/bin/env bash
# Respaldo del código de AI Crypto Investor (sin node_modules, .venv,
# .git ni cachés). Uso: ./scripts/backup-code.sh [destino]
# Por defecto crea ~/workspace/ai-crypto-investor-backup-YYYY-MM-DD.tar.gz
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATE="${1:-$(date +%F)}"
DEST="${2:-$HOME/workspace/ai-crypto-investor-backup-$DATE.tar.gz}"

tar \
  --exclude='ai-crypto-investor/frontend/node_modules' \
  --exclude='ai-crypto-investor/backend/.venv' \
  --exclude='ai-crypto-investor/.git' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  -czf "$DEST" -C "$(dirname "$ROOT")" "$(basename "$ROOT")"

echo "Respaldo creado: $DEST"
