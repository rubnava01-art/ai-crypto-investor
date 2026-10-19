# Engine decision: custom engine (not Freqtrade)

Date: 2026-10-19 · Phase 1 · Status: DECIDED

## Options evaluated

### A. Freqtrade (mature open-source bot framework)
Strengths:
- Battle-tested: backtesting, dry-run/paper trading, 20+ exchanges via CCXT,
  strategy optimization, Telegram + WebUI.
- Large community and strategy examples.

Blockers (why we reject embedding it):
1. **License: GPL-3.0** (verified via GitHub repo metadata, Oct 2026). Embedding
   Freqtrade as a library/service inside this platform would subject the whole
   platform to GPL-3.0 copyleft — incompatible with the goal of selling this
   product under our own terms. (Using it as a separate, unmodified process is
   legally distinct, but that defeats the integration goal.)
2. **Architecture mismatch.** The spec demands strict module separation —
   data → indicators → strategy → server-side risk → decoupled execution —
   plus exact risk semantics (1% risk/trade, $0.40 daily loss cap on $20,
   round-trip-cost vs target check, duplicate-order prevention, kill switch
   with no auto-resume). Freqtrade's risk model is config-driven and would need
   deep surgery; fighting the framework costs more than building the narrow
   engine the spec describes.
3. **API-first design.** Our dashboard, audit log, and strategy-versioning are
   first-class API resources. Bolting them onto Freqtrade's RPC/WebUI is
   awkward and fragile across upgrades.
4. **Indicator licensing inside Freqtrade**: its vendored `technical`/`qtpylib`
   indicators are GPLv3/Apache-2.0 mixed — another reason not to lift code from it.

### B. Custom engine on maintained MIT/Apache libraries (CHOSEN)
- **ccxt** (MIT) for exchange market data + (later) order execution. We use it
  as a client library only — no copyleft.
- **ta** or **pandas-ta** (both MIT) for RSI/MACD/moving averages, or hand-rolled
  numpy formulas where trivial. Final pick in Phase 2 after a tiny benchmark.
- **SQLAlchemy / FastAPI / Pydantic** (MIT), **Next.js / React / Tailwind** (MIT)
  for the platform itself.

We keep full control of the risk engine (the spec's core safety asset), own the
API contract, and keep the codebase licensable for sale.

## Decision
**Build the custom engine.** Reuse maintained MIT/Apache-2.0 libraries as
dependencies only. Do not copy Freqtrade code. Revisit only if requirements
change fundamentally (e.g., the product pivots to a Freqtrade-strategy
marketplace, which would be a separate GPL-compliant offering).
