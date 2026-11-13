// HTML de impresión de factura — módulo puro (2026-11-13, C1).
// Extraído de FacturasPanel.printInvoiceHtml para poder probarlo sin
// montar React: TODOS los campos interpolados pasan por escapeHtml, así
// que una descripción con <script> o <img onerror> se imprime como texto
// y nunca ejecuta JavaScript en la ventana de impresión (mismo origen).

import { escapeHtml, formatMoney } from "./format";

export type InvoiceItemLike = { description: string; qty: number; unit_price: number };

export function invoiceTotals(items: InvoiceItemLike[], taxRate: number) {
  const sub = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);
  const tax = sub * ((Number(taxRate) || 0) / 100);
  return { sub, tax, total: sub + tax };
}

export type InvoicePrintText = {
  title: string; heading: string; concept: string; qty: string; price: string;
  amount: string; subtotal: string; tax: string; total: string; client: string;
  notes: string; thanks: string;
};

export function buildInvoiceHtml(opts: {
  number: string;
  date: string;
  sellerName: string;
  sellerPhone: string;
  sellerEmail: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  items: InvoiceItemLike[];
  taxRate: number;
  notes: string;
  txt: InvoicePrintText;
}): string {
  const esc = escapeHtml;
  const money = (n: number) => formatMoney(n, "USD", "en-US");
  const t = invoiceTotals(opts.items, opts.taxRate);
  const rows = opts.items
    .map(
      (it) => `<tr><td>${esc(it.description)}</td><td style="text-align:center">${Number(it.qty) || 0}</td><td style="text-align:right">${money(it.unit_price)}</td><td style="text-align:right">${money(it.qty * it.unit_price)}</td></tr>`,
    )
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(opts.txt.title)} ${esc(opts.number)}</title>
  <style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#111}h1{font-size:28px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border-bottom:1px solid #ccc;padding:8px;text-align:left}.tot{margin-top:20px;text-align:right;font-size:16px}.tot b{font-size:20px}.mut{color:#555}</style>
  </head><body><h1>${esc(opts.txt.heading)} ${esc(opts.number)}</h1><p class="mut">${esc(opts.date)}</p>
  <p><b>${esc(opts.sellerName)}</b><br>${esc(opts.sellerPhone)}<br>${esc(opts.sellerEmail)}</p>
  <p><b>${esc(opts.txt.client)}</b> ${esc(opts.clientName)}<br>${esc(opts.clientPhone)}<br>${esc(opts.clientEmail)}</p>
  <table><tr><th>${esc(opts.txt.concept)}</th><th style="text-align:center">${esc(opts.txt.qty)}</th><th style="text-align:right">${esc(opts.txt.price)}</th><th style="text-align:right">${esc(opts.txt.amount)}</th></tr>${rows}</table>
  <div class="tot"><p>${esc(opts.txt.subtotal)} ${money(t.sub)}</p><p>${esc(opts.txt.tax)} (${Number(opts.taxRate) || 0}%): ${money(t.tax)}</p><p><b>${esc(opts.txt.total)} ${money(t.total)}</b></p></div>
  ${opts.notes ? `<p><b>${esc(opts.txt.notes)}</b> ${esc(opts.notes)}</p>` : ""}
  <p class="mut">${esc(opts.txt.thanks)}</p></body></html>`;
}
