# IMPLEMENTED vs PENDING — AI Crypto Investor

## IMPLEMENTED (Phase 1)
- Repo structure: `backend/` (FastAPI), `frontend/` (Next.js), `docs/`, `deploy/`
- Config via env only (`.env.example`, no secrets); `pydantic-settings`
- 13 SQLAlchemy tables (12 spec tables + `idempotency_keys` infra table); UTC times, Numeric money
- Alembic set up; initial migration `fb071ea13a34` applied clean on SQLite
- Auth: bcrypt password hashing + JWT bearer; admin seeded from env
- API skeleton (all behind auth except `/api/health`):
  system status · balances (DEMO) · performance (DEMO) · signals (DEMO) ·
  strategies · scanner start/stop · simulation modes (real → 403) ·
  operations read · `/api/orders` stub (501, requires Idempotency-Key) ·
  risk limits · kill switch (idempotent) · logs
- Pure risk-math functions (`core/risk_math.py`): 1%-of-equity sizing,
  stop-distance position size, round-trip-cost ≤30%-of-target check,
  daily-loss-cap check, max-trades-per-day check — unit tested
- Idempotency-Key contract on state-changing endpoints — tested
- Dashboard skeleton (Next.js): login, system/equity/P&L/signals/risk/scanner/
  operations/logs panels, DEMO badges, offline banner, risk disclaimer footer
- Docker Compose (backend + frontend; Postgres optional commented block)
- Cloud deploy config skeleton (`deploy/cloud/`)
- Tests: 16 pytest tests pass (auth, idempotency, risk math)
- Docs: engine decision (custom, Freqtrade rejected on GPL-3.0), licenses,
  risk disclaimer

## IMPLEMENTED (Phase 2 — market data + indicators)
- `ccxt` (Kraken/Coinbase public data) with env-specific compat shims
  (`app/data/_compat.py`): requests-timeout tuple fix, egress-proxy CA bundle,
  explicit proxy dict
- OHLCV ingestion with dialect-aware upserts (`app/data/ingest.py`)
- Hand-rolled indicators, pure functions, no lookahead
  (`app/indicators/technical.py`): SMA, EMA, RSI (Wilder), MACD, volatility,
  volume-SMA
- Endpoints: `/api/market/candles|ticker|indicators`, `POST /api/market/ingest`
  — all carry source + timestamp; 503 when unavailable (never fake data)
- Tests: 30 pytest tests pass (Phase 2 total)

## IMPLEMENTED (Phase 3 — strategy + risk + signals)
- Trend+momentum engine (`app/strategy/engine.py`), long/flat spot only,
  closed candles only: buy when close>sma20>sma50, RSI<70, MACD hist>0;
  sell on mirrored breakdown; ±2% target, ∓1% stop
- Server-side risk guard (`app/risk/guard.py`): kill switch, max 3 trades/day,
  $0.40 daily loss cap, duplicate prevention, stop-distance sizing,
  round-trip-cost check, balance check; Signal + RiskDecision rows persisted
  (rejections logged too)
- `POST /api/strategy/evaluate` wired into scanner loop
- Tests: 42 pytest tests pass (Phase 3 total)

## IMPLEMENTED (Phase 4 — backtest + paper trading)
- Event-driven backtest (`app/backtest/engine.py`): no lookahead, fees +
  slippage both sides, stop/target/signal exits, train/val/test splits,
  buy-and-hold baseline, metrics (net return, max drawdown, Sharpe per-trade,
  win rate, expectancy), CSV export; honest result reported (-9.29% net,
  11 trades on 720 real Kraken candles)
- Continuous paper trading (`app/paper/trader.py`) in the scanner loop
- Endpoints: `POST /api/backtest/run`, `GET /api/backtest/runs`,
  `GET /api/backtest/runs/{id}/csv`
- Tests: 50 pytest tests pass (Phase 4 total)

## IMPLEMENTED (Phase 5 — read-only exchange connection)
- `ReadOnlyAdapter` (`app/exchange/adapter.py`): Kraken; exposes ONLY
  `fetch_balance`/`fetch_status` — no order methods by construction.
  Keys from env only, never DB; `ExchangeNotConfigured` when absent
- Config fields: `KRAKEN_API_KEY/SECRET`, `COINBASE_API_KEY/SECRET`
- Endpoints: `GET /api/exchange/status`, `GET /api/exchange/balances`,
  `POST /api/exchange/connections` (metadata registration only — secrets
  never accepted)
- Docs: `docs/exchange-setup.md` (read-only key creation, IP whitelist,
  key-rotation procedure)
- **Live verification with the user's read-only keys: PENDING (needs keys)**
- Tests: 56 pytest tests pass (Phase 5 total)

## IMPLEMENTED (Phase 6 — test orders + error handling)
- Execution engine (`app/execution/engine.py`): order lifecycle
  pending → approved → sent → executed | partial | cancelled | failed;
  idempotent `client_order_id`; state re-check before retry (no duplicates);
  partial-fill aggregation; 0.1% fee per fill
- Modes: simulation/paper fill instantly at market; sandbox via ccxt sandbox
  mode (needs keys, retries 3× with backoff); real raises (disabled)
- `POST /api/orders` graduated from 501: requires Idempotency-Key,
  runs the server-side risk guard, executes per mode; `mode=real` → 403
- Tests: 62 pytest tests pass (Phase 6 total)

## IMPLEMENTED (Phase 7 — security, monitoring, alerts, cloud deploy)
- Rate limiting on `/api/auth/login` (10/min per IP, in-memory)
- Security headers middleware (nosniff, DENY framing, no-referrer,
  Permissions-Policy, HSTS); request metrics middleware +
  `GET /api/system/metrics`
- Audit trail: kill switch, simulation-mode change, scanner start/stop all
  write AuditLog rows
- Email alerts (`app/alerts/email.py`, SMTP via stdlib; logged, never crash,
  when unconfigured) — kill switch triggers an alert
- Cloud deploy config: `deploy/cloud/docker-compose.prod.yml`
  (Caddy + automatic Let's Encrypt HTTPS, Postgres 16, Redis),
  `Caddyfile`, completed HTTPS checklist + key-rotation procedure in
  `deploy/cloud/README.md`. **Never deployed — config only.**
- Tests: 69 pytest tests pass (Phase 7 total)

## IMPLEMENTED (AI assistant — technical, read-only, learning)
- `backend/app/ai/`: `assistant.py` (read-only tool registry: get_signals,
  get_indicators, get_backtest_summary, get_risk_state — no order/risk/config
  tools exist by construction), `guardrails.py` (system-prompt anchoring
  re-asserted every turn, ES+EN prompt-injection detection, output validation
  blocking false order/risk claims, Spanish refusals, AuditLog writes),
  `learning.py` (explanation logging per signal, win/loss resolution vs the
  signal's own invalidation, calibration buckets with miscalibration flags,
  `ai_lessons` store, Spanish review summary), `models.py` (swappable
  interface: local `StubModel` default labeled DEMO; OpenAI-compatible
  provider via `AI_PROVIDER`/`AI_API_URL`/`AI_API_KEY`/`AI_MODEL` env only —
  keys never reach the frontend or logs)
- Tables `ai_explanations` + `ai_lessons` (Alembic `a3f19c2e7b41`)
- Endpoints: `POST /api/ai/ask` (auth, 20/min rate limit, audited),
  `GET /api/ai/lessons` (runs learning cycle + returns Spanish summary and
  calibration), `GET /api/ai/status` (provider/demo, never keys)
- Frontend: "Asistente IA" panel (Spanish UI) with DEMO badge when the stub
  model is active; lessons + calibration display
- Honest uncertainty: expressed confidence is audited against out-of-sample
  outcomes; the assistant never presents a backtest as proof of profitability
- Tests: 92 pytest tests pass (69 existing + 23 new); frontend `npm run build`
  clean; real trading still hard-disabled (Phase 8 untouched)

## PENDING
- **Phase 5 live check**: verify `GET /api/exchange/balances` with the user's
  read-only Kraken keys (keys not yet provided)
- **Phase 6 live check**: sandbox test order once sandbox keys exist
- **Phase 7 live check**: `docker compose config` (no Docker daemon in the
  build sandbox — YAML validated, full compose check deferred to a host
  with Docker); actual deploy needs the user's explicit go-ahead
- **Phase 8 (NEVER without criteria)**: real trading — requires 30d paper trading
  with net-positive expectancy, acceptable drawdown, all tests green, AND the
  user's explicit written confirmation. Currently hard-disabled (403 stub).
