#!/usr/bin/env bash
# Verificación diaria de AI Crypto Investor: backend (pytest) + frontend
# (typecheck + build). Uso: ./scripts/verify-daily.sh
# No publica ni despliega nada; solo verifica. Falla (exit != 0) si
# alguna de las dos verificaciones falla, para que el cambio del día se
# revierta en vez de quedar a medias.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== backend: pytest =="
(cd "$ROOT/backend" && .venv/bin/python -m pytest tests -q)

echo "== frontend: typecheck + build =="
(cd "$ROOT/frontend" && npm run check)

echo "Verificación diaria OK."
