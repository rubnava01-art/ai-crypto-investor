// Tests del formulario de contacto (lib/contacto.ts + lib/api/contacto.ts,
// plan servicios-calc 2026-11-25). Se corre con el runner de Node:
// `npm test` en frontend (Node 24, sin dependencias: los módulos son
// TS erasables y puros salvo el cliente API, que se prueba con un
// fetch global stubbeado).
// Las dos comprobaciones de «presencia en el componente» leen el
// fuente de ContactoForm/HerramientasSection: este repo no tiene
// jsdom ni React Testing Library, así que el guard contra borrar el
// honeypot o desenchufar los CTA es estático, no de render.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONTACTO_MENSAJE_MAX,
  CONTACTO_NOMBRE_MAX,
  SERVICIO_CONTACTO_HREF,
  SERVICIOS_BANDA,
  isHoneypotFilled,
  parseServicioParam,
  validateContactoForm,
} from "./contacto";
import { contactoApi } from "./api/contacto";

const VALID = {
  nombre: "Rubén",
  email: "ruben@example.com",
  servicio: "camisetas" as const,
  mensaje: "Quiero una cotización.",
  website: "",
};

// --- parseServicioParam (?servicio=) ---

test("parseServicioParam: los 4 servicios válidos preseleccionan", () => {
  for (const s of ["camisetas", "publicitario", "marketing", "otro"]) {
    assert.equal(parseServicioParam(`?servicio=${s}`), s);
  }
});

test("parseServicioParam: ausente, inválido o en mayúsculas → null (placeholder)", () => {
  assert.equal(parseServicioParam(""), null);
  assert.equal(parseServicioParam(null), null);
  assert.equal(parseServicioParam(undefined), null);
  assert.equal(parseServicioParam("?servicio=camisas"), null);
  assert.equal(parseServicioParam("?servicio=CAMISETAS"), null);
  assert.equal(parseServicioParam("?otro=camisetas"), null);
});

test("parseServicioParam: ignora otros parámetros y usa el primero si se repite", () => {
  assert.equal(parseServicioParam("?foo=1&servicio=marketing&bar=2"), "marketing");
});

// --- validateContactoForm (mismos límites del contrato backend) ---

test("validateContactoForm: valores válidos → sin errores", () => {
  assert.deepEqual(validateContactoForm(VALID), {});
});

test("validateContactoForm: todo vacío → required en los 4 campos", () => {
  assert.deepEqual(
    validateContactoForm({ nombre: "", email: "", servicio: "", mensaje: "", website: "" }),
    { nombre: "required", email: "required", servicio: "required", mensaje: "required" },
  );
});

test("validateContactoForm: solo espacios cuentan como vacío", () => {
  const errors = validateContactoForm({ ...VALID, nombre: "   ", mensaje: "  " });
  assert.equal(errors.nombre, "required");
  assert.equal(errors.mensaje, "required");
});

test("validateContactoForm: nombre >100 y mensaje >2000 → tooLong", () => {
  const errors = validateContactoForm({
    ...VALID,
    nombre: "x".repeat(CONTACTO_NOMBRE_MAX + 1),
    mensaje: "y".repeat(CONTACTO_MENSAJE_MAX + 1),
  });
  assert.equal(errors.nombre, "tooLong");
  assert.equal(errors.mensaje, "tooLong");
  assert.equal(CONTACTO_NOMBRE_MAX, 100);
  assert.equal(CONTACTO_MENSAJE_MAX, 2000);
});

test("validateContactoForm: email sin @ o sin dominio → invalidEmail", () => {
  for (const bad of ["no-es-correo", "a@b", "@dominio.com", "a b@c.com"]) {
    assert.equal(validateContactoForm({ ...VALID, email: bad }).email, "invalidEmail", bad);
  }
  assert.equal(validateContactoForm({ ...VALID, email: "  ruben@example.com  " }).email, undefined);
});

test("validateContactoForm: servicio fuera del contrato no pasa (type-level, runtime: vacío)", () => {
  // El select solo ofrece los 4 valores; un "" es el placeholder.
  assert.equal(validateContactoForm({ ...VALID, servicio: "" }).servicio, "required");
});

// --- Honeypot ---

test("isHoneypotFilled: vacío o espacios → no es bot; cualquier texto → bot", () => {
  assert.equal(isHoneypotFilled(""), false);
  assert.equal(isHoneypotFilled("   "), false);
  assert.equal(isHoneypotFilled("http://spam.example"), true);
});

// --- Href de los CTA de la banda de Servicios ---

test("SERVICIO_CONTACTO_HREF: los 3 CTA de la banda van a /contacto?servicio=<servicio>", () => {
  assert.deepEqual(SERVICIO_CONTACTO_HREF, {
    camisetas: "/contacto?servicio=camisetas",
    publicitario: "/contacto?servicio=publicitario",
    marketing: "/contacto?servicio=marketing",
    otro: "/contacto?servicio=otro",
  });
  assert.deepEqual(SERVICIOS_BANDA, ["camisetas", "publicitario", "marketing"]);
});

// --- Cliente API (contrato backend) con fetch stubbeado ---

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function stubFetch(handler: (c: Captured) => Response) {
  const calls: Captured[] = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const c: Captured = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(c);
    return handler(c);
  };
  return { calls, restore: () => { globalThis.fetch = prev; } };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("contactoApi.create: POST público sin Authorization, con el body del contrato", async () => {
  const { calls, restore } = stubFetch(() => json({ id: 7, created_at: "2026-11-25T10:00:00Z" }, 201));
  try {
    const res = await contactoApi.createContactoMensaje({
      nombre: "Rubén",
      email: "ruben@example.com",
      servicio: "marketing",
      mensaje: "Hola",
    });
    assert.equal(res.id, 7);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://localhost:8000/api/contacto/mensajes");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
      nombre: "Rubén",
      email: "ruben@example.com",
      servicio: "marketing",
      mensaje: "Hola",
    });
  } finally {
    restore();
  }
});

test("contactoApi.list: GET autenticado con limit/offset", async () => {
  const { calls, restore } = stubFetch(() => json([]));
  try {
    await contactoApi.listContactoMensajes({ limit: 25, offset: 50 });
    assert.equal(calls[0].url, "http://localhost:8000/api/contacto/mensajes?limit=25&offset=50");
    assert.equal(calls[0].method, "GET");
  } finally {
    restore();
  }
});

test("contactoApi.update/delete: PATCH con {estado} y DELETE 204", async () => {
  const { calls, restore } = stubFetch((c) =>
    c.method === "DELETE" ? new Response(null, { status: 204 }) : json({ id: 3, estado: "leído" }),
  );
  try {
    await contactoApi.updateContactoMensajeEstado(3, "leído");
    assert.equal(calls[0].method, "PATCH");
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), { estado: "leído" });
    await contactoApi.deleteContactoMensaje(3);
    assert.equal(calls[1].method, "DELETE");
    assert.equal(calls[1].url, "http://localhost:8000/api/contacto/mensajes/3");
  } finally {
    restore();
  }
});

test("contactoApi.create: un 422 del backend llega como ApiError 422 (el form lo mapea)", async () => {
  const { restore } = stubFetch(() =>
    json({ detail: [{ loc: ["body", "email"], msg: "field required", type: "missing" }] }, 422),
  );
  try {
    await assert.rejects(
      contactoApi.createContactoMensaje({ nombre: "R", email: "", servicio: "otro", mensaje: "x" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return (err as { status?: number }).status === 422;
      },
    );
  } finally {
    restore();
  }
});

// --- Presencia en los componentes (guard estático, sin DOM) ---

test("ContactoForm: honeypot `website` presente, oculto, aria-hidden y fuera del tabulador", () => {
  const src = readFileSync(new URL("../components/ContactoForm.tsx", import.meta.url), "utf8");
  assert.ok(src.includes('name="website"'), "falta el campo honeypot website");
  assert.ok(src.includes("aria-hidden"), "el honeypot debe ser aria-hidden");
  assert.ok(src.includes("tabIndex={-1}"), "el honeypot debe estar fuera del tabulador");
  assert.ok(src.includes('autoComplete="off"'), "el honeypot debe llevar autocomplete off");
  assert.ok(src.includes("isHoneypotFilled"), "el envío debe comprobar el honeypot");
  assert.ok(src.includes("formErrTooMany"), "el 429 debe mapearse a mensaje de espera");
});

test("HerramientasSection: la banda usa SERVICIO_CONTACTO_HREF (no literales /contacto)", () => {
  const src = readFileSync(new URL("../components/HerramientasSection.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("SERVICIO_CONTACTO_HREF"), "la banda debe leer los href de lib/contacto");
  assert.ok(src.includes("SERVICIOS_BANDA"), "la banda debe iterar SERVICIOS_BANDA");
  // El único href="/contacto" pelado que queda es el genérico «Escríbenos»
  // del bloque «pregunta gratis» (sin servicio que preseleccionar); los
  // 3 CTA de la banda salen de SERVICIO_CONTACTO_HREF.
  assert.equal(src.match(/href="\/contacto"/g)?.length, 1);
});

test("CorreosPanel: la bandeja de mensajes de contacto solo se monta para admin", () => {
  const src = readFileSync(new URL("../components/CorreosPanel.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("MensajesContactoPanel"), "falta la bandeja");
  assert.ok(src.includes("{isAdmin && <MensajesContactoPanel"), "la bandeja debe ser solo-admin");
  assert.ok(src.includes("listContactoMensajes"), "la bandeja debe listar con GET");
  assert.ok(src.includes("updateContactoMensajeEstado"), "la bandeja debe marcar estado con PATCH");
  assert.ok(src.includes("deleteContactoMensaje"), "la bandeja debe borrar con DELETE");
});
