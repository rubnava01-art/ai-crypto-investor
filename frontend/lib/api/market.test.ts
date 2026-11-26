// Corrección P0-1 (2026-11-23, mejoras óptimas): las lecturas de mercado
// eligen la base según el perfil — invitado → /api/public/market/*,
// resto → /api/market/*. El perfil viene de /api/acceso/perfil
// (memoizado 60 s, se vacía entre casos) y, si el perfil falla, del
// flag local de invitado (mismo fallback que ModuleNav). El fetch se
// stubbea: aquí solo se verifica QUÉ ruta se pide, no los datos.
import test from "node:test";
import assert from "node:assert/strict";
import { marketApi } from "./market";
import { systemApi } from "./system";
import { catalogMemo } from "./memo";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const perfil = (role: string) => ({
  role,
  is_admin: false,
  es_cliente_vinculado: false,
  contacto_id: null,
  modulos:
    role === "invitado"
      ? ["inicio", "estudiar", "planes", "asistente"]
      : ["inicio", "estudiar"],
});

const tickerRaw = {
  symbol: "BTC/USD",
  last: "60000",
  source: "kraken",
  updated_utc: "2026-11-23T00:00:00Z",
  stale: false,
};
const candlesRaw = {
  symbol: "BTC/USD",
  timeframe: "1h",
  source: "kraken",
  updated_utc: "2026-11-23T00:00:00Z",
  stale: false,
  newest_candle_utc: "2026-11-23T00:00:00Z",
  candles: [
    {
      open_time_utc: "2026-11-22T23:00:00Z",
      open: "59000",
      high: "60100",
      low: "58900",
      close: "60000",
      volume: "1.5",
    },
  ],
};
const indicatorsRaw = {
  symbol: "BTC/USD",
  timeframe: "1h",
  source: "kraken",
  updated_utc: "2026-11-23T00:00:00Z",
  stale: false,
  newest_candle_utc: "2026-11-23T00:00:00Z",
  indicators: {
    rsi_14: 55,
    sma_20: 59000,
    sma_50: 58000,
    ema_20: 59500,
    macd: { macd_line: 10, signal_line: 8, histogram: 2 },
    volatility_20: 0.02,
  },
};
const pricesRaw = {
  source: "kraken",
  updated_utc: "2026-11-23T00:00:00Z",
  stale: false,
  prices: [],
};

type PerfilMode = "invitado" | "prueba" | "falla";

/** Stubbea el fetch global y registra cada URL pedida. */
function stubFetch(urls: string[], perfilMode: PerfilMode) {
  const prev = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/api/acceso/perfil")) {
      if (perfilMode === "falla") return json({ detail: "error" }, 500);
      return json(perfil(perfilMode));
    }
    if (url.includes("/market/ticker")) return json(tickerRaw);
    if (url.includes("/market/candles")) return json(candlesRaw);
    if (url.includes("/market/indicators")) return json(indicatorsRaw);
    if (url.includes("/market/prices")) return json(pricesRaw);
    return json({ detail: "not found" }, 404);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = prev;
  };
}

/** Marca la sesión como invitado vía el flag local (`aci_guest=1`). */
function stubGuestWindow() {
  const prev = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (k: string) => (k === "aci_guest" ? "1" : null),
      setItem: () => {},
      removeItem: () => {},
    },
  };
  return () => {
    if (prev === undefined) delete (globalThis as Record<string, unknown>).window;
    else (globalThis as Record<string, unknown>).window = prev;
  };
}

async function callAllMarket() {
  await marketApi.marketTicker("BTC/USD");
  await marketApi.marketCandles("BTC/USD", "1h", 100);
  await marketApi.marketIndicators("BTC/USD", "1h");
  await systemApi.marketPrices();
}

test("P0-1: perfil invitado → las 4 lecturas usan /api/public/market/*", async () => {
  catalogMemo.clear();
  const urls: string[] = [];
  const restore = stubFetch(urls, "invitado");
  try {
    await callAllMarket();
  } finally {
    restore();
  }
  for (const end of ["ticker", "candles", "indicators", "prices"]) {
    assert.ok(
      urls.some((u) => u.includes(`/api/public/market/${end}`)),
      `falta /api/public/market/${end} en ${urls.join(", ")}`,
    );
    assert.ok(
      !urls.some((u) => u.includes(`/api/market/${end}`)),
      `no debe pedir /api/market/${end}: ${urls.join(", ")}`,
    );
  }
});

test("P0-1: perfil no invitado → las 4 lecturas siguen en /api/market/*", async () => {
  catalogMemo.clear();
  const urls: string[] = [];
  const restore = stubFetch(urls, "prueba");
  try {
    await callAllMarket();
  } finally {
    restore();
  }
  for (const end of ["ticker", "candles", "indicators", "prices"]) {
    assert.ok(
      urls.some((u) => u.includes(`/api/market/${end}`)),
      `falta /api/market/${end} en ${urls.join(", ")}`,
    );
    assert.ok(
      !urls.some((u) => u.includes(`/api/public/market/${end}`)),
      `no debe pedir /api/public/market/${end}: ${urls.join(", ")}`,
    );
  }
});

test("P0-1: perfil falla + flag invitado → usa /api/public/market/*", async () => {
  catalogMemo.clear();
  const urls: string[] = [];
  const restoreFetch = stubFetch(urls, "falla");
  const restoreWindow = stubGuestWindow();
  try {
    await marketApi.marketTicker("BTC/USD");
  } finally {
    restoreFetch();
    restoreWindow();
  }
  assert.ok(urls.some((u) => u.includes("/api/public/market/ticker")));
  assert.ok(!urls.some((u) => u.includes("/api/market/ticker")));
});

test("P0-1: perfil falla + sin flag invitado → usa /api/market/*", async () => {
  catalogMemo.clear();
  const urls: string[] = [];
  const restore = stubFetch(urls, "falla");
  try {
    await marketApi.marketTicker("BTC/USD");
  } finally {
    restore();
  }
  assert.ok(urls.some((u) => u.includes("/api/market/ticker")));
  assert.ok(!urls.some((u) => u.includes("/api/public/market/ticker")));
});

test("Entrada rápida 2026-11-24: flag invitado → base pública SIN pedir /api/acceso/perfil", async () => {
  catalogMemo.clear();
  const urls: string[] = [];
  const restoreFetch = stubFetch(urls, "prueba");
  const restoreWindow = stubGuestWindow();
  try {
    await marketApi.marketTicker("BTC/USD");
  } finally {
    restoreFetch();
    restoreWindow();
  }
  assert.ok(urls.some((u) => u.includes("/api/public/market/ticker")));
  assert.ok(!urls.some((u) => u.includes("/api/market/ticker")));
  assert.ok(
    !urls.some((u) => u.includes("/api/acceso/perfil")),
    `la vía rápida no debe pedir el perfil: ${urls.join(", ")}`,
  );
});

test("displaySourceName: la fuente del precio se muestra con nombre (Fase 5a, tarea 1)", async () => {
  const { displaySourceName } = await import("./market");
  assert.equal(displaySourceName("kraken"), "Kraken");
  assert.equal(displaySourceName("coinbase"), "Coinbase");
  // Fuente desconocida: capitalizada, sin inventar un nombre.
  assert.equal(displaySourceName("otro"), "Otro");
});
