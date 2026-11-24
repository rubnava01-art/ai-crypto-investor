// F4-3 (chat-potencia 2026-11-24): las URLs del texto del chat se
// linkifican con safeHttpHref; los esquemas no http(s) no se enlazan.
import test from "node:test";
import assert from "node:assert/strict";
import { splitLinks } from "./linkify";

test("splitLinks: texto sin URLs queda como un solo tramo", () => {
  assert.deepEqual(splitLinks("Hola, ¿qué tal?"), [{ text: "Hola, ¿qué tal?" }]);
});

test("splitLinks: una URL se separa como enlace", () => {
  const segs = splitLinks("Mira https://example.com/guia y dime");
  assert.deepEqual(segs, [
    { text: "Mira " },
    { text: "https://example.com/guia", href: "https://example.com/guia" },
    { text: " y dime" },
  ]);
});

test("splitLinks: la puntuación final no forma parte del enlace", () => {
  const segs = splitLinks("Entra en https://example.com.");
  assert.equal(segs[1]?.href, "https://example.com");
  assert.equal(segs[2]?.text, ".");
});

test("splitLinks: javascript: no se enlaza", () => {
  const segs = splitLinks("No pulses javascript:alert(1) nunca");
  assert.equal(segs.length, 1);
  assert.equal(segs[0]?.href, undefined);
});

test("splitLinks: texto vacío no produce tramos", () => {
  assert.deepEqual(splitLinks(""), []);
});
