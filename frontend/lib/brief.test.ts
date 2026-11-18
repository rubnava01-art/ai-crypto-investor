import test from "node:test";
import assert from "node:assert/strict";
import { briefAnswered, briefMissing, briefQ2Warning, countWords } from "./brief";

test("brief: countWords cuenta palabras separadas por espacios", () => {
  assert.equal(countWords("cercano rebelde honesto"), 3);
  assert.equal(countWords("  cercano   rebelde  "), 2);
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   "), 0);
  assert.equal(countWords("una"), 1);
});

test("brief: vacío -> 0/8 y faltan las 8", () => {
  assert.equal(briefAnswered({}), 0);
  assert.deepEqual(briefMissing({}), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(briefAnswered(null), 0);
  assert.deepEqual(briefMissing(null), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("brief: solo espacios no cuenta como respondida", () => {
  assert.equal(briefAnswered({ q1: "  ", q2: "cercano rebelde honesto" }), 1);
  assert.deepEqual(briefMissing({ q1: "  ", q2: "x" }), [1, 3, 4, 5, 6, 7, 8]);
});

test("brief: 8/8 cuando todas tienen texto", () => {
  const answers: Record<string, string> = {};
  for (let i = 1; i <= 8; i++) answers[`q${i}`] = "respuesta";
  assert.equal(briefAnswered(answers), 8);
  assert.deepEqual(briefMissing(answers), []);
});

test("brief: Q2 avisa solo con texto y != 3 palabras", () => {
  assert.equal(briefQ2Warning(""), false);
  assert.equal(briefQ2Warning("   "), false);
  assert.equal(briefQ2Warning("cercano rebelde honesto"), false);
  assert.equal(briefQ2Warning("cercano rebelde"), true);
  assert.equal(briefQ2Warning("una dos tres cuatro"), true);
});
