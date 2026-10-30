"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type CrmContact, type Invoice, type InvoiceItem, type InvoiceStatus, type MeResponse,
} from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtDate = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : null;

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
  txt: {
    title: string; heading: string; concept: string; qty: string; price: string;
    amount: string; subtotal: string; tax: string; total: string; client: string;
    notes: string; thanks: string;
  };
}) {
  const t = totals(opts.items, opts.taxRate);
  const rows = opts.items
    .map(
      (it) => `<tr><td>${it.description}</td><td style="text-align:center">${it.qty}</td><td style="text-align:right">${money(it.unit_price)}</td><td style="text-align:right">${money(it.qty * it.unit_price)}</td></tr>`
    )
    .join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${opts.txt.title} ${opts.number}</title>
  <style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#111}h1{font-size:28px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border-bottom:1px solid #ccc;padding:8px;text-align:left}.tot{margin-top:20px;text-align:right;font-size:16px}.tot b{font-size:20px}.mut{color:#555}</style>
  </head><body><h1>${opts.txt.heading} ${opts.number}</h1><p class="mut">${opts.date}</p>
  <p><b>${opts.sellerName}</b><br>${opts.sellerPhone}<br>${opts.sellerEmail}</p>
  <p><b>${opts.txt.client}</b> ${opts.clientName}<br>${opts.clientPhone}<br>${opts.clientEmail}</p>
  <table><tr><th>${opts.txt.concept}</th><th style="text-align:center">${opts.txt.qty}</th><th style="text-align:right">${opts.txt.price}</th><th style="text-align:right">${opts.txt.amount}</th></tr>${rows}</table>
  <div class="tot"><p>${opts.txt.subtotal} ${money(t.sub)}</p><p>${opts.txt.tax} (${opts.taxRate}%): ${money(t.tax)}</p><p><b>${opts.txt.total} ${money(t.total)}</b></p></div>
  ${opts.notes ? `<p><b>${opts.txt.notes}</b> ${opts.notes}</p>` : ""}
  <p class="mut">${opts.txt.thanks}</p></body></html>`;
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
  const { t } = useLanguage();
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
      title={t.facturas.calcTitle}
      badge={
        <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
          {t.facturas.costsBadge}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        {t.facturas.calcIntro}
      </p>

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-6 gap-2 sm:grid-cols-12">
            <input aria-label={t.facturas.materialAria} className={`${inputCls} col-span-6`} placeholder={t.facturas.materialPlaceholder} value={r.material} onChange={(e) => setRow(i, { material: e.target.value })} autoComplete="off" />
            <input className={`${inputCls} col-span-2`} type="number" min="0" step="1" placeholder={t.facturas.qtyPlaceholder} value={r.qty} onChange={(e) => setRow(i, { qty: Number(e.target.value) })} aria-label={t.facturas.qtyAria} />
            <input className={`${inputCls} col-span-3`} type="number" min="0" step="0.01" placeholder={t.facturas.unitCostPlaceholder} value={r.unitCost} onChange={(e) => setRow(i, { unitCost: Number(e.target.value) })} aria-label={t.facturas.unitCostAria} />
            <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length === 1} className="col-span-1 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30" aria-label={t.facturas.removeMaterialAria}>×</button>
          </div>
        ))}
        <button type="button" onClick={() => setRows((rs) => [...rs, { material: "", qty: 1, unitCost: 0 }])} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
          {t.facturas.addMaterial}
        </button>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-xs text-zinc-500">{t.facturas.laborLabel}
            <input className={`${inputCls} mt-1`} type="number" min="0" step="0.01" value={labor} onChange={(e) => setLabor(Number(e.target.value))} />
          </label>
          <label className="text-xs text-zinc-500">{t.facturas.otherLabel}
            <input className={`${inputCls} mt-1`} type="number" min="0" step="0.01" value={other} onChange={(e) => setOther(Number(e.target.value))} />
          </label>
          <label className="text-xs text-zinc-500">{t.facturas.unitsLabel}
            <input className={`${inputCls} mt-1`} type="number" min="1" step="1" value={units} onChange={(e) => setUnits(Number(e.target.value))} />
          </label>
        </div>
        <label className="block text-xs text-zinc-500">{t.facturas.marginLabel}
          <input className={`${inputCls} mt-1`} type="number" min="0" step="1" value={margin} onChange={(e) => setMargin(Number(e.target.value))} />
        </label>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm leading-relaxed text-zinc-200">
        <p>{t.facturas.matCost}<b>{money(matCost)}</b></p>
        <p>{t.facturas.totalCost}<b>{money(totalCost)}</b></p>
        <p>{t.facturas.suggestedPrice.replace("{margen}", String(margin))}<b className="text-emerald-400">{money(suggested)}</b>
          {units > 1 && <>{t.facturas.perUnit.replace("{precio}", money(perUnit))}</>}
        </p>
        <button
          type="button"
          onClick={() => onUsePrice(t.facturas.calcLineDesc, Math.round(suggested * 100) / 100, 1)}
          disabled={suggested <= 0}
          className="mt-3 w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
        >
          {t.facturas.usePrice}
        </button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Generador de facturas + lista guardada.                             */
/* ------------------------------------------------------------------ */

function InvoiceGenerator({ isAdmin }: { isAdmin: boolean }) {
  const { t: tt, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const STATUS_LABEL: Record<InvoiceStatus, string> = {
    borrador: tt.facturas.statusDraft,
    enviada: tt.facturas.statusSent,
    pagada: tt.facturas.statusPaid,
  };
  const printTxt = {
    title: tt.facturas.printTitle, heading: tt.facturas.printHeading,
    concept: tt.facturas.printConcept, qty: tt.facturas.printQty, price: tt.facturas.printPrice,
    amount: tt.facturas.printAmount, subtotal: tt.facturas.printSubtotal, tax: tt.facturas.printTax,
    total: tt.facturas.printTotal, client: tt.facturas.printClient, notes: tt.facturas.printNotes,
    thanks: tt.facturas.printThanks,
  };
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
    setMsg(tt.facturas.calcAdded);
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
      setMsg(tt.facturas.msgInvoiceSaved.replace("{numero}", inv.number));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tt.facturas.errSaveInvoice);
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (inv: Invoice, st: InvoiceStatus) => {
    try {
      await api.updateInvoiceStatus(inv.id, st);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tt.facturas.errChangeStatus);
    }
  };

  const remove = async (inv: Invoice) => {
    if (!window.confirm(tt.facturas.confirmDeleteInvoice.replace("{numero}", inv.number))) return;
    try {
      await api.deleteInvoice(inv.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tt.facturas.errDeleteInvoice);
    }
  };

  const printCurrent = () =>
    printInvoiceHtml({
      number: tt.facturas.draftLabel,
      date: new Date().toLocaleDateString(locale),
      sellerName, sellerPhone, sellerEmail,
      clientName, clientEmail, clientPhone,
      items: validItems, taxRate, notes, txt: printTxt,
    });

  const printSaved = (inv: Invoice) =>
    printInvoiceHtml({
      number: inv.number,
      date: fmtDate(inv.created_at, locale) ?? "",
      sellerName, sellerPhone, sellerEmail,
      clientName: inv.client_name, clientEmail: inv.client_email, clientPhone: inv.client_phone,
      items: inv.items, taxRate: inv.tax_rate, notes: inv.notes, txt: printTxt,
    });

  return (
    <div className="space-y-4">
      <MaterialsCalculator onUsePrice={addFromCalculator} />

      <div id="factura-form">
      <Panel
        title={tt.facturas.genTitle}
        badge={
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
            {saved === null ? tt.facturas.badgeLoading : tt.facturas.savedCount.replace("{n}", String(saved.length))}
          </span>
        }
      >
        <p className="mb-3 text-xs leading-relaxed text-zinc-500">
          {tt.facturas.genIntro}
          {!isAdmin && tt.facturas.genIntroViewer}
        </p>

        {isAdmin && (
          <form onSubmit={save} className="space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input aria-label={tt.facturas.sellerNameAria} className={inputCls} placeholder={tt.facturas.sellerNamePlaceholder} value={sellerName} onChange={(e) => setSellerName(e.target.value)} maxLength={200} />
              <input aria-label={tt.facturas.sellerPhoneAria} className={inputCls} placeholder={tt.facturas.sellerPhonePlaceholder} value={sellerPhone} onChange={(e) => setSellerPhone(e.target.value)} maxLength={64} />
              <input aria-label={tt.facturas.sellerEmailAria} className={inputCls} placeholder={tt.facturas.sellerEmailPlaceholder} value={sellerEmail} onChange={(e) => setSellerEmail(e.target.value)} maxLength={200} />
            </div>
            {contacts.length > 0 && (
              <select className={inputCls} defaultValue="" onChange={(e) => pickContact(e.target.value)} aria-label={tt.facturas.crmClientAria}>
                <option value="">{tt.facturas.crmClientOption}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input aria-label={tt.facturas.clientAria} className={inputCls} placeholder={tt.facturas.clientPlaceholder} value={clientName} onChange={(e) => setClientName(e.target.value)} required maxLength={200} />
              <input aria-label={tt.facturas.clientEmailAria} className={inputCls} placeholder={tt.facturas.clientEmailPlaceholder} value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} maxLength={200} />
              <input aria-label={tt.facturas.clientPhoneAria} className={inputCls} placeholder={tt.facturas.clientPhonePlaceholder} value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} maxLength={64} />
            </div>

            <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">{tt.facturas.conceptsHeading}</p>
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-6 gap-2 sm:grid-cols-12">
                <input aria-label={tt.facturas.descAria} className={`${inputCls} col-span-6`} placeholder={tt.facturas.descPlaceholder} value={it.description} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} maxLength={200} autoComplete="off" />
                <input className={`${inputCls} col-span-2`} type="number" min="0" step="1" value={it.qty} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} aria-label={tt.facturas.qtyAria} />
                <input className={`${inputCls} col-span-3`} type="number" min="0" step="0.01" value={it.unit_price} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, unit_price: Number(e.target.value) } : x)))} aria-label={tt.facturas.unitPriceAria} />
                <button type="button" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} disabled={items.length === 1} className="col-span-1 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30" aria-label={tt.facturas.removeConceptAria}>×</button>
              </div>
            ))}
            <button type="button" onClick={() => setItems((xs) => [...xs, emptyItem()])} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
              {tt.facturas.addConcept}
            </button>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-xs text-zinc-500">{tt.facturas.taxLabel}
                <input className={`${inputCls} mt-1`} type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} />
              </label>
              <input aria-label={tt.facturas.notesAria} className={inputCls} placeholder={tt.facturas.notesPlaceholder} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm leading-relaxed text-zinc-200">
              <p>{tt.facturas.subtotal}<b>{money(t.sub)}</b></p>
              <p>{tt.facturas.taxLine.replace("{tasa}", String(taxRate))}<b>{money(t.tax)}</b></p>
              <p>{tt.facturas.total}<b className="text-emerald-400">{money(t.total)}</b></p>
            </div>

            <div className="flex gap-2">
              <button type="submit" disabled={busy || !clientName.trim() || validItems.length === 0} className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                {busy ? tt.facturas.saving : tt.facturas.saveInvoice}
              </button>
              <button type="button" onClick={printCurrent} disabled={validItems.length === 0 || !clientName.trim()} className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50">
                {tt.facturas.printPdf}
              </button>
            </div>
            {msg && <p className="text-sm text-emerald-400">{msg}</p>}
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          </form>
        )}

        <div className="mt-4 border-t border-zinc-800 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {tt.facturas.savedHeading} ({saved === null ? "…" : saved.length})
          </p>
          {saved === null ? (
            <p className="py-2 text-sm text-zinc-500">{tt.facturas.loadingInvoices}</p>
          ) : saved.length === 0 ? (
            <p className="py-2 text-sm text-zinc-500">{tt.facturas.emptyInvoices}</p>
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
                        <span className="text-xs text-zinc-600">{fmtDate(inv.created_at, locale)}</span>
                        <button onClick={() => printSaved(inv)} className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800">
                          {tt.facturas.print}
                        </button>
                        {isAdmin && (
                          <>
                            <select
                              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
                              value={inv.status}
                              onChange={(e) => changeStatus(inv, e.target.value as InvoiceStatus)}
                              aria-label={tt.facturas.invoiceStatusAria}
                            >
                              {(Object.keys(STATUS_LABEL) as InvoiceStatus[]).map((s) => (
                                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                              ))}
                            </select>
                            <button onClick={() => remove(inv)} className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50">
                              {tt.facturas.delete}
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
