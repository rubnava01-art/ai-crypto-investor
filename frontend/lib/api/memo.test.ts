import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogMemo } from "./memo";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("memo: devuelve la misma respuesta sin llamar dos veces al fetcher", async () => {
  const memo = createCatalogMemo(60_000);
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { n: calls };
  };
  assert.equal(await memo.get("k", fetcher), (await memo.get("k", fetcher)));
  assert.equal(calls, 1);
});

test("memo: deduplica peticiones en vuelo con la misma clave", async () => {
  const memo = createCatalogMemo(60_000);
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    await sleep(10);
    return calls;
  };
  const [a, b] = await Promise.all([memo.get("k", fetcher), memo.get("k", fetcher)]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(calls, 1);
});

test("memo: expira tras el TTL y vuelve a pedir", async () => {
  const memo = createCatalogMemo(20);
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return calls;
  };
  assert.equal(await memo.get("k", fetcher), 1);
  await sleep(30);
  assert.equal(await memo.get("k", fetcher), 2);
  assert.equal(calls, 2);
});

test("memo: un fallo no se guarda y el siguiente intento reintenta", async () => {
  const memo = createCatalogMemo(60_000);
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    if (calls === 1) throw new Error("boom");
    return calls;
  };
  await assert.rejects(memo.get("k", fetcher), /boom/);
  assert.equal(await memo.get("k", fetcher), 2);
  assert.equal(calls, 2);
});

test("memo: invalidate por prefijo solo borra las claves que empiezan así", async () => {
  const memo = createCatalogMemo(60_000);
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return calls;
  };
  await memo.get("/api/clases/classes?kind=grabada", fetcher);
  await memo.get("/api/academy/courses", fetcher);
  memo.invalidate("/api/clases/classes");
  // Clases se vuelve a pedir (3), academy sigue memoizado (no hay 4ª llamada).
  assert.equal(await memo.get("/api/clases/classes?kind=grabada", fetcher), 3);
  assert.equal(await memo.get("/api/academy/courses", fetcher), 2);
  assert.equal(calls, 3);
});

test("memo: clear vacía toda la caché y el siguiente get vuelve a pedir", async () => {
  const memo = createCatalogMemo(60_000);
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return calls;
  };
  assert.equal(await memo.get("/api/clases/classes", fetcher), 1);
  assert.equal(await memo.get("/api/academy/courses", fetcher), 2);
  memo.clear();
  assert.equal(await memo.get("/api/clases/classes", fetcher), 3);
  assert.equal(await memo.get("/api/academy/courses", fetcher), 4);
  assert.equal(calls, 4);
});

test("memo: invalidate durante un fetch en vuelo no guarda el resultado viejo", async () => {
  const memo = createCatalogMemo(60_000);
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    await sleep(10);
    return calls;
  };
  const first = memo.get("k", fetcher);
  memo.invalidate("k");
  assert.equal(await first, 1);
  // El resultado viejo no quedó guardado: el siguiente get vuelve a pedir.
  assert.equal(await memo.get("k", fetcher), 2);
  assert.equal(calls, 2);
});
