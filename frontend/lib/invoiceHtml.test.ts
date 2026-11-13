// Test de escape HTML en impresión de factura (C1, 2026-11-13).
// Se corre con el runner de Node: `node --test lib/invoiceHtml.test.ts`
// (Node 24, sin dependencias: lib/invoiceHtml.ts y lib/format.ts son
// módulos puros, sin React ni fetch).
import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "./format";
import { buildInvoiceHtml, type InvoicePrintText } from "./invoiceHtml";

const txt: InvoicePrintText = {
  title: "Factura", heading: "Factura", concept: "Concepto", qty: "Cant.",
  price: "Precio", amount: "Importe", subtotal: "Subtotal", tax: "Impuesto",
  total: "Total", client: "Cliente", notes: "Notas", thanks: "Gracias",
};

function base(over: Record<string, unknown> = {}) {
  return {
    number: "F-1", date: "2026-11-13",
    sellerName: "Rubén Navarrete", sellerPhone: "(562) 317-9226", sellerEmail: "",
    clientName: "Cliente", clientEmail: "", clientPhone: "",
    items: [{ description: "Servicio", qty: 1, unit_price: 100 }],
    taxRate: 0, notes: "", txt,
    ...over,
  };
}

test("escapeHtml escapa & < > \" '", () => {
  assert.equal(escapeHtml(`<a href="x">&'y'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;y&#39;&lt;/a&gt;");
  assert.equal(escapeHtml("normal"), "normal");
  assert.equal(escapeHtml(null), "");
});

test("la descripción con <script> se imprime como texto, no como etiqueta", () => {
  const html = buildInvoiceHtml(base({
    items: [{ description: `<script>alert(1)</script>`, qty: 1, unit_price: 10 }],
  }));
  assert.ok(!html.includes("<script>"), "no debe quedar ninguna etiqueta <script>");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("la descripción con <img onerror> no deja ningún manejador ejecutable", () => {
  const html = buildInvoiceHtml(base({
    items: [{ description: `<img src=x onerror=alert(1)>`, qty: 1, unit_price: 10 }],
  }));
  assert.ok(!html.includes("<img"), "no debe quedar ninguna etiqueta <img>");
  // El texto escapado conserva las palabras, pero ya no es una etiqueta:
  // el "<" es "&lt;" y no hay ningún "<img" ejecutable en el documento.
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("nombre de cliente, notas y vendedor también se escapan", () => {
  const html = buildInvoiceHtml(base({
    clientName: `<svg onload=alert(1)>`,
    notes: `a & b <c>`,
    sellerName: `"><b>X</b>`,
  }));
  assert.ok(!html.includes("<svg"), "sin etiqueta <svg>");
  assert.ok(!html.includes("<b>X</b>"), "sin etiqueta <b> inyectada");
  assert.ok(html.includes("a &amp; b &lt;c&gt;"));
});
