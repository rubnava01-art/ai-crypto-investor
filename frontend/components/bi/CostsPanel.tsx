// Registro manual de costos del admin (NEST, 2026-11-17). Persistente en
// el backend; NO reutiliza la calculadora de materiales de Facturas
// (estado local no persistente). Lista vacía al inicio.
"use client";

import { useState } from "react";
import {
  api, ApiError,
  type BusinessCost, type BusinessCostCategory,
} from "../../lib/api";
import { Panel } from "../Panel";
import { ApiErrorBanner, Field, useConfirm } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";
import { formatDate, formatMoney } from "../../lib/format";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

const CATEGORIES: BusinessCostCategory[] = ["publicidad", "herramientas", "servicios", "otro"];

export function CostsPanel({ isAdmin, range }: { isAdmin: boolean; range: { from: string; to: string } }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const { confirm, dialog } = useConfirm(t);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BusinessCost | null>(null);
  const [date, setDate] = useState("");
  const [category, setCategory] = useState<BusinessCostCategory>("publicidad");
  const [concept, setConcept] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useAsyncLoad<BusinessCost[]>(
    (signal) =>
      api.listCosts(
        { from: range.from || undefined, to: range.to || undefined, category: categoryFilter ? (categoryFilter as BusinessCostCategory) : undefined },
        { signal },
      ),
    [range.from, range.to, categoryFilter],
  );
  const costs = load.data ?? [];
  const total = costs.reduce((acc, c) => acc + Number(c.amount || 0), 0);

  const categoryLabel = (c: BusinessCostCategory) =>
    c === "publicidad" ? t.bi.catAds
    : c === "herramientas" ? t.bi.catTools
    : c === "servicios" ? t.bi.catServices
    : t.bi.catOther;

  const openForm = (cost?: BusinessCost) => {
    setMsg(null);
    setFormError(null);
    setEditing(cost ?? null);
    setDate(cost?.date ?? "");
    setCategory(cost?.category ?? "publicidad");
    setConcept(cost?.concept ?? "");
    setAmount(cost?.amount !== null && cost?.amount !== undefined ? String(cost.amount) : "");
    setNotes(cost?.notes ?? "");
    setShowForm(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const amt = Number(amount);
    if (!concept.trim() || !date || !Number.isFinite(amt) || amt < 0) {
      setFormError(t.bi.errSaveCost);
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await api.updateCost(editing.id, { date, category, concept: concept.trim(), amount: amt, notes: notes.trim() });
        setMsg(t.bi.msgCostUpdated);
      } else {
        await api.createCost({ date, category, concept: concept.trim(), amount: amt, notes: notes.trim() });
        setMsg(t.bi.msgCostCreated);
      }
      setShowForm(false);
      setEditing(null);
      load.reload();
    } catch (err) {
      setFormError(t.bi.errSaveCost);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (cost: BusinessCost) => {
    if (!(await confirm(t.bi.confirmDeleteCost.replace("{concepto}", cost.concept)))) return;
    setActionError(null);
    setMsg(null);
    try {
      await api.deleteCost(cost.id);
      setMsg(t.bi.msgCostDeleted);
      load.reload();
    } catch (err) {
      setActionError(t.bi.errDeleteCost);
    }
  };

  return (
    <>
      {dialog}
      <Panel
        title={t.bi.costsTitle}
        badge={<span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">{costs.length}</span>}
      >
        <p className="mb-3 text-xs text-zinc-400">
          {t.bi.sourceCosts.replace("{n}", String(costs.length))}
          {costs.length > 0 && ` · ${t.bi.totalCosts}: ${formatMoney(total, "USD", locale)}`}
        </p>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Field label={t.bi.categoryAria} className="min-w-[180px] flex-1">
            <select aria-label={t.bi.categoryAria} className={inputCls} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">{t.citas.allStatuses}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{categoryLabel(c)}</option>
              ))}
            </select>
          </Field>
          {isAdmin && (
            <button
              type="button"
              onClick={() => openForm()}
              className="min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {t.bi.newCost}
            </button>
          )}
        </div>

        {load.loading ? (
          <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.bi.loadingCosts}</p>
        ) : load.error ? (
          <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
        ) : costs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-center">
            <p className="text-sm text-zinc-400">{t.bi.emptyCosts}</p>
          </div>
        ) : (
          <>
            <ul className="space-y-3 sm:hidden">
              {costs.map((c) => (
                <li key={c.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{c.concept}</p>
                      <p className="mt-1 text-xs text-zinc-400">{categoryLabel(c.category)} · {formatDate(c.date, locale) ?? ""}</p>
                      {c.notes && <p className="mt-1 text-xs text-zinc-400">{c.notes}</p>}
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-zinc-100">{formatMoney(c.amount, "USD", locale)}</p>
                  </div>
                  {isAdmin && (
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => openForm(c)} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200">{t.bi.editCost}</button>
                      <button type="button" onClick={() => remove(c)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-2 text-xs text-red-400">{t.bi.delete}</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-400">
                    <th className="py-3 pr-3 font-semibold">{t.bi.costConceptAria}</th>
                    <th className="py-3 pr-3 font-semibold">{t.bi.categoryAria}</th>
                    <th className="py-3 pr-3 font-semibold">{t.bi.costDateAria}</th>
                    <th className="py-3 font-semibold">{t.bi.costAmountAria}</th>
                    <th className="py-3 font-semibold"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {costs.map((c) => (
                    <tr key={c.id} className="align-top">
                      <td className="py-3 pr-3 font-semibold text-zinc-100">{c.concept}</td>
                      <td className="py-3 pr-3 text-zinc-300">{categoryLabel(c.category)}</td>
                      <td className="py-3 pr-3 text-zinc-300">{formatDate(c.date, locale) ?? ""}</td>
                      <td className="py-3 text-zinc-100">{formatMoney(c.amount, "USD", locale)}</td>
                      <td className="py-3">
                        {isAdmin && (
                          <div className="flex gap-2 text-xs">
                            <button type="button" onClick={() => openForm(c)} className="min-h-[44px] text-zinc-300 hover:underline">{t.bi.edit}</button>
                            <button type="button" onClick={() => remove(c)} className="min-h-[44px] text-red-400 hover:underline">{t.bi.delete}</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-zinc-300">
              {t.bi.totalCosts}: <span className="font-semibold text-zinc-100">{formatMoney(total, "USD", locale)}</span>
              {` · ${t.bi.byCategory}: `}
              {Object.entries(
                costs.reduce<Record<string, number>>((acc, c) => {
                  acc[c.category] = (acc[c.category] ?? 0) + Number(c.amount || 0);
                  return acc;
                }, {}),
              )
                .map(([cat, v]) => `${categoryLabel(cat as BusinessCostCategory)} ${formatMoney(v, "USD", locale)}`)
                .join(" · ")}
            </p>
          </>
        )}

        {msg && <p className="mt-3 text-sm text-emerald-400">{msg}</p>}
        {actionError && <p role="alert" className="mt-3 text-sm text-red-400">{actionError}</p>}

        {showForm && isAdmin && (
          <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <p className="text-sm font-semibold text-zinc-200">{editing ? t.bi.editCost : t.bi.newCost}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.bi.costDateAria}>
                <input aria-label={t.bi.costDateAria} type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} required />
              </Field>
              <Field label={t.bi.categoryAria}>
                <select aria-label={t.bi.categoryAria} className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as BusinessCostCategory)}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{categoryLabel(c)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={t.bi.costConceptAria}>
              <input aria-label={t.bi.costConceptAria} className={inputCls} placeholder={t.bi.costConceptPlaceholder} value={concept} onChange={(e) => setConcept(e.target.value)} required maxLength={200} autoComplete="off" />
            </Field>
            <Field label={t.bi.costAmountAria}>
              <input aria-label={t.bi.costAmountAria} type="number" min={0} step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
            <Field label={t.bi.costNotesAria}>
              <textarea aria-label={t.bi.costNotesAria} className={inputCls} rows={2} placeholder={t.bi.costNotesPlaceholder} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {formError && <p role="alert" className="text-sm text-red-400">{formError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="min-h-[44px] flex-1 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50">
                {busy ? t.bi.saving : t.bi.saveCost}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
                {t.bi.cancel}
              </button>
            </div>
          </form>
        )}
      </Panel>
    </>
  );
}
