# Licenses of reused components

All dependencies are permissive (MIT / Apache-2.0 / BSD). No copyleft
(GPL/AGPL) code is embedded in this project.

## Backend (Python)
| Package | License | Notes |
|---|---|---|
| FastAPI | MIT | API framework |
| Uvicorn | BSD-3-Clause | ASGI server |
| SQLAlchemy | MIT | ORM |
| Alembic | MIT | Migrations |
| Pydantic / pydantic-settings | MIT | Validation / config |
| python-jose | MIT | JWT |
| bcrypt | Apache-2.0 | Password hashing |
| pytest / httpx | MIT / BSD-3-Clause | Tests |

## Frontend (JS/TS)
| Package | License | Notes |
|---|---|---|
| Next.js | MIT | React framework |
| React / React-DOM | MIT | UI |
| Tailwind CSS | MIT | Styling |
| TypeScript | Apache-2.0 | Types |

## Planned for later phases (not yet installed)
| Package | License | Planned use |
|---|---|---|
| ccxt | MIT | Exchange market data + execution (client library) |
| ta | MIT | Technical indicators (or hand-rolled; decided in Phase 2) |
| pandas / numpy | BSD-3-Clause | Data frames for backtest |

## Explicitly NOT reused
- **Freqtrade (GPL-3.0)** — evaluated and rejected; see
  `docs/decisions/engine-choice.md`. Do not copy its code.
