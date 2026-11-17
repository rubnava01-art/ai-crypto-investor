import test from "node:test";
import assert from "node:assert/strict";
import { passwordStrength } from "./passwordStrength";

test("passwordStrength: menos de 12 caracteres siempre es débil", () => {
  assert.equal(passwordStrength("").level, "weak");
  assert.equal(passwordStrength("Ab1!").level, "weak");
  assert.equal(passwordStrength("Abcdefgh1!").level, "weak");
});

test("passwordStrength: 12 caracteres de una sola clase es débil", () => {
  assert.deepEqual(passwordStrength("abcdefghijkl"), { level: "weak", segments: 1 });
});

test("passwordStrength: sube con variedad y longitud", () => {
  assert.deepEqual(passwordStrength("Abcdefghijkl"), { level: "fair", segments: 2 });
  assert.deepEqual(passwordStrength("Abcdefghijk1"), { level: "good", segments: 3 });
  assert.deepEqual(passwordStrength("Abcdefghijk1!"), { level: "strong", segments: 4 });
  // 16 caracteres con 2 clases llega a "Buena" por longitud.
  assert.deepEqual(passwordStrength("Abcdefghijklmnop"), { level: "good", segments: 3 });
  // 16 caracteres con 4 clases es "Fuerte".
  assert.deepEqual(passwordStrength("Abcdefghijk1234!"), { level: "strong", segments: 4 });
});
