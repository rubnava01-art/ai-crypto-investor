"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type CrmContact, type Invoice, type InvoiceItem, type InvoiceStatus, type MeResponse,
} from "../lib/api";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : null;

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  pagada: "Pagada",
};

const emptyItem = (): InvoiceItem => ({ description: "", qty: 1, unit_price: 0 });

function totals(items: InvoiceItem[], taxRate: number) {
  const sub = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);
  const tax = sub * ((Number(taxRate) || 0) / 100);
  return { sub, tax, total: sub + tax };
}

function printInvoiceHtml(opts: {
  number: string;
  date: string;
  sellerName: string;
  sellerPhone: string;
  sellerEmail: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  items: InvoiceItem[];
  taxRate: number;
  notes: string;
}) {
  const t = totals(opts.items, opts.taxRate);
  const rows = opts.items
    .map(
      (it) => `<tr><td>${it.description}</td><td style="text-align:center">${it.qty}</td><td style="text-align:right">${money(it.unit_price)}</td><td style="text-align:right">${money(it.qty * it.unit_price)}</td></tr>`
    )
    .join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Factura ${opts.number}</title>
  <style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#111}h1{font-size:28px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border-bottom:1px solid #ccc;padding:8px;text-align:left}.tot{margin-top:20px;text-align:right;font-size:16px}.tot b{font-size:20px}.mut{color:#555}</style>
  </head><body><h1>FACTURA ${opts.number}</h1><p class="mut">${opts.date}</p>
  <p><b>${opts.sellerName}</b><br>${opts.sellerPhone}<br>${opts.sellerEmail}</p>
  <p><b>Cliente:</b> ${opts.clientName}<br>${opts.clientPhone}<br>${opts.clientEmail}</p>
  <table><tr><th>Concepto</th><th style="text-align:center">Cant.</th><th style="text-align:right">Precio</th><th style="text-align:right">Importe</th></tr>${rows}</table>
  <div class="tot"><p>Subtotal: ${money(t.sub)}</p><p>Impuesto (${opts.taxRate}%): ${money(t.tax)}</p><p><b>Total: ${money(t.total)}</b></p></div>
  ${opts.notes ? `<p><b>Notas:</b> ${opts.notes}</p>` : ""}
  <p class="mut">Gracias por su negocio.</p></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

/* ------------------------------------------------------------------ */
/* Calculadora de materiales: costo -> precio sugerido con margen.     */
/* ------------------------------------------------------------------ */

type MatRow = { material: string; qty: number; unitCost: number };

function MaterialsCalculator({ onUsePrice }: { onUsePrice: (desc: string, amount: number, qty: number) => void }) {
  const [rows, setRows] = useState<MatRow[]>([{ material: "", qty: 1, unitCost: 0 }]);
  const [labor, setLabor] = useState(0);
  const [other, setOther] = useState(0);
  const [units, setUnits] = useState(1);
  const [margin, setMargin] = useState(40);

  const matCost = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unitCost) || 0), 0);
  const totalCost = matCost + (Number(labor) || 0) + (Number(other) || 0);
  const suggested = totalCost * (1 + (Number(margin) || 0) / 100);
  const perUnit = suggested / Math.max(1, Number(units) || 1);

  const setRow = (i: number, patch: Partial<MatRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Panel
      title="Calculadora de materiales"
      badge={
        <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
          Costos
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        Suma lo que cuesta producir (camisetas, estampado, tinta, etc.), agrega
        mano de obra y otros gastos, y te da el precio sugerido con tu margen.
        Con un clic lo pasas como concepto a la factura de abajo.
      </p>

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-6 gap-2 sm:grid-cols-12">
            <input aria-label="Material" className={`${inputCls} col-span-6`} placeholder="Material (p. ej. Camiseta Bella+Canvas)" value={r.material} onChange={(e) => setRow(i, { material: e.target.value })} autoComplete="off" />
            <input className={`${inputCls} col-span-2`} type="number" min="0" step="1" placeholder="Cant." value={r.qty} onChange={(e) => setRow(i, { qty: Number(e.target.value) })} aria-label="Cantidad" />
            <input className={`${inputCls} col-span-3`} type="number" min="0" step="0.01" placeholder="Costo c/u" value={r.unitCost} onChange={(e) => setRow(i, { unitCost: Number(e.target.value) })} aria-label="Costo unitario" />
            <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length === 1} className="col-span-1 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30" aria-label="Quitar material">×</button>
          </div>
        ))}
        <button type="button" onClick={() => setRows((rs) => [...rs, { material: "", qty: 1, unitCost: 0 }])} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
          + Agregar material
        </button>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-xs text-zinc-500">Mano de obra ($)
            <input className={`${inputCls} mt-1`} type="number" min="0" step="0.01" value={labor} onChange={(e) => setLabor(Number(e.target.value))} />
          </label>
          <label className="text-xs text-zinc-500">Otros gastos ($)
            <input className={`${inputCls} mt-1`} type="number" min="0" step="0.01" value={other} onChange={(e) => setOther(Number(e.target.value))} />
          </label>
          <label className="text-xs text-zinc-500">Unidades a producir
            <input className={`${inputCls} mt-1`} type="number" min="1" step="1" value={units} onChange={(e) => setUnits(Number(e.target.value))} />
          </label>
        </div>
        <label className="block text-xs text-zinc-500">Margen deseado (%)
          <input className={`${inputCls} mt-1`} type="number" min="0" step="1" value={margin} onChange={(e) => setMargin(Number(e.target.value))} />
        </label>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm leading-relaxed text-zinc-200">
        <p>Costo de materiales: <b>{money(matCost)}</b></p>
        <p>Costo total: <b>{money(totalCost)}</b></p>
        <p>Precio sugerido ({margin}% margen): <b className="text-emerald-400">{money(suggested)}</b>
          {units > 1 && <> · {money(perUnit)} por unidad</>}
        </p>
        <button
          type="button"
          onClick={() => onUsePrice("Producción (materiales + mano de obra)", Math.round(suggested * 100) / 100, 1)}
          disabled={suggested <= 0}
          className="mt-3 w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
        >
          Usar precio sugerido en la factura ↓
        </button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Generador de facturas + lista guardada.                             */
/* ------------------------------------------------------------------ */

function InvoiceGenerator({ isAdmin }: { isAdmin: boolean }) {
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [saved, setSaved] = useState<Invoice[] | null>(null);
  const [sellerName, setSellerName] = useState("Rubén Navarrete");
  const [sellerPhone, setSellerPhone] = useState("(562) 317-9226");
  const [sellerEmail, setSellerEmail] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [items, setItems] = useState<InvoiceItem[]>([emptyItem()]);
  const [taxRate, setTaxRate] = useState(0);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSaved(await api.listInvoices());
    } catch {
      setSaved([]);
    }
  }, []);

  useEffect(() => {
    load();
    api.listContacts().then(setContacts).catch(() => setContacts([]));
  }, [load]);

  const pickContact = (id: string) => {
    const c = contacts.find((x) => String(x.id) === id);
    if (!c) return;
    setClientName(c.name);
    setClientEmail(c.email || "");
    setClientPhone(c.phone || "");
  };

  const addFromCalculator = (desc: string, amount: number, qty: number) => {
    setItems((its) => {
      const clean = its.filter((it) => it.description.trim() !== "");
      return [...clean, { description: desc, qty, unit_price: amount }];
    });
    setMsg("Precio de la calculadora agregado a la factura. Revísalo antes de guardar.");
    document.getElementById("factura-form")?.scrollIntoView({ behavior: "smooth" });
  };

  const t = totals(items, taxRate);
  const validItems = items.filter((it) => it.description.trim() !== "" && it.qty > 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const inv = await api.createInvoice({
        client_name: clientName.trim(),
        client_email: clientEmail.trim(),
        client_phone: clientPhone.trim(),
        items: validItems,
        tax_rate: taxRate,
        notes,
      });
      setMsg(`Factura ${inv.number} guardada como borrador.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la factura.");
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (inv: Invoice, st: InvoiceStatus) => {
    try {
      await api.updateInvoiceStatus(inv.id, st);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el estado.");
    }
  };

  const remove = async (inv: Invoice) => {
    if (!window.confirm(`¿Borrar la factura ${inv.number}?`)) return;
    try {
      await api.deleteInvoice(inv.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar.");
    }
  };

  const printCurrent = () =>
    printInvoiceHtml({
      number: saved ? `BORRADOR` : "BORRADOR",
      date: new Date().toLocaleDateString("es-MX"),
      sellerName, sellerPhone, sellerEmail,
      clientName, clientEmail, clientPhone,
      items: validItems, taxRate, notes,
    });

  const printSaved = (inv: Invoice) =>
    printInvoiceHtml({
      number: inv.number,
      date: fmtDate(inv.created_at) ?? "",
      sellerName, sellerPhone, sellerEmail,
      clientName: inv.client_name, clientEmail: inv.client_email, clientPhone: inv.client_phone,
      items: inv.items, taxRate: inv.tax_rate, notes: inv.notes,
    });

  return (
    <div className="space-y-4">
      <MaterialsCalculator onUsePrice={addFromCalculator} />

      <div id="factura-form">
      <Panel
        title="Generador de facturas"
        badge={
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
            {saved === null ? "Cargando…" : `${saved.length} guardadas`}
          </span>
        }
      >
        <p className="mb-3 text-xs leading-relaxed text-zinc-500">
          Arma la factura, guárdala en la plataforma e imprímela o guárdala en
          PDF desde el navegador. El cliente puede elegirse del CRM o escribirse
          a mano. v1 solo registra facturas: no cobra tarjetas ni mueve dinero.
          {!isAdmin && " Tu rol de prueba es de solo lectura."}
        </p>

        {isAdmin && (
          <form onSubmit={save} className="space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input aria-label="Tu nombre / negocio" className={inputCls} placeholder="Tu nombre / negocio *" value={sellerName} onChange={(e) => setSellerName(e.target.value)} maxLength={200} />
              <input aria-label="Tu teléfono" className={inputCls} placeholder="Tu teléfono" value={sellerPhone} onChange={(e) => setSellerPhone(e.target.value)} maxLength={64} />
              <input aria-label="Tu email" className={inputCls} placeholder="Tu email" value={sellerEmail} onChange={(e) => setSellerEmail(e.target.value)} maxLength={200} />
            </div>
            {contacts.length > 0 && (
              <select className={inputCls} defaultValue="" onChange={(e) => pickContact(e.target.value)} aria-label="Cliente del CRM">
                <option value="">Cliente del CRM (opcional)…</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input aria-label="Cliente" className={inputCls} placeholder="Cliente *" value={clientName} onChange={(e) => setClientName(e.target.value)} required maxLength={200} />
              <input aria-label="Email del cliente" className={inputCls} placeholder="Email del cliente" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} maxLength={200} />
              <input aria-label="Teléfono del cliente" className={inputCls} placeholder="Teléfono del cliente" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} maxLength={64} />
            </div>

            <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Conceptos</p>
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-6 gap-2 sm:grid-cols-12">
                <input aria-label="Descripción" className={`${inputCls} col-span-6`} placeholder="Descripción" value={it.description} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} maxLength={200} autoComplete="off" />
                <input className={`${inputCls} col-span-2`} type="number" min="0" step="1" value={it.qty} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} aria-label="Cantidad" />
                <input className={`${inputCls} col-span-3`} type="number" min="0" step="0.01" value={it.unit_price} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, unit_price: Number(e.target.value) } : x)))} aria-label="Precio unitario" />
                <button type="button" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} disabled={items.length === 1} className="col-span-1 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30" aria-label="Quitar concepto">×</button>
              </div>
            ))}
            <button type="button" onClick={() => setItems((xs) => [...xs, emptyItem()])} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
              + Agregar concepto
            </button>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-xs text-zinc-500">Impuesto (%)
                <input className={`${inputCls} mt-1`} type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} />
              </label>
              <input aria-label="Notas (opcional)" className={inputCls} placeholder="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm leading-relaxed text-zinc-200">
              <p>Subtotal: <b>{money(t.sub)}</b></p>
              <p>Impuesto ({taxRate}%): <b>{money(t.tax)}</b></p>
              <p>Total: <b className="text-emerald-400">{money(t.total)}</b></p>
            </div>

            <div className="flex gap-2">
              <button type="submit" disabled={busy || !clientName.trim() || validItems.length === 0} className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                {busy ? "Guardando…" : "Guardar factura"}
              </button>
              <button type="button" onClick={printCurrent} disabled={validItems.length === 0 || !clientName.trim()} className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50">
                Imprimir / PDF
              </button>
            </div>
            {msg && <p className="text-sm text-emerald-400">{msg}</p>}
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          </form>
        )}

        <div className="mt-4 border-t border-zinc-800 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Facturas guardadas ({saved === null ? "…" : saved.length})
          </p>
          {saved === null ? (
            <p className="py-2 text-sm text-zinc-500">Cargando facturas…</p>
          ) : saved.length === 0 ? (
            <p className="py-2 text-sm text-zinc-500">Todavía no hay facturas guardadas.</p>
          ) : (
            <ul className="divide-y divide-zinc-800/70">
              {saved.map((inv) => {
                const it = totals(inv.items, inv.tax_rate);
                return (
                  <li key={inv.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-100">{inv.number}</span>
                      <span className="text-sm text-zinc-400">{inv.client_name}</span>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">{STATUS_LABEL[inv.status]}</span>
                      <span className="text-sm font-semibold text-emerald-400">{money(it.total)}</span>
                      <span className="ml-auto flex items-center gap-2">
                        <span className="text-xs text-zinc-600">{fmtDate(inv.created_at)}</span>
                        <button onClick={() => printSaved(inv)} className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800">
                          Imprimir
                        </button>
                        {isAdmin && (
                          <>
                            <select
                              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
                              value={inv.status}
                              onChange={(e) => changeStatus(inv, e.target.value as InvoiceStatus)}
                              aria-label="Estado de la factura"
                            >
                              {(Object.keys(STATUS_LABEL) as InvoiceStatus[]).map((s) => (
                                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                              ))}
                            </select>
                            <button onClick={() => remove(inv)} className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50">
                              Borrar
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Panel>
      </div>
    </div>
  );
}

export function FacturasPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  return <InvoiceGenerator isAdmin={isAdmin} />;
}
