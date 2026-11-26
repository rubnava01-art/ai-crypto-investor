// F2-8 (chat-potencia 2026-11-24): las sugerencias del backend se
// normalizan — formato nuevo (objeto con requiere_admin) y formato
// antiguo (string plano) conviven; las inválidas se ignoran.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSugerencias } from "./asistente";

test("normalizeSugerencias: strings antiguos pasan sin marca", () => {
  assert.deepEqual(normalizeSugerencias(["Crea una factura", "Ver clientes"]), [
    { label: "Crea una factura" },
    { label: "Ver clientes" },
  ]);
});

test("normalizeSugerencias: objetos conservan requiere_admin", () => {
  assert.deepEqual(
    normalizeSugerencias([
      { label: "Crea una factura", requiere_admin: true },
      { label: "Ver clientes", requiere_admin: false },
    ]),
    [
      { label: "Crea una factura", requiere_admin: true },
      { label: "Ver clientes", requiere_admin: false },
    ],
  );
});

test("normalizeSugerencias: mezcla de formatos y entradas inválidas", () => {
  assert.deepEqual(
    normalizeSugerencias(["  ", { label: "  " }, null, "Ver ventas"] as never),
    [{ label: "Ver ventas" }],
  );
});

test("normalizeSugerencias: null o undefined devuelven lista vacía", () => {
  assert.deepEqual(normalizeSugerencias(null), []);
  assert.deepEqual(normalizeSugerencias(undefined), []);
});

// Corrida 2026-11-26 (Asistente práctico, Agente 1): historial C-2,
// idempotencia A6/M3, precio M-2/B6, confirmación A-2, día M-5.
import {
  accionDestino,
  buildHistorial,
  diaBoundsISO,
  esOrdenCrearCita,
  extractPrecio,
  newIdempotencyKey,
} from "./asistente";

test("buildHistorial: últimos 6 turnos, sin saludo ni errores", () => {
  const msgs = [
    { role: "assistant", text: "Hola, soy tu asistente.", isGreeting: true },
    { role: "user", text: "¿Cuánto vale el bitcoin?" },
    { role: "assistant", text: "$100,000" },
    { role: "user", text: "¿Y el ethereum?" },
    { role: "error", text: "Algo salió mal." },
    { role: "assistant", text: "$3,000" },
    { role: "user", text: "Crea una nota: revisar precios" },
    { role: "assistant", text: "Nota creada" },
    { role: "user", text: "¿Qué citas tengo?" },
  ];
  // D1 (QA 2026-11-26): el contrato del backend es
  // {rol: "usuario"|"asistente"} — user→usuario, assistant→asistente.
  assert.deepEqual(buildHistorial(msgs), [
    { rol: "asistente", texto: "$100,000" },
    { rol: "usuario", texto: "¿Y el ethereum?" },
    { rol: "asistente", texto: "$3,000" },
    { rol: "usuario", texto: "Crea una nota: revisar precios" },
    { rol: "asistente", texto: "Nota creada" },
    { rol: "usuario", texto: "¿Qué citas tengo?" },
  ]);
});

test("buildHistorial: sin turnos devuelve lista vacía", () => {
  assert.deepEqual(buildHistorial([]), []);
  assert.deepEqual(
    buildHistorial([{ role: "assistant", text: "Hola", isGreeting: true }]),
    [],
  );
});

test("newIdempotencyKey: únicas y con formato UUID cuando hay crypto", () => {
  const a = newIdempotencyKey();
  const b = newIdempotencyKey();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

test("esOrdenCrearCita: casa crear/agendar + cita, no consultas", () => {
  assert.equal(esOrdenCrearCita("Crea una cita para María mañana a las 10:00"), true);
  assert.equal(esOrdenCrearCita("Agenda una cita con el cliente el viernes"), true);
  assert.equal(esOrdenCrearCita("¿Qué citas tengo?"), false);
  assert.equal(esOrdenCrearCita("Crea una nota: revisar precios"), false);
  assert.equal(esOrdenCrearCita("¿Cuánto vale el bitcoin?"), false);
});

test("extractPrecio: caché fresca usa actualizado_en y edad reales (D2)", () => {
  assert.deepEqual(
    extractPrecio(
      { tipo: "precio_btc", datos: { btc_usd: 100000, eth_usd: 3000, disponible: true, fuente: "cache_mercado", actualizado_en: "2026-11-26T19:58:00Z", cache_edad_s: 120 } },
      "2026-11-26T20:00:00Z",
    ),
    {
      btcUsd: 100000,
      ethUsd: 3000,
      fuente: "cache_mercado",
      timestamp: "2026-11-26T19:58:00Z",
      edadSegundos: 120,
    },
  );
  // Sin esos campos (backend anterior), sigue el fallback a consultado_en.
  assert.deepEqual(
    extractPrecio(
      { tipo: "precio_btc", datos: { btc_usd: 100000, eth_usd: 3000, disponible: true, fuente: "cache_mercado" } },
      "2026-11-26T20:00:00Z",
    ),
    {
      btcUsd: 100000,
      ethUsd: 3000,
      fuente: "cache_mercado",
      timestamp: "2026-11-26T20:00:00Z",
      edadSegundos: null,
    },
  );
});

test("extractPrecio: velas usan fecha_vela; vieja trae edad y actualizado_en", () => {
  assert.deepEqual(
    extractPrecio(
      { tipo: "precio_btc", datos: { btc_usd: 99000, eth_usd: null, fuente: "velas_guardadas", fecha_vela: "2026-11-26T18:00:00Z" } },
      "2026-11-26T20:00:00Z",
    )?.timestamp,
    "2026-11-26T18:00:00Z",
  );
  const vieja = extractPrecio(
    { tipo: "precio_btc", datos: { btc_usd: 98000, eth_usd: 2900, fuente: "cache_mercado_vieja", cache_edad_s: 900, actualizado_en: "2026-11-26T19:45:00Z" } },
    "2026-11-26T20:00:00Z",
  );
  assert.equal(vieja?.edadSegundos, 900);
  assert.equal(vieja?.timestamp, "2026-11-26T19:45:00Z");
});

test("extractPrecio: sin precio o sin acción no hay tarjeta (no inventa)", () => {
  assert.equal(extractPrecio(null, "2026-11-26T20:00:00Z"), null);
  assert.equal(
    extractPrecio({ tipo: "senales", datos: {} }, "2026-11-26T20:00:00Z"),
    null,
  );
  assert.equal(
    extractPrecio(
      { tipo: "precio_btc", datos: { btc_usd: null, eth_usd: null, disponible: false, fuente: "sin_datos" } },
      "2026-11-26T20:00:00Z",
    ),
    null,
  );
});

test("accionDestino: notas/tareas/citas a /business, borrador a /crear", () => {
  assert.deepEqual(accionDestino("crear_nota"), { ruta: "/business", modulo: "business" });
  assert.deepEqual(accionDestino("crear_tarea"), { ruta: "/business", modulo: "business" });
  assert.deepEqual(accionDestino("crear_cita"), { ruta: "/business", modulo: "business" });
  assert.deepEqual(accionDestino("crear_borrador"), { ruta: "/crear", modulo: "crear" });
  assert.equal(accionDestino("precio_btc"), null);
  assert.equal(accionDestino("senales"), null);
});

test("diaBoundsISO: 24 h exactas y fecha civil de Los Ángeles", () => {
  // 2026-11-26 12:00 UTC = 04:00 en Los Ángeles (PST, UTC-8).
  const b = diaBoundsISO(new Date("2026-11-26T12:00:00Z"));
  assert.equal(b.fecha, "2026-11-26");
  assert.equal(b.from, "2026-11-26T08:00:00.000Z");
  assert.equal(b.to, "2026-11-27T08:00:00.000Z");
});
