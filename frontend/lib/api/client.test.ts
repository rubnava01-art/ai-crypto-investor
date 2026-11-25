// P3 (2026-11-17): errorDetail aplana el `detail` lista de un 422 de
// FastAPI a su primer `msg` legible, en vez de devolver el JSON entero.
import test from "node:test";
import assert from "node:assert/strict";
import { errorDetail } from "./client";

const res = (body: unknown, statusText = "Unprocessable Entity") =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 422,
    statusText,
    headers: { "Content-Type": "application/json" },
  });

test("errorDetail: detail string pasa tal cual", async () => {
  assert.equal(await errorDetail(res({ detail: "starts_at must be in the future" })), "starts_at must be in the future");
});

test("errorDetail: detail lista 422 se aplana a su primer msg", async () => {
  const body = {
    detail: [
      { loc: ["body", "starts_at"], msg: "Input should be a valid date", type: "date_type" },
      { loc: ["body", "duration_min"], msg: "Input should be greater than 0", type: "greater_than" },
    ],
  };
  assert.equal(await errorDetail(res(body)), "Input should be a valid date");
});

test("errorDetail: detail lista de strings usa el primero", async () => {
  assert.equal(await errorDetail(res({ detail: ["primero", "segundo"] })), "primero");
});

test("errorDetail: cuerpo no-JSON cae al statusText", async () => {
  assert.equal(await errorDetail(res("<html>proxy</html>", "Bad Gateway")), "Bad Gateway");
});

// F1-3 (chat-potencia 2026-11-24): Retry-After en segundos o fecha HTTP.
import { parseRetryAfter } from "./client";

test("parseRetryAfter: segundos tal cual", () => {
  assert.equal(parseRetryAfter("120"), 120);
  assert.equal(parseRetryAfter("0"), 0);
});

test("parseRetryAfter: fecha HTTP futura → segundos hasta entonces", () => {
  const now = Date.parse("2026-11-24T10:00:00Z");
  assert.equal(parseRetryAfter("Tue, 24 Nov 2026 10:01:30 GMT", now), 90);
});

test("parseRetryAfter: ausente o inválido → null; pasado → 0", () => {
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter("nope"), null);
  const now = Date.parse("2026-11-24T10:00:00Z");
  assert.equal(parseRetryAfter("Tue, 24 Nov 2026 09:59:00 GMT", now), 0);
});

// Entrada rápida (2026-11-24): la marca de invitado describe la sesión
// actual — setToken la borra al cambiar de sesión, setGuestToken la pone.
import { isGuest, setGuestToken, setToken } from "./client";

function stubWindow() {
  const prev = (globalThis as Record<string, unknown>).window;
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  };
  return () => {
    if (prev === undefined) delete (globalThis as Record<string, unknown>).window;
    else (globalThis as Record<string, unknown>).window = prev;
  };
}

test("marca invitado: setGuestToken la pone; setToken (login real) la borra", () => {
  const restore = stubWindow();
  try {
    assert.equal(isGuest(), false);
    setGuestToken("tok-invitado");
    assert.equal(isGuest(), true);
    setToken("tok-cuenta-real");
    assert.equal(isGuest(), false);
    setGuestToken("tok-invitado-2");
    assert.equal(isGuest(), true);
    setToken(null);
    assert.equal(isGuest(), false);
  } finally {
    restore();
  }
});
