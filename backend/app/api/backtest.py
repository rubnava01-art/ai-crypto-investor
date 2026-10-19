"""Backtest endpoints (Phase 4)."""
import datetime as dt
import json
import os

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.backtest.engine import (
    BacktestConfig,
    run_backtest,
    split_train_val_test,
)
from app.core.security import get_current_user
from app.data import ingest
from app.database import get_db
from app.models.tables import User

router = APIRouter(prefix="/api/backtest", tags=["backtest"])

RUNS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "data", "backtests")


class BacktestRunResponse(BaseModel):
    run_id: str
    symbol: str
    timeframe: str
    n_candles: int
    splits: dict
    metrics: dict
    metrics_by_split: dict
    strategy: dict


def _save_run(run_id: str, payload: dict, csv_text: str) -> None:
    os.makedirs(RUNS_DIR, exist_ok=True)
    with open(os.path.join(RUNS_DIR, f"{run_id}.json"), "w") as f:
        json.dump(payload, f, indent=2, default=str)
    with open(os.path.join(RUNS_DIR, f"{run_id}.csv"), "w") as f:
        f.write(csv_text)


@router.post("/run", response_model=BacktestRunResponse)
def run(
    symbol: str = Query("BTC/USD"),
    timeframe: str = Query("1h"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    candles = ingest.latest_candles(db, symbol, timeframe, 2000)
    if len(candles) < 100:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Need >= 100 candles for backtest, have {len(candles)}.",
        )
    closes = [float(c.close) for c in candles]
    config = BacktestConfig(symbol=symbol, timeframe=timeframe)
    n = len(closes)

    # Per-split evaluation (train/val/test) + full run
    splits = {}
    metrics_by_split = {}
    for name, (a, b) in zip(
        ("train", "val", "test"), split_train_val_test(n, config.train_pct, config.val_pct)
    ):
        seg = closes[a:b]
        splits[name] = {"from": a, "to": b, "n": len(seg)}
        if len(seg) >= 80:
            r = run_backtest(seg, config)
            metrics_by_split[name] = r.metrics
        else:
            metrics_by_split[name] = {"error": "not enough candles in split"}

    full = run_backtest(closes, config)
    run_id = f"{symbol.replace('/', '')}-{timeframe}-{dt.datetime.now(dt.timezone.utc):%Y%m%d%H%M%S}"
    payload = {
        "run_id": run_id,
        "symbol": symbol,
        "timeframe": timeframe,
        "n_candles": n,
        "splits": splits,
        "metrics": full.metrics,
        "metrics_by_split": metrics_by_split,
        "strategy": {
            "name": config.strategy_name,
            "version": config.strategy_version,
            "config": {"fee_rate": str(config.fee_rate), "slippage_rate": str(config.slippage_rate),
                       "risk_pct": str(config.risk_pct), "train_pct": config.train_pct,
                       "val_pct": config.val_pct},
        },
    }
    _save_run(run_id, payload, full.to_csv())
    return BacktestRunResponse(**payload)


@router.get("/runs")
def list_runs(user: User = Depends(get_current_user)):
    if not os.path.isdir(RUNS_DIR):
        return []
    return sorted(f[:-5] for f in os.listdir(RUNS_DIR) if f.endswith(".json"))


@router.get("/runs/{run_id}/csv", response_class=PlainTextResponse)
def run_csv(run_id: str, user: User = Depends(get_current_user)):
    path = os.path.join(RUNS_DIR, f"{run_id}.csv")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="run not found")
    return PlainTextResponse(open(path).read(), media_type="text/csv")
