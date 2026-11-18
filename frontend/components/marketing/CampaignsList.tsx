// Campañas de marketing general (NEST, 2026-11-17). Son campañas con
// canal, presupuesto y gasto — NO son las campañas de referidos
// (ReferidosPanel), que no se tocan.
"use client";

import { useState } from "react";
import {
  api, ApiError,
  type CrmContact, type MarketingCampaign, type MarketingCampaignInput,
  type MarketingCampaignStatus, type MarketingChannel,
} from "../../lib/api";
import { Panel } from "../Panel";
import { ApiErrorBanner, Field, useConfirm } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";
import { formatDate, formatMoney } from "../../lib/format";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

const CHANNELS: MarketingChannel[] = ["instagram", "threads", "facebook", "google", "otro"];
const STATUSES: MarketingCampaignStatus[] = ["borrador", "activa", "pausada", "finalizada"];

function statusCls(status: MarketingCampaignStatus): string {
  switch (status) {
    case "activa": return "bg-emerald-500/15 text-emerald-300";
    case "pausada": return "bg-amber-500/15 text-amber-300";
    case "finalizada": return "bg-zinc-500/15 text-zinc-400";
    default: return "bg-sky-500/15 text-sky-300";
  }
}

export function CampaignsList({ isAdmin }: { isAdmin: boolean }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const { confirm, dialog } = useConfirm(t);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MarketingCampaign | null>(null);
  const [contacts, setContacts] = useState<CrmContact[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<MarketingChannel>("instagram");
  const [status, setStatus] = useState<MarketingCampaignStatus>("borrador");
  const [budget, setBudget] = useState("");
  const [spend, setSpend] = useState("");
  const [contactId, setContactId] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useAsyncLoad<MarketingCampaign[]>(
    (signal) =>
      api.listCampaigns(statusFilter ? { status: statusFilter } : undefined, { signal }),
    [statusFilter],
  );
  const campaigns = load.data ?? [];

  const channelLabel = (c: MarketingChannel) =>
    c === "instagram" ? t.citas.channelInstagram
    : c === "threads" ? t.citas.channelThreads
    : c === "facebook" ? t.citas.channelFacebook
    : c === "google" ? t.citas.channelGoogle
    : t.citas.channelOtro;

  const statusLabel = (s: MarketingCampaignStatus) =>
    s === "borrador" ? t.citas.campaignBorrador
    : s === "activa" ? t.citas.campaignActiva
    : s === "pausada" ? t.citas.campaignPausada
    : t.citas.campaignFinalizada;

  const openForm = async (c?: MarketingCampaign) => {
    setMsg(null);
    setActionError(null);
    setFormError(null);
    setEditing(c ?? null);
    setName(c?.name ?? "");
    setChannel(c?.channel ?? "instagram");
    setStatus(c?.status ?? "borrador");
    setBudget(c?.budget !== null && c?.budget !== undefined ? String(c.budget) : "");
    setSpend(c?.spend !== null && c?.spend !== undefined ? String(c.spend) : "0");
    setContactId(c?.contact_id ? String(c.contact_id) : "");
    setStartsOn(c?.starts_on ?? "");
    setEndsOn(c?.ends_on ?? "");
    setNotes(c?.notes ?? "");
    if (!contacts) {
      try {
        setContacts(await api.listContacts());
      } catch {
        setContacts([]);
      }
    }
    setShowForm(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setFormError(t.citas.errSaveCampaign);
      return;
    }
    const budgetNum = budget.trim() === "" ? null : Number(budget);
    const spendNum = spend.trim() === "" ? 0 : Number(spend);
    if ((budgetNum !== null && (!Number.isFinite(budgetNum) || budgetNum < 0)) || !Number.isFinite(spendNum) || spendNum < 0) {
      setFormError(t.citas.errSaveCampaign);
      return;
    }
    setBusy(true);
    try {
      const body: MarketingCampaignInput = {
        name: name.trim(),
        channel,
        status,
        budget: budgetNum,
        spend: spendNum,
        contact_id: contactId ? Number(contactId) : null,
        starts_on: startsOn || null,
        ends_on: endsOn || null,
        notes: notes.trim(),
      };
      if (editing) {
        await api.updateCampaign(editing.id, body);
        setMsg(t.citas.msgCampaignUpdated);
      } else {
        await api.createCampaign(body);
        setMsg(t.citas.msgCampaignCreated);
      }
      setShowForm(false);
      setEditing(null);
      load.reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.citas.errSaveCampaign);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: MarketingCampaign) => {
    if (!(await confirm(t.citas.confirmDeleteCampaign.replace("{nombre}", c.name)))) return;
    setActionError(null);
    setMsg(null);
    try {
      await api.deleteCampaign(c.id);
      setMsg(t.citas.msgCampaignDeleted);
      load.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t.citas.errDeleteCampaign);
    }
  };

  return (
    <>
      {dialog}
      <Panel title={t.citas.campaignsTitle} badge={<span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">{campaigns.length}</span>}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Field label={t.citas.campaignStatusAria} className="min-w-[180px] flex-1">
            <select aria-label={t.citas.campaignStatusAria} className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t.citas.allStatuses}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </Field>
          {isAdmin && (
            <button
              type="button"
              onClick={() => openForm()}
              className="min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {t.citas.newCampaign}
            </button>
          )}
        </div>

        {load.loading ? (
          <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.citas.loadingCampaigns}</p>
        ) : load.error ? (
          <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
        ) : campaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-center">
            <p className="text-sm text-zinc-400">{t.citas.emptyCampaigns}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {campaigns.map((c) => (
              <li key={c.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{c.name}</p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {channelLabel(c.channel)}
                      {c.contact_name ? ` · ${c.contact_name}` : ""}
                      {c.starts_on ? ` · ${formatDate(c.starts_on, locale) ?? ""}` : ""}
                      {c.ends_on ? ` → ${formatDate(c.ends_on, locale) ?? ""}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-zinc-300">
                      {t.citas.spendLabel}: {formatMoney(c.spend, "USD", locale)}
                      {c.budget !== null && c.budget !== "" ? ` / ${t.citas.budgetLabel}: ${formatMoney(c.budget, "USD", locale)}` : ` · ${t.citas.noBudget}`}
                    </p>
                    {c.notes && <p className="mt-1 text-xs text-zinc-400">{c.notes}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusCls(c.status)}`}>{statusLabel(c.status)}</span>
                </div>
                {isAdmin && (
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => openForm(c)} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200">{t.citas.editCampaign}</button>
                    <button type="button" onClick={() => remove(c)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-2 text-xs text-red-400">{t.citas.delete}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {msg && <p className="mt-3 text-sm text-emerald-400">{msg}</p>}
        {actionError && <p role="alert" className="mt-3 text-sm text-red-400">{actionError}</p>}

        {showForm && isAdmin && (
          <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <p className="text-sm font-semibold text-zinc-200">{editing ? t.citas.editCampaign : t.citas.newCampaign}</p>
            <Field label={t.citas.campaignNameAria}>
              <input aria-label={t.citas.campaignNameAria} className={inputCls} placeholder={t.citas.campaignNamePlaceholder} value={name} onChange={(e) => setName(e.target.value)} required maxLength={128} autoComplete="off" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.citas.channelAria}>
                <select aria-label={t.citas.channelAria} className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value as MarketingChannel)}>
                  {CHANNELS.map((ch) => (
                    <option key={ch} value={ch}>{channelLabel(ch)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t.citas.campaignStatusAria}>
                <select aria-label={t.citas.campaignStatusAria} className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as MarketingCampaignStatus)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{statusLabel(s)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.citas.budgetAria}>
                <input aria-label={t.citas.budgetAria} type="number" min={0} step="0.01" className={inputCls} value={budget} onChange={(e) => setBudget(e.target.value)} />
              </Field>
              <Field label={t.citas.spendAria}>
                <input aria-label={t.citas.spendAria} type="number" min={0} step="0.01" className={inputCls} value={spend} onChange={(e) => setSpend(e.target.value)} />
              </Field>
            </div>
            <Field label={t.citas.clientAria}>
              <select aria-label={t.citas.clientAria} className={inputCls} value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">{t.citas.clientOption}</option>
                {(contacts ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.citas.startsOnAria}>
                <input aria-label={t.citas.startsOnAria} type="date" className={inputCls} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
              </Field>
              <Field label={t.citas.endsOnAria}>
                <input aria-label={t.citas.endsOnAria} type="date" className={inputCls} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
              </Field>
            </div>
            <Field label={t.citas.campaignNotesAria}>
              <textarea aria-label={t.citas.campaignNotesAria} className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {formError && <p role="alert" className="text-sm text-red-400">{formError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="min-h-[44px] flex-1 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50">
                {busy ? t.citas.saving : t.citas.saveCampaign}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
                {t.citas.cancelBtn}
              </button>
            </div>
          </form>
        )}
      </Panel>
    </>
  );
}
