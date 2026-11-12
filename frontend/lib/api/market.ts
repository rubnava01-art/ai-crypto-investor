// Dominio mercado (velas/ticker/indicadores) del API — Clases 2026-11-10.
// Patrón marketPrices (system.ts): auth + retry + AbortSignal del llamador.
// Un 503 del backend significa "sin datos" (sin velas, o menos de 35 para
// indicadores): se propaga como ApiError 503 y la UI lo muestra como
// "sin datos", nunca con un precio o una gráfica inventados.
import { ApiError, request } from "./client";
import type {
  MarketCandle,
  MarketCandleRaw,
  MarketCandlesResponse,
  MarketIndicatorsResponse,
  MarketTickerResponse,
} from "./types";

interface CandlesRawResponse {
  symbol: string;
  timeframe: string;
  source: string;
  updated_utc: string;
  stale: boolean;
  newest_candle_utc: string;
  candles: MarketCandleRaw[];
}

interface TickerRawResponse {
  symbol: string;
  last: string | null;
  source: string;
  updated_utc: string;
  stale: boolean;
}

/** True si el error es un 503 "sin datos" del backend. */
export function isMarketNoData(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Parsea las velas del backend (OHLCV en cadenas) a número.
 * Una vela con open/high/low/close no numérico se descarta entera: nunca
 * se grafica un valor inventado. Un volumen no numérico se trata como 0
 * (el volumen no se grafica en v1). */
export function parseMarketCandles(raw: CandlesRawResponse): MarketCandlesResponse {
  const candles: MarketCandle[] = [];
  for (const c of raw.candles ?? []) {
    const open = toNumber(c.open);
    const high = toNumber(c.high);
    const low = toNumber(c.low);
    const close = toNumber(c.close);
    if (open === null || high === null || low === null || close === null) continue;
    candles.push({
      openTimeUtc: c.open_time_utc,
      open,
      high,
      low,
      close,
      volume: toNumber(c.volume) ?? 0,
    });
  }
  return {
    symbol: raw.symbol,
    timeframe: raw.timeframe,
    source: raw.source,
    updated_utc: raw.updated_utc,
    stale: raw.stale,
    newest_candle_utc: raw.newest_candle_utc,
    candles,
  };
}

export const marketApi = {
  marketCandles: async (
    symbol = "BTC/USD",
    timeframe = "1h",
    limit = 100,
    opts?: { signal?: AbortSignal },
  ): Promise<MarketCandlesResponse> => {
    const raw = await request<CandlesRawResponse>(
      `/api/market/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`,
      { auth: true, retry: true, signal: opts?.signal },
    );
    return parseMarketCandles(raw);
  },
  marketTicker: async (
    symbol = "BTC/USD",
    opts?: { signal?: AbortSignal },
  ): Promise<MarketTickerResponse> => {
    const raw = await request<TickerRawResponse>(
      `/api/market/ticker?symbol=${encodeURIComponent(symbol)}`,
      { auth: true, retry: true, signal: opts?.signal },
    );
    return {
      symbol: raw.symbol,
      last: toNumber(raw.last),
      source: raw.source,
      updated_utc: raw.updated_utc,
      stale: raw.stale,
    };
  },
  marketIndicators: (
    symbol = "BTC/USD",
    timeframe = "1h",
    opts?: { signal?: AbortSignal },
  ): Promise<MarketIndicatorsResponse> =>
    request<MarketIndicatorsResponse>(
      `/api/market/indicators?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`,
      { auth: true, retry: true, signal: opts?.signal },
    ),
};
