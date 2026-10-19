# AI CRYPTO INVESTOR

Quantitative crypto trading platform (BTC/USD, ETH/USD) — $20 initial capital.
Phase 1: repository structure, configuration, and basic dashboard.

> **Risk warning:** trading crypto can lose the entire capital. Stop-loss orders
> do not guarantee execution price. Demo mode uses simulated data and money —
> nothing here represents real funds. See `docs/risk-disclaimer.md`.

## Status

Phases 1–7 complete. The app starts, serves a dashboard with clearly-labeled
DEMO data, ingests live Kraken/Coinbase market data, evaluates the
trend+momentum strategy with server-side risk enforcement, backtests and paper
trades, connects read-only to Kraken (keys via env), executes
simulation/paper/sandbox test orders, and ships security hardening + HTTPS
deploy config (see Phase 8 gate in `docs/IMPLEMENTED-vs-PENDING.md`).
Real trading is hard-disabled.

Live exchange connection needs the user's read-only Kraken keys (Phase 5 live
check pending).

## Quick start (development)

Requirements: Python 3.12+, Node 20+, Docker (optional).

```bash
# 1. Configure
cp .env.example .env
# Edit .env: set JWT_SECRET_KEY (min 32 random chars). For a real admin
# password, generate a bcrypt hash and set ADMIN_PASSWORD_HASH.

# 2. Backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
alembic upgrade head            # create tables (or auto-created on startup)
.venv/bin/uvicorn app.main:app --reload --port 8000
# API docs: http://localhost:8000/docs

# 3. Frontend (new terminal)
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
# Dashboard: http://localhost:3000  (login: admin / admin in dev)

# 4. Tests
cd backend && .venv/bin/python -m pytest tests/ -q
```

## Docker

```bash
cp .env.example .env   # then edit secrets
docker compose up --build
# API: http://localhost:8000 · Web: http://localhost:3000
```

## Configuration

All secrets via environment (`.env`, never committed). See `.env.example`
for the full list. Key rules:

- `JWT_SECRET_KEY` must be long and random in any shared environment.
- Exchange API keys are **not used before Phase 5**. When used: read-only,
  no-withdrawal permission, IP whitelist at the exchange, stored in a secrets
  manager (env is the minimum acceptable).
- `REAL_TRADING_ENABLED` stays `false` until Phase 8 criteria are met
  (30d paper trading net-positive, acceptable drawdown, all tests green,
  operator's written confirmation).

## API overview (Phase 1)

Public: `GET /api/health`. Everything else needs `Authorization: Bearer <JWT>`
from `POST /api/auth/login`.

| Endpoint | Purpose |
|---|---|
| `GET /api/system/status` | mode, exchange/scanner/sim state, kill switch |
| `GET /api/portfolio/balances` | equity/available (DEMO) |
| `GET /api/portfolio/performance` | P&L, drawdown, fees (DEMO) |
| `GET /api/signals` | signal list (DEMO) |
| `GET /api/strategies` | strategy versions |
| `POST /api/scanner/start|stop` | scanner flag |
| `GET/POST /api/simulation/modes|mode` | sim/paper (`real` → 403) |
| `GET /api/operations` | orders + trades (empty) |
| `POST /api/orders` | executes simulation/paper/sandbox; `mode=real` → **403**; requires `Idempotency-Key` |
| `GET /api/risk/limits` | risk limits |
| `POST /api/risk/kill-switch` | emergency stop (idempotent) |
| `GET /api/logs` | system events |
| `GET /api/ai/status` | AI model provider + demo flag (no keys) |
| `POST /api/ai/ask` | technical assistant Q&A (read-only, rate-limited, audited) |
| `GET /api/ai/lessons` | learned lessons + calibration summary (Spanish) |

State-changing endpoints accept an `Idempotency-Key` header: retries with the
same key replay the original response instead of re-executing.

## Database

SQLAlchemy models in `backend/app/models/tables.py` (15 tables: the 12 spec
tables + `idempotency_keys` + `ai_explanations` + `ai_lessons`). Migrations via Alembic (`backend/alembic/`).
SQLite in dev; Postgres in production (`DATABASE_URL`).

## Docs

- `docs/decisions/engine-choice.md` — Freqtrade vs custom engine (custom chosen)
- `docs/licenses.md` — all dependencies are MIT/Apache-2.0/BSD
- `docs/IMPLEMENTED-vs-PENDING.md` — what exists vs what each phase adds
- `docs/risk-disclaimer.md`

## Assumptions (declared)

1. Single operator, single worker in Phase 1 (runtime flags are in-memory).
2. $20 USD starting capital; spot only; no leverage (enforced from Phase 3).
3. Demo data is clearly labeled and never presented as real.
4. No exchange credentials exist yet; Phases 5–6 need them (read-only first).
5. A good backtest does not imply profitability — stated in docs and UI.
