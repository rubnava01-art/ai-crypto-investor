// Tests de lib/sessionCookie.ts (corrección QA H2, Fase 3 mejoras-v1):
// la cookie marcadora es un valor fijo sin datos personales, se pone y
// se borra con las cadenas exactas, y la decisión de la raíz depende
// solo de su presencia con el valor exacto.
import test from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_VALUE,
  buildClearSessionCookie,
  buildSessionCookie,
  clearSessionCookie,
  hasSessionCookie,
  rootShellForSessionCookie,
  setSessionCookie,
} from "./sessionCookie";

test("la cookie marcadora es un valor fijo sin datos personales", () => {
  assert.equal(SESSION_COOKIE_NAME, "gpb_session");
  assert.equal(SESSION_COOKIE_VALUE, "1");
  assert.equal(SESSION_COOKIE_MAX_AGE_SECONDS, 30 * 24 * 60 * 60);
});

test("buildSessionCookie: marca Path=/, Max-Age y SameSite=Lax", () => {
  const built = buildSessionCookie();
  assert.match(built, /^gpb_session=1; Path=\/; Max-Age=2592000; SameSite=Lax/);
});

test("buildClearSessionCookie: borra con Max-Age=0 en la misma ruta", () => {
  assert.equal(buildClearSessionCookie(), "gpb_session=; Path=/; Max-Age=0; SameSite=Lax");
});

test("setSessionCookie / clearSessionCookie escriben la cadena exacta", () => {
  const written: string[] = [];
  (globalThis as unknown as { document: { cookie: string } }).document = {
    set cookie(value: string) {
      written.push(value);
    },
    get cookie() {
      return "";
    },
  };
  setSessionCookie();
  clearSessionCookie();
  assert.equal(written[0], buildSessionCookie());
  assert.equal(written[1], buildClearSessionCookie());
  delete (globalThis as unknown as { document?: unknown }).document;
});

test("hasSessionCookie: solo el valor exacto cuenta", () => {
  assert.equal(hasSessionCookie("gpb_session=1"), true);
  assert.equal(hasSessionCookie("aci_lang=es; gpb_session=1; otro=x"), true);
  assert.equal(hasSessionCookie(null), false);
  assert.equal(hasSessionCookie(undefined), false);
  assert.equal(hasSessionCookie(""), false);
  assert.equal(hasSessionCookie("gpb_session=0"), false);
  assert.equal(hasSessionCookie("gpb_session=1x"), false);
  assert.equal(hasSessionCookie("gpb_session="), false);
  assert.equal(hasSessionCookie("otro=1"), false);
});

test("rootShellForSessionCookie: dashboard con sesión, landing sin ella", () => {
  assert.equal(rootShellForSessionCookie("1"), "dashboard");
  assert.equal(rootShellForSessionCookie(null), "landing");
  assert.equal(rootShellForSessionCookie(undefined), "landing");
  assert.equal(rootShellForSessionCookie("0"), "landing");
  assert.equal(rootShellForSessionCookie(""), "landing");
});
