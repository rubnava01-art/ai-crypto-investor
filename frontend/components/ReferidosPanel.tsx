"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type CrmContact, type MeResponse, type Referral, type ReferralCampaign,
  type ReferralCampaignInput, type ReferralCampaignStatus, type ReferralInput,
  type ReferralRewardType, type ReferralStatus,
} from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";


const campaignBadge: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-300",
  paused: "bg-amber-500/15 text-amber-300",
  ended: "bg-zinc-500/15 text-zinc-400",
};

const referralBadge: Record<string, string> = {
  pending: "bg-sky-500/15 text-sky-300",
  confirmed: "bg-violet-500/15 text-violet-300",
  rewarded: "bg-emerald-500/15 text-emerald-300",
};


interface CampaignForm {
  name: string;
  business_contact_id: string;
  reward_type: ReferralRewardType;
  reward_value: string;
  reward_note: string;
  status: ReferralCampaignStatus;
}

const emptyCampaignForm: CampaignForm = {
  name: "",
  business_contact_id: "",
  reward_type: "fixed",
  reward_value: "",
  reward_note: "",
  status: "active",
};

interface ReferralForm {
  referrer_name: string;
  referrer_contact: string;
  referred_name: string;
  referred_contact: string;
  code: string;
  notes: string;
}

const emptyReferralForm: ReferralForm = {
  referrer_name: "",
  referrer_contact: "",
  referred_name: "",
  referred_contact: "",
  code: "",
  notes: "",
};

export function ReferidosPanel() {
  const { t } = useLanguage();
  const campaignStatuses: { value: ReferralCampaignStatus; label: string }[] = [
    { value: "active", label: t.referidos.campaignActive },
    { value: "paused", label: t.referidos.campaignPaused },
    { value: "ended", label: t.referidos.campaignEnded },
  ];
  const referralStatuses: { value: ReferralStatus; label: string }[] = [
    { value: "pending", label: t.referidos.referralPending },
    { value: "confirmed", label: t.referidos.referralConfirmed },
    { value: "rewarded", label: t.referidos.referralRewarded },
  ];
  const campaignStatusLabel = (s: string) => campaignStatuses.find((x) => x.value === s)?.label ?? s;
  const referralStatusLabel = (s: string) => referralStatuses.find((x) => x.value === s)?.label ?? s;
  const rewardLabel = (c: ReferralCampaign) =>
    c.reward_type === "percentage"
      ? t.referidos.rewardPercent.replace("{valor}", String(Number(c.reward_value)))
      : t.referidos.rewardFixedValue.replace("{valor}", String(Number(c.reward_value)));
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;

  const [campaigns, setCampaigns] = useState<ReferralCampaign[] | null>(null);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [referrals, setReferrals] = useState<Referral[] | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [campaignForm, setCampaignForm] = useState<CampaignForm>(emptyCampaignForm);
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);
  const [showReferralForm, setShowReferralForm] = useState(false);
  const [referralForm, setReferralForm] = useState<ReferralForm>(emptyReferralForm);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const loadCampaigns = useCallback(async () => {
    try {
      setCampaigns(await api.listReferralCampaigns());
    } catch {
      setCampaigns([]);
    }
  }, []);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    api.listContacts().then(setContacts).catch(() => setContacts([]));
  }, []);

  const selected = campaigns?.find((c) => c.id === selectedId) ?? null;

  const loadReferrals = useCallback(async () => {
    if (selectedId === null) {
      setReferrals(null);
      return;
    }
    try {
      setReferrals(await api.listReferrals(selectedId, statusFilter || undefined));
    } catch {
      setReferrals([]);
    }
  }, [selectedId, statusFilter]);

  useEffect(() => {
    loadReferrals();
  }, [loadReferrals]);

  const setC = (k: keyof CampaignForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setCampaignForm((f) => ({ ...f, [k]: e.target.value }));

  const setR = (k: keyof ReferralForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setReferralForm((f) => ({ ...f, [k]: e.target.value }));

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? `${err.message} (${err.status})` : t.referidos.errUnexpected);

  const submitCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    const body: ReferralCampaignInput = {
      name: campaignForm.name.trim(),
      business_contact_id: campaignForm.business_contact_id ? Number(campaignForm.business_contact_id) : null,
      reward_type: campaignForm.reward_type,
      reward_value: campaignForm.reward_value.trim() || "0",
      reward_note: campaignForm.reward_note.trim(),
      status: campaignForm.status,
    };
    try {
      if (editingCampaignId !== null) {
        await api.updateReferralCampaign(editingCampaignId, body);
        setMsg(t.referidos.msgCampaignUpdated);
      } else {
        const created = await api.createReferralCampaign(body);
        setMsg(t.referidos.msgCampaignCreated.replace("{codigo}", created.share_code));
        setSelectedId(created.id);
      }
      setCampaignForm(emptyCampaignForm);
      setEditingCampaignId(null);
      setShowCampaignForm(false);
      await loadCampaigns();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const startEditCampaign = (c: ReferralCampaign) => {
    setEditingCampaignId(c.id);
    setCampaignForm({
      name: c.name,
      business_contact_id: c.business_contact_id ? String(c.business_contact_id) : "",
      reward_type: c.reward_type,
      reward_value: c.reward_value,
      reward_note: c.reward_note,
      status: c.status,
    });
    setShowCampaignForm(true);
    setMsg(null);
    setError(null);
  };

  const setCampaignStatus = async (c: ReferralCampaign, next: ReferralCampaignStatus) => {
    setBusy(true);
    setError(null);
    try {
      await api.updateReferralCampaign(c.id, { name: c.name, status: next });
      await loadCampaigns();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const submitReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedId === null) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    const body: ReferralInput = {
      referrer_name: referralForm.referrer_name.trim(),
      referrer_contact: referralForm.referrer_contact.trim(),
      referred_name: referralForm.referred_name.trim(),
      referred_contact: referralForm.referred_contact.trim(),
      code: referralForm.code.trim() || undefined,
      notes: referralForm.notes.trim(),
    };
    try {
      await api.registerReferral(selectedId, body);
      setMsg(t.referidos.msgReferralRegistered);
      setReferralForm(emptyReferralForm);
      setShowReferralForm(false);
      await loadReferrals();
      await loadCampaigns();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const advanceReferral = async (r: Referral, next: ReferralStatus) => {
    setBusy(true);
    setError(null);
    try {
      await api.updateReferralStatus(r.id, next);
      await loadReferrals();
      await loadCampaigns();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const copyShareCode = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.share_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t.referidos.errCopy.replace("{codigo}", selected.share_code));
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-700/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        {t.referidos.banner1}<strong>{t.referidos.bannerStrong}</strong>{t.referidos.banner2}
      </div>

      {msg && <div className="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{msg}</div>}
      {error && <div role="alert" className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      <Panel title={t.referidos.panelCampaigns}>
        {isAdmin && !showCampaignForm && (
          <button
            onClick={() => { setShowCampaignForm(true); setEditingCampaignId(null); setCampaignForm(emptyCampaignForm); }}
            className="mb-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            {t.referidos.newCampaign}
          </button>
        )}
        {isAdmin && showCampaignForm && (
          <form onSubmit={submitCampaign} className="mb-6 space-y-3 rounded-lg border border-zinc-700 p-4">
            <input aria-label={t.referidos.campaignNameAria} className={inputCls} placeholder={t.referidos.campaignNamePlaceholder} value={campaignForm.name} onChange={setC("name")} required />
            <label className="block text-sm text-zinc-400">
              {t.referidos.businessLabel}
              <select className={inputCls} value={campaignForm.business_contact_id} onChange={setC("business_contact_id")}>
                <option value="">{t.referidos.noContact}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-zinc-400">
                {t.referidos.rewardTypeLabel}
                <select className={inputCls} value={campaignForm.reward_type} onChange={setC("reward_type")}>
                  <option value="fixed">{t.referidos.rewardFixed}</option>
                  <option value="percentage">{t.referidos.rewardPercentage}</option>
                </select>
              </label>
              <label className="block text-sm text-zinc-400">
                {campaignForm.reward_type === "percentage" ? t.referidos.rewardPercentLabel : t.referidos.rewardAmountLabel}
                <input className={inputCls} type="number" min="0" max={campaignForm.reward_type === "percentage" ? 100 : undefined} step="any" value={campaignForm.reward_value} onChange={setC("reward_value")} />
              </label>
            </div>
            <input aria-label={t.referidos.rewardNoteAria} className={inputCls} placeholder={t.referidos.rewardNotePlaceholder} value={campaignForm.reward_note} onChange={setC("reward_note")} />
            <label className="block text-sm text-zinc-400">
              {t.referidos.statusLabel}
              <select className={inputCls} value={campaignForm.status} onChange={setC("status")}>
                {campaignStatuses.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {editingCampaignId !== null ? t.referidos.saveChanges : t.referidos.createCampaign}
              </button>
              <button type="button" onClick={() => { setShowCampaignForm(false); setEditingCampaignId(null); }} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300">
                {t.referidos.cancel}
              </button>
            </div>
          </form>
        )}

        {campaigns === null && <p className="text-sm text-zinc-400">{t.referidos.loadingCampaigns}</p>}
        {campaigns !== null && campaigns.length === 0 && (
          <p className="text-sm text-zinc-400">{t.referidos.emptyCampaigns}</p>
        )}
        <ul className="space-y-3">
          {campaigns?.map((c) => (
            <li key={c.id} className={`rounded-lg border p-4 ${selectedId === c.id ? "border-emerald-600 bg-zinc-900" : "border-zinc-800"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <button onClick={() => setSelectedId(c.id)} className="text-left font-semibold text-zinc-100 hover:text-emerald-300">
                    {c.name}
                  </button>
                  <p className="text-sm text-zinc-400">
                    {t.referidos.rewardPrefix}{rewardLabel(c)}
                    {c.reward_note ? ` — ${c.reward_note}` : ""}
                    {c.business_name ? t.referidos.businessSuffix.replace("{nombre}", c.business_name) : ""}
                  </p>
                  <p className="text-sm text-zinc-400">
                    {t.referidos.shareCode}<span className="font-mono font-semibold text-emerald-300">{c.share_code}</span>
                    {t.referidos.countsLine.replace("{referidos}", String(c.referrals_count)).replace("{confirmados}", String(c.confirmed_count)).replace("{recompensados}", String(c.rewarded_count))}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${campaignBadge[c.status]}`}>{campaignStatusLabel(c.status)}</span>
                  {isAdmin && (
                    <>
                      <button onClick={() => startEditCampaign(c)} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300">{t.referidos.edit}</button>
                      {c.status === "active" && (
                        <button onClick={() => setCampaignStatus(c, "paused")} disabled={busy} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300">{t.referidos.pause}</button>
                      )}
                      {c.status === "paused" && (
                        <button onClick={() => setCampaignStatus(c, "active")} disabled={busy} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300">{t.referidos.resume}</button>
                      )}
                      {c.status !== "ended" && (
                        <button onClick={() => setCampaignStatus(c, "ended")} disabled={busy} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300">{t.referidos.end}</button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {selected && (
        <Panel title={t.referidos.selectedTitle.replace("{nombre}", selected.name)}>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <p className="text-sm text-zinc-300">
              {t.referidos.shareWithClients}
              <span className="font-mono text-lg font-bold text-emerald-300">{selected.share_code}</span>
            </p>
            <button onClick={copyShareCode} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300">
              {copied ? t.referidos.copied : t.referidos.copyCode}
            </button>
            <label className="ml-auto flex items-center gap-2 text-sm text-zinc-400">
              {t.referidos.statusLabel}
              <select className={inputCls} style={{ width: "auto" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">{t.referidos.allFilter}</option>
                {referralStatuses.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
          </div>

          {isAdmin && selected.status === "active" && !showReferralForm && (
            <button onClick={() => setShowReferralForm(true)} className="mb-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
              {t.referidos.registerReferral}
            </button>
          )}
          {isAdmin && selected.status !== "active" && (
            <p className="mb-4 text-sm text-amber-300">{t.referidos.campaignInactive.replace("{estado}", campaignStatusLabel(selected.status).toLowerCase())}</p>
          )}
          {isAdmin && showReferralForm && (
            <form onSubmit={submitReferral} className="mb-6 space-y-3 rounded-lg border border-zinc-700 p-4">
              <div className="grid grid-cols-2 gap-3">
                <input aria-label={t.referidos.referrerNameAria} className={inputCls} placeholder={t.referidos.referrerNamePlaceholder} value={referralForm.referrer_name} onChange={setR("referrer_name")} required />
                <input aria-label={t.referidos.referrerContactAria} className={inputCls} placeholder={t.referidos.referrerContactPlaceholder} value={referralForm.referrer_contact} onChange={setR("referrer_contact")} />
                <input aria-label={t.referidos.referredNameAria} className={inputCls} placeholder={t.referidos.referredNamePlaceholder} value={referralForm.referred_name} onChange={setR("referred_name")} required />
                <input aria-label={t.referidos.referredContactAria} className={inputCls} placeholder={t.referidos.referredContactPlaceholder} value={referralForm.referred_contact} onChange={setR("referred_contact")} />
              </div>
              <input aria-label={t.referidos.codeAria} className={inputCls} placeholder={t.referidos.codePlaceholder.replace("{codigo}", selected.share_code)} value={referralForm.code} onChange={setR("code")} />
              <input aria-label={t.referidos.notesAria} className={inputCls} placeholder={t.referidos.notesPlaceholder} value={referralForm.notes} onChange={setR("notes")} />
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t.referidos.register}</button>
                <button type="button" onClick={() => setShowReferralForm(false)} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300">{t.referidos.cancel}</button>
              </div>
            </form>
          )}

          {referrals === null && <p className="text-sm text-zinc-400">{t.referidos.loadingReferrals}</p>}
          {referrals !== null && referrals.length === 0 && (
            <p className="text-sm text-zinc-400">{t.referidos.emptyReferrals}</p>
          )}
          <ul className="space-y-3">
            {referrals?.map((r) => (
              <li key={r.id} className="rounded-lg border border-zinc-800 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-zinc-100">
                      {r.referrer_name} <span className="font-normal text-zinc-500">{t.referidos.referredBy}</span> {r.referred_name}
                    </p>
                    <p className="text-sm text-zinc-400">
                      {t.referidos.codePrefix}<span className="font-mono text-zinc-300">{r.code}</span>
                      {r.referrer_contact ? t.referidos.referrerSuffix.replace("{contacto}", r.referrer_contact) : ""}
                      {r.referred_contact ? t.referidos.referredSuffix.replace("{contacto}", r.referred_contact) : ""}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${referralBadge[r.status]}`}>{referralStatusLabel(r.status)}</span>
                    {isAdmin && r.status === "pending" && (
                      <button onClick={() => advanceReferral(r, "confirmed")} disabled={busy} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300">{t.referidos.confirmClient}</button>
                    )}
                    {isAdmin && r.status === "confirmed" && (
                      <button onClick={() => advanceReferral(r, "rewarded")} disabled={busy} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300">{t.referidos.markReward}</button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
