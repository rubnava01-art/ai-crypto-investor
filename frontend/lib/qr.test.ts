import test from "node:test";
import assert from "node:assert/strict";
import { encodeQr, formatBits, versionBits } from "./qr";

test("qr: bits de formato para nivel L y máscara 0 (constante conocida 0x77C4)", () => {
  assert.equal(formatBits(0), 0x77c4);
});

test("qr: bits de versión 7 (constante conocida 0x07C94)", () => {
  assert.equal(versionBits(7), 0x07c94);
});

test("qr: la información de formato queda en la matriz en su sitio", () => {
  const qr = encodeQr("HELLO WORLD");
  assert.equal(qr.version, 1);
  assert.equal(qr.size, 21);
  // Primera copia: (8,0..5), (8,7), (8,8), (7,8), (5..0,8) guardan los
  // bits 0..14 (LSB primero); el valor debe ser 0x77C4.
  const positions: Array<[number, number]> = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  let value = 0;
  positions.forEach(([x, y], i) => {
    if (qr.modules[y][x]) value |= 1 << i;
  });
  assert.equal(value, 0x77c4);
});

test("qr: patrones de función intactos (finders, temporización, módulo oscuro)", () => {
  const qr = encodeQr("HELLO WORLD");
  const m = qr.modules;
  // Finder superior izquierda: anillo exterior oscuro, centro oscuro.
  assert.equal(m[0][0], true);
  assert.equal(m[0][6], true);
  assert.equal(m[6][0], true);
  assert.equal(m[6][6], true);
  assert.equal(m[3][3], true);
  // Anillo claro del finder (dist 2) y separador (dist 4).
  assert.equal(m[1][1], false);
  assert.equal(m[0][7], false);
  assert.equal(m[7][0], false);
  // Temporización: fila 6 y columna 6 alternan fuera de los finders.
  assert.equal(m[6][8], true);
  assert.equal(m[6][9], false);
  assert.equal(m[8][6], true);
  assert.equal(m[9][6], false);
  // Módulo oscuro en (fila 4v+9, col 8).
  assert.equal(m[13][8], true);
  // Ningún módulo queda sin rellenar.
  for (const row of m) for (const cell of row) assert.equal(typeof cell, "boolean");
});

test("qr: la versión crece con la longitud y el tamaño es 17 + 4·versión", () => {
  assert.equal(encodeQr("a".repeat(17)).version, 1);
  assert.equal(encodeQr("a".repeat(18)).version, 2);
  assert.equal(encodeQr("a".repeat(53)).version, 3);
  assert.equal(encodeQr("a".repeat(54)).version, 4);
  const qr = encodeQr("https://crypto-investor-web.onrender.com/perfil");
  assert.equal(qr.size, qr.version * 4 + 17);
  assert.ok(qr.version >= 2 && qr.version <= 4);
});

test("qr: determinista y distinto para textos distintos", () => {
  const a = encodeQr("Grow Business Platform");
  const b = encodeQr("Grow Business Platform");
  const c = encodeQr("Grow Business Platforn");
  assert.deepEqual(a.modules, b.modules);
  assert.notDeepEqual(a.modules, c.modules);
});

test("qr: rechaza texto vacío y texto mayor de 271 bytes", () => {
  assert.throws(() => encodeQr(""), /vacío/);
  assert.throws(() => encodeQr("a".repeat(272)), /demasiado largo/);
  assert.doesNotThrow(() => encodeQr("a".repeat(271)));
});

test("qr: versión 7 lleva información de versión y alineación", () => {
  const qr = encodeQr("a".repeat(150));
  assert.equal(qr.version, 7);
  assert.equal(qr.size, 45);
  // Patrón de alineación centrado en (22,22): centro oscuro, anillo claro.
  assert.equal(qr.modules[22][22], true);
  assert.equal(qr.modules[21][22], false);
  assert.equal(qr.modules[20][22], true);
  for (const row of qr.modules) for (const cell of row) assert.equal(typeof cell, "boolean");
});
