// Shell del Nest Client Portal (NEST, 2026-11-17).
// Dos vistas: cliente vinculado → solo sus datos; admin → selector de
// cliente + vista previa etiquetada con ?contact_id=. Cliente no vinculado
// → pantalla propia (403 del servidor, no lista vacía genérica).
// El portal usa SOLO endpoints /api/business/marketing/portal/*.
"use client";

import { useRef, useState } from "react";
import {
  api, ApiError,
  type AdminUser, type MeResponse, type PortalMeResponse, type PortalVinculo,
} from "../../lib/api";
import { Panel } from "../Panel";
import { EmptyState } from "../badges";
import { ApiErrorBanner, Field, useConfirm } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";
import { PortalCampaigns } from "./PortalCampaigns";
import { PortalInvoices } from "./PortalInvoices";
import { PortalTasks } from "./PortalTasks";
import { PortalReports } from "./PortalReports";
import { PortalMetrics } from "./PortalMetrics";
import { PortalClientPicker } from "./PortalClientPicker";
import { AppointmentsPanel } from "../marketing/AppointmentsPanel";
import { BrandBriefTab } from "../content/BrandBriefTab";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

type Tab = "campanas" | "facturas" | "tareas" | "reportes" | "metricas" | "citas" | "brief" | "vinculos";

function VinculosManager() {
  const { t } = useLanguage();
  const { confirm, dialog } = useConfirm(t);
  const [userId, setUserId] = useState("");
  const [contactId, setContactId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Ref al selector de usuario: el EmptyState "Vincular cliente" enfoca
  // el formulario de vínculo en vez de dejar una frase.
  const userSelectRef = useRef<HTMLSelectElement | null>(null);

  const load = useAsyncLoad<{ vinculos: PortalVinculo[]; users: AdminUser[] }>(
    async (signal) => {
      const [vinculos, users] = await Promise.all([
        api.listVinculos({ signal }),
        api.listUsers(),
      ]);
      return { vinculos, users };
    },
    [],
  );
  const vinculos = load.data?.vinculos ?? [];
  const users = load.data?.users ?? [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!userId || !contactId) {
      setFormError(t.portal.errLink);
      return;
    }
    setBusy(true);
    try {
      await api.createVinculo({ user_id: Number(userId), contact_id: Number(contactId) });
      setMsg(t.portal.msgLinked);
      setUserId("");
      setContactId("");
      load.reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.portal.errLink);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (v: PortalVinculo) => {
    if (!(await confirm(t.portal.confirmUnlink.replace("{nombre}", v.name)))) return;
    setActionError(null);
    setMsg(null);
    try {
      await api.deleteVinculo(v.id);
      setMsg(t.portal.msgUnlinked);
      load.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t.portal.errUnlink);
    }
  };

  return (
    <>
      {dialog}
      <Panel title={t.portal.linksTitle}>
        <p className="mb-3 text-xs leading-relaxed text-zinc-400">{t.portal.linksIntro}</p>
        {load.loading ? (
          <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.portal.loading}</p>
        ) : load.error ? (
          <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
        ) : (
          <>
            {vinculos.length === 0 ? (
              <EmptyState
                text={t.portal.emptyLinks}
                actionLabel={t.portal.linkClient}
                onAction={() => {
                  userSelectRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                  userSelectRef.current?.focus();
                }}
              />
            ) : (
              <ul className="space-y-2">
                {vinculos.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{v.name}</p>
                      <p className="text-xs text-zinc-400">
                        {v.user_id ? `${t.portal.linked}: ${users.find((u) => u.id === v.user_id)?.username ?? v.user_id}` : t.portal.notLinked}
                      </p>
                    </div>
                    {v.user_id && (
                      <button type="button" onClick={() => unlink(v)} className="min-h-[44px] shrink-0 rounded-lg border border-red-900/60 px-3 py-2 text-xs text-red-400">{t.portal.unlink}</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t.portal.userAria}>
                  <select aria-label={t.portal.userAria} ref={userSelectRef} className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)}>
                    <option value="">{t.portal.userAria}…</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
                    ))}
                  </select>
                </Field>
                <Field label={t.portal.contactAria}>
                  <select aria-label={t.portal.contactAria} className={inputCls} value={contactId} onChange={(e) => setContactId(e.target.value)}>
                    <option value="">{t.portal.contactAria}…</option>
                    {vinculos.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </Field>
              </div>
              {formError && <p role="alert" className="text-sm text-red-400">{formError}</p>}
              <button type="submit" disabled={busy || !userId || !contactId} className="min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50">
                {busy ? t.citas.saving : t.portal.linkButton}
              </button>
            </form>
            {msg && <p className="mt-3 text-sm text-emerald-400">{msg}</p>}
            {actionError && <p role="alert" className="mt-3 text-sm text-red-400">{actionError}</p>}
          </>
        )}
      </Panel>
    </>
  );
}

export function ClientPortalPanel({ me, isAdmin }: { me: MeResponse | null; isAdmin: boolean }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>("campanas");
  const [previewId, setPreviewId] = useState<number | null>(null);

  // Cliente: su propia ficha (el servidor deriva el contacto del vínculo).
  // Admin: no carga /portal/me propio; usa la vista previa.
  const meLoad = useAsyncLoad<PortalMeResponse | null>(
    (signal) => (isAdmin ? Promise.resolve(null) : api.getPortalMe(undefined, { signal })),
    [isAdmin],
  );
  const previewLoad = useAsyncLoad<PortalMeResponse | null>(
    (signal) => (isAdmin && previewId ? api.getPortalMe(previewId, { signal }) : Promise.resolve(null)),
    [isAdmin, previewId],
  );

  const ownContact = meLoad.data?.contact ?? null;
  const previewContact = previewLoad.data?.contact ?? null;
  const contact = isAdmin ? previewContact : ownContact;
  const contactId = isAdmin ? (previewId ?? undefined) : undefined;

  const notLinked = !isAdmin && meLoad.error instanceof ApiError && meLoad.error.status === 403;

  const tabs: { value: Tab; label: string }[] = [
    { value: "campanas", label: t.portal.tabsCampaigns },
    { value: "facturas", label: t.portal.tabsInvoices },
    { value: "tareas", label: t.portal.tabsTasks },
    { value: "reportes", label: t.portal.tabsReports },
    { value: "metricas", label: t.portal.tabsMetrics },
    { value: "citas", label: t.portal.tabsAppointments },
    { value: "brief", label: t.portal.tabsBrief },
    ...(isAdmin ? [{ value: "vinculos" as Tab, label: t.portal.tabsLinks }] : []),
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-zinc-400">{t.portal.intro}</p>

      {isAdmin && (
        <Panel title={t.portal.panelTitle}>
          <PortalClientPicker selectedId={previewId ?? undefined} onSelect={(id) => setPreviewId(id)} />
          {previewLoad.loading && <p role="status" className="mt-3 text-sm text-zinc-400">{t.portal.loading}</p>}
          {previewLoad.error ? <ApiErrorBanner error={previewLoad.error} t={t} onRetry={previewLoad.reload} /> : null}
          {previewContact && (
            <p className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
              {t.portal.previewBadge.replace("{nombre}", previewContact.name)} — {t.portal.previewNote}
            </p>
          )}
        </Panel>
      )}

      {!isAdmin && (
        <>
          {meLoad.loading ? (
            <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.portal.loading}</p>
          ) : notLinked ? (
            <Panel title={t.portal.notLinkedTitle}>
              <p className="text-sm leading-relaxed text-zinc-400">{t.portal.notLinkedBody}</p>
            </Panel>
          ) : meLoad.error ? (
            <ApiErrorBanner error={meLoad.error} t={t} onRetry={meLoad.reload} />
          ) : null}
        </>
      )}

      {contact && (
        <Panel title={t.portal.meTitle}>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-zinc-400">{t.portal.meName}</dt><dd className="font-semibold text-zinc-100">{contact.name}</dd></div>
            <div><dt className="text-xs text-zinc-400">{t.portal.meStatus}</dt><dd className="text-zinc-100">{contact.status}</dd></div>
            <div><dt className="text-xs text-zinc-400">{t.portal.meEmail}</dt><dd className="text-zinc-100">{contact.email || "—"}</dd></div>
            <div><dt className="text-xs text-zinc-400">{t.portal.mePhone}</dt><dd className="text-zinc-100">{contact.phone || "—"}</dd></div>
            {contact.tags.length > 0 && (
              <div className="sm:col-span-2"><dt className="text-xs text-zinc-400">{t.crm.thTags}</dt><dd className="text-zinc-100">{contact.tags.join(", ")}</dd></div>
            )}
          </dl>
        </Panel>
      )}

      {(contact || (isAdmin && tab === "vinculos")) && (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label={t.portal.panelTitle}>
            {tabs.map((tb) => (
              <button
                key={tb.value}
                role="tab"
                aria-selected={tab === tb.value}
                onClick={() => setTab(tb.value)}
                className={
                  tab === tb.value
                    // Nivel 3 (regla en BusinessPanel.tsx): sky oscuro.
                    ? "min-h-[44px] rounded-lg bg-sky-800 px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
                    : "min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
                }
              >
                {tb.label}
              </button>
            ))}
          </div>
          {tab === "campanas" && contact && <PortalCampaigns contactId={contactId} />}
          {tab === "facturas" && contact && <PortalInvoices contactId={contactId} />}
          {tab === "tareas" && contact && <PortalTasks contactId={contactId} />}
          {tab === "reportes" && contact && <PortalReports contactId={contactId} />}
          {tab === "metricas" && contact && <PortalMetrics contactId={contactId} />}
          {tab === "citas" && contact && (
            <AppointmentsPanel
              me={me}
              isAdmin={isAdmin}
              portalContactId={contactId}
              clientName={contact.name}
              allowCreate={!isAdmin}
            />
          )}
          {tab === "brief" && contact && (
            <BrandBriefTab isAdmin={isAdmin} surface="portal" previewContactId={previewId ?? undefined} />
          )}
          {tab === "vinculos" && isAdmin && <VinculosManager />}
        </>
      )}

      {isAdmin && !previewId && tab !== "vinculos" && (
        <p className="text-sm text-zinc-400">{t.portal.pickClientOption}</p>
      )}
      {!isAdmin && me && (
        <p className="text-xs text-zinc-400">{t.business.viewerNote}</p>
      )}
    </div>
  );
}
