// Tests de redirección de sesión (lib/session.ts) — ronda de
// correcciones QA TBT-Herramientas, H-01 (2026-11-24). Se corre con el
// runner de Node: `npm test` en frontend (Node 24, sin dependencias:
// session.ts es un módulo TS erasable y puro). Cubre el flujo del gancho
// libre «Pruébala sin cuenta»: loginUrl/isSafeNext/safeNext con
// fragmento, guestNextFromSearch respetando ?next= válido y rechazando
// uno inválido, y —a nivel de fuente, como herramientas.test.ts— que
// ModuleShell preserva el hash, /login monta GuestTrialButton y
// GuestTrial enhebra el destino (el render del componente no se cubre:
// no hay harness jsdom en este repo).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { guestNextFromSearch, isSafeNext, loginUrl, safeNext } from "./session";
import { dictEs } from "./i18n/es";
import { dictEn } from "./i18n/en";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSrc = (rel: string) => readFileSync(path.join(FRONTEND, rel), "utf8");

// --- H-01: el fragmento (#ancla) sobrevive a la redirección ---

test("isSafeNext: acepta ruta interna con fragmento (las 2 del gancho libre)", () => {
  assert.equal(isSafeNext("/estudiar#herramienta-calculadora"), true);
  assert.equal(isSafeNext("/estudiar#herramienta-bitcoin"), true);
  assert.equal(isSafeNext("/estudiar?tab=videos#estudiar-videos"), true);
});

test("safeNext: devuelve la ruta con el fragmento intacto", () => {
  assert.equal(safeNext("/estudiar#herramienta-calculadora"), "/estudiar#herramienta-calculadora");
  assert.equal(safeNext("/estudiar#herramienta-bitcoin"), "/estudiar#herramienta-bitcoin");
});

test("loginUrl: codifica el destino con fragmento y se recupera intacto (ida y vuelta)", () => {
  const url = loginUrl("/estudiar#herramienta-calculadora");
  assert.ok(url.startsWith("/login?next="), url);
  const back = new URLSearchParams(url.split("?")[1]).get("next");
  assert.equal(back, "/estudiar#herramienta-calculadora");
  const urlB = loginUrl("/estudiar#herramienta-bitcoin");
  assert.equal(new URLSearchParams(urlB.split("?")[1]).get("next"), "/estudiar#herramienta-bitcoin");
});

// --- H-01: la validación NO se relaja (todo lo demás sigue rechazado) ---

test("isSafeNext: sigue rechazando //, backslash, %2f/%5c, absolutas y /login", () => {
  for (const bad of [
    "//evil.com/x",
    "/\\evil.com",
    "/%2fevil.com",
    "/%5cevil.com",
    "/estudiar%2f..",
    "https://evil.com/estudiar",
    "http://evil.com",
    "/login",
    "/login?next=/estudiar",
    "/login#herramienta-calculadora",
    "/login/",
    "",
    "/estudiar#x\x01",
  ]) {
    assert.equal(isSafeNext(bad), false, bad);
  }
  assert.equal(isSafeNext(null), false);
  assert.equal(isSafeNext(undefined), false);
  assert.equal(safeNext("//evil.com/x"), "/");
  assert.equal(safeNext("/login"), "/");
});

// --- H-01: GuestTrial respeta ?next= válido y rechaza uno inválido ---

test("guestNextFromSearch: destino válido con fragmento (codificado %23)", () => {
  assert.equal(
    guestNextFromSearch("?next=%2Festudiar%23herramienta-calculadora"),
    "/estudiar#herramienta-calculadora",
  );
  assert.equal(
    guestNextFromSearch("?next=%2Festudiar%23herramienta-bitcoin"),
    "/estudiar#herramienta-bitcoin",
  );
  assert.equal(guestNextFromSearch("?next=%2Finicio"), "/inicio");
  assert.equal(guestNextFromSearch("?next=/planes"), "/planes");
});

test("guestNextFromSearch: destino inválido o ausente cae al fallback /inicio", () => {
  assert.equal(guestNextFromSearch("?next=https%3A%2F%2Fevil.com%2Fx"), "/inicio");
  assert.equal(guestNextFromSearch("?next=%2F%2Fevil.com"), "/inicio");
  assert.equal(guestNextFromSearch("?next=%2Flogin"), "/inicio");
  assert.equal(guestNextFromSearch("?next=%2Flogin%3Fnext%3D%2Festudiar"), "/inicio");
  assert.equal(guestNextFromSearch(""), "/inicio");
  assert.equal(guestNextFromSearch(null), "/inicio");
  assert.equal(guestNextFromSearch("?expired=1"), "/inicio");
  assert.equal(guestNextFromSearch("?next=//evil.com", "/estudiar"), "/estudiar");
});

// --- H-01: el cableado del flujo existe en el fuente ---

test("ModuleShell preserva el fragmento al redirigir a /login", () => {
  const src = readSrc("components/ModuleShell.tsx");
  assert.ok(
    src.includes("window.location.pathname + window.location.search + window.location.hash"),
    "ModuleShell debe concatenar pathname + search + hash en loginUrl",
  );
});

test("/login monta GuestTrialButton (vía de invitado sin volver al héroe)", () => {
  const src = readSrc("app/login/page.tsx");
  assert.ok(src.includes('from "../../components/GuestTrial"'), "falta el import de GuestTrial");
  assert.ok(src.includes("<GuestTrialButton />"), "falta montar <GuestTrialButton /> en /login");
});

test("GuestTrial enhebra ?next= con guestNextFromSearch (no /inicio fijo)", () => {
  const src = readSrc("components/GuestTrial.tsx");
  assert.ok(src.includes("guestNextFromSearch(window.location.search)"), "GuestTrial debe usar guestNextFromSearch");
  assert.ok(!src.includes('router.push("/inicio")'), "GuestTrial ya no debe empujar /inicio fijo");
});

// --- T-0 (plan servicios-calc, bloqueador — CRÍTICA-1, 2026-11-25) ---
// La fusión de diccionarios i18n borró guest.challengeRetry y
// guest.challengeAutoSubmit en ES y EN a la vez: tsc no lo ve (guest es
// Record<string, string>), la paridad ES↔EN no lo ve (faltan en ambos
// idiomas) y ningún test lo cubría. Este test falla si cualquiera de
// las claves que el flujo invitado usa vuelve a faltar o queda vacía.

test("T-0: claves críticas del flujo invitado existen no vacías en ES y EN", () => {
  const guestKeys = [
    "challengeTitle",
    "challengeHint",
    "challengeAnswer",
    "challengeStart",
    "challengeError",
    "challengeLoadError",
    "challengeRetry",
    "challengeAutoSubmit",
    "banner",
    "bannerCta",
    "menuName",
    "inviteChat",
    "inviteBlocked",
    "inviteSave",
    "expired",
  ] as const;
  for (const key of guestKeys) {
    for (const [lang, dict] of [
      ["es", dictEs],
      ["en", dictEn],
    ] as const) {
      const value = dict.guest[key];
      assert.ok(typeof value === "string" && value.trim() !== "", `guest.${key} falta o está vacía en ${lang}`);
    }
  }
  // Las dos claves de CRÍTICA-1, con sus textos exactos restaurados.
  assert.equal(dictEs.guest.challengeRetry, "Cargar otra pregunta");
  assert.equal(dictEs.guest.challengeAutoSubmit, "Se envía sola en un momento — borra un dígito para corregir.");
  assert.equal(dictEn.guest.challengeRetry, "Load another question");
  assert.equal(dictEn.guest.challengeAutoSubmit, "Sending shortly — delete a digit to correct it.");
});
