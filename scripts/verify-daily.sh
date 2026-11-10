#!/usr/bin/env bash
# Verificación diaria de AI Crypto Investor: backend (pytest) + frontend
# (typecheck + build). Uso: ./scripts/verify-daily.sh
# No publica ni despliega nada; solo verifica. Falla (exit != 0) si
# alguna de las dos verificaciones falla, para que el cambio del día se
# revierta en vez de quedar a medias.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 2026-11-06: errores de espacios en blanco (trailing whitespace,
# tabs) del cambio del día, antes de correr la suite: un diff sucio
# con esos errores no debería llegar al commit.
echo "== git: diff --check =="
(cd "$ROOT" && git diff --check && git diff --cached --check)

# 2026-11-07: paridad ES/EN de los diccionarios i18n. Las secciones
# Record<string,string> no las verifica tsc: una clave ausente se
# renderiza como `undefined` sin fallar el build.
echo "== i18n: paridad es/en =="
(cd "$ROOT" && node --no-warnings scripts/check-i18n-parity.mjs)

echo "== backend: pytest =="
(cd "$ROOT/backend" && .venv/bin/python -m pytest tests -q)

echo "== frontend: typecheck + build =="
(cd "$ROOT/frontend" && npm run check)

echo "Verificación diaria OK."
