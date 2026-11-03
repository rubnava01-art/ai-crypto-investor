"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api, ApiError,
  type CrmContact, type EmailLog, type EmailLogStatus, type EmailTemplate,
  type Invoice, type MeResponse, type ReferralCampaign,
} from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { useAsyncLoad, useCancelled } from "../lib/useLoad";
import { ApiErrorBanner, copyTextWithFallback, LoadMore, useConfirm, Field } from "./ui";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-cyan-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60";

const fmtDate = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : null;

/** Reemplaza {{nombre}}, {{negocio}}, {{telefono}}, {{email}} con datos del contacto. */
function applyTokens(text: string, c: CrmContact | null, fallbackName: string) {
  return text
    .replaceAll("{{nombre}}", c?.name ?? fallbackName)
    .replaceAll("{{negocio}}", c?.name ?? fallbackName)
    .replaceAll("{{telefono}}", c?.phone ?? "")
    .replaceAll("{{email}}", c?.email ?? "");
}

function TemplatesPanel({ isAdmin, onUse }: { isAdmin: boolean; onUse: (t: EmailTemplate) => void }) {
  const { t: tt } = useLanguage();
  const { confirm, dialog } = useConfirm(tt);
  // Tri-estado (Fase 4, FE3/FE2): plantillas con useAsyncLoad.
  const templatesLoad = useAsyncLoad<EmailTemplate[]>((signal) => api.listEmailTemplates({ signal }), []);
  const rows = templatesLoad.data;
  const templatesError = templatesLoad.error;
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = templatesLoad.reload;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.createEmailTemplate({ name: name.trim(), subject, body });
      setMsg(tt.correos.msgTemplateSaved);
      setName("");
      setSubject("");
      setBody("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tt.correos.errSave);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: EmailTemplate) => {
    if (!(await confirm(tt.correos.confirmDeleteTemplate.replace("{nombre}", t.name)))) return;
    try {
      await api.deleteEmailTemplate(t.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tt.correos.errDelete);
    }
  };

  return (
    <>
      {dialog}
    <Panel
      title={tt.correos.templatesTitle}
      badge={
        <span className="shrink-0 whitespace-nowrap rounded-full bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-300">
          {rows === null ? (templatesError ? "—" : tt.correos.badgeLoading) : tt.correos.templatesCount.replace("{n}", String(rows.length))}
        </span>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">
        {tt.correos.templatesIntro1}
        {tt.correos.templatesTokens}
        {tt.correos.templatesIntro2}
        {!isAdmin && tt.correos.templatesIntroViewer}
      </p>

      {isAdmin && (
        <form onSubmit={add} className="space-y-3">
          <Field label={tt.correos.templateNameAria}><input aria-label={tt.correos.templateNameAria} className={inputCls} placeholder={tt.correos.templateNamePlaceholder} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoComplete="off" /></Field>
          <Field label={tt.correos.subjectAria}><input aria-label={tt.correos.subjectAria} className={inputCls} placeholder={tt.correos.subjectPlaceholder} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} autoComplete="off" /></Field>
          <Field label={tt.correos.bodyAria}><textarea aria-label={tt.correos.bodyAria} className={inputCls} placeholder={tt.correos.bodyPlaceholder} value={body} onChange={(e) => setBody(e.target.value)} rows={3} /></Field>
          <button type="submit" disabled={busy || !name.trim()} className="min-h-[44px] w-full rounded-lg bg-cyan-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60">
            {busy ? tt.correos.saving : tt.correos.saveTemplate}
          </button>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-5 border-t border-zinc-800 pt-4">
        {templatesError ? <ApiErrorBanner error={templatesError} t={tt} onRetry={templatesLoad.reload} /> : null}
        {rows === null && !templatesError ? (
          <p className="py-2 text-sm text-zinc-500">{tt.correos.loadingTemplates}</p>
        ) : rows === null ? null : rows.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">{tt.correos.emptyTemplates}</p>
        ) : (
          <ul className="divide-y divide-zinc-800/70">
            {rows.map((t) => (
              <li key={t.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-zinc-100">{t.name}</span>
                  <span className="text-xs text-zinc-500">{t.subject}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {isAdmin && (
                      <>
                        <button onClick={() => onUse(t)} className="min-h-[44px] rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60">
                          {tt.correos.use}
                        </button>
                        <button onClick={() => remove(t)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60">
                          {tt.correos.delete}
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {t.body && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">{t.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
    </>
  );
}

function Composer({ isAdmin, onSaved, templateToUse, onTemplateApplied }: {
  isAdmin: boolean;
  onSaved: () => void;
  templateToUse: EmailTemplate | null;
  onTemplateApplied: () => void;
}) {
  const { t } = useLanguage();
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [campaigns, setCampaigns] = useState<ReferralCampaign[]>([]);
  const [contactId, setContactId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listContacts().then(setContacts).catch(() => setContacts([]));
    api.listInvoices().then(setInvoices).catch(() => setInvoices([]));
    api.listReferralCampaigns().then(setCampaigns).catch(() => setCampaigns([]));
  }, []);

  const contact = contacts.find((c) => String(c.id) === contactId) ?? null;
  // Recover info: todo lo que la plataforma ya sabe de este contacto.
  const recovered = useMemo(() => {
    if (!contact) return null;
    return {
      invoices: invoices.filter((i) => i.client_name.toLowerCase() === contact.name.toLowerCase()),
      campaigns: campaigns.filter((c) => c.business_contact_id === contact.id),
    };
  }, [contact, invoices, campaigns]);

  // Cuando el panel de plantillas elige "Usar", carga la plantilla aquí
  // con los datos del contacto ya seleccionado (o del nombre manual).
  useEffect(() => {
    if (!templateToUse) return;
    setTemplateName(templateToUse.name);
    setSubject(applyTokens(templateToUse.subject, contact, manualName));
    setBody(applyTokens(templateToUse.body, contact, manualName));
    setMsg(t.correos.templateLoaded.replace("{nombre}", templateToUse.name));
    document.getElementById("correo-compositor")?.scrollIntoView({ behavior: "smooth" });
    onTemplateApplied();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateToUse]);

  const toName = contact?.name ?? manualName;
  const toEmail = contact?.email ?? manualEmail;

  const gmailUrl = toEmail
    ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(toEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null;

  const copy = async () => {
    if (await copyTextWithFallback(t.correos.copyText.replace("{nombre}", toName).replace("{email}", toEmail).replace("{asunto}", subject).replace("{cuerpo}", body))) {
      setMsg(t.correos.msgCopied);
    } else {
      setError(t.correos.errCopy);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.createEmailLog({
        contact_id: contact?.id ?? null,
        contact_name: toName.trim(),
        contact_email: toEmail.trim(),
        template_name: templateName,
        subject,
        body,
      });
      setMsg(t.correos.msgMailSaved);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.correos.errSave);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="correo-compositor">
      <Panel
        title={t.correos.composerTitle}
        badge={
          <span className="shrink-0 whitespace-nowrap rounded-full bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-300">
            {t.correos.crmBadge}
          </span>
        }
      >
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">
          {t.correos.composerIntro}
          {!isAdmin && t.correos.composerIntroViewer}
        </p>

        <div className="space-y-3">
          {contacts.length > 0 && (
            <Field label={t.correos.crmContactAria}><select className={inputCls} value={contactId} onChange={(e) => setContactId(e.target.value)} aria-label={t.correos.crmContactAria}>
              <option value="">{t.correos.crmContactOption}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select></Field>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t.correos.manualNameAria}><input aria-label={t.correos.manualNameAria} className={inputCls} placeholder={t.correos.manualNamePlaceholder} value={manualName} onChange={(e) => setManualName(e.target.value)} maxLength={200} autoComplete="off" /></Field>
            <Field label={t.correos.manualEmailAria}><input aria-label={t.correos.manualEmailAria} className={inputCls} placeholder={t.correos.manualEmailPlaceholder} value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} maxLength={200} autoComplete="off" /></Field>
          </div>

          {contact && recovered && (
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-4 text-sm leading-relaxed text-zinc-200">
              <p className="font-semibold text-cyan-200">{t.correos.recoveredTitle.replace("{nombre}", contact.name)}</p>
              <p className="text-zinc-300">
                {contact.phone && <>{t.correos.telLabel}{contact.phone} · </>}
                {contact.email && <>{t.correos.emailLabel}{contact.email} · </>}
                {t.correos.statusLabel}{contact.status}
                {contact.tags.length > 0 && <>{t.correos.tagsLabel}{contact.tags.join(", ")}</>}
              </p>
              {contact.notes && <p className="text-zinc-400">{t.correos.notesLabel}{contact.notes}</p>}
              <p className="text-zinc-400">
                {t.correos.invoicesLabel}{recovered.invoices.length}
                {recovered.invoices.length > 0 && <> ({recovered.invoices.map((i) => `${i.number} ${i.status}`).join(", ")})</>}
                {t.correos.campaignsLabel}{recovered.campaigns.length}
                {recovered.campaigns.length > 0 && <> ({recovered.campaigns.map((c) => c.name).join(", ")})</>}
              </p>
            </div>
          )}

          <form onSubmit={save} className="space-y-3">
            <Field label={t.correos.subjectAria2}><input aria-label={t.correos.subjectAria2} className={inputCls} placeholder={t.correos.subjectPlaceholder2} value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={300} autoComplete="off" /></Field>
            <Field label={t.correos.bodyAria2}><textarea aria-label={t.correos.bodyAria2} className={inputCls} placeholder={t.correos.bodyPlaceholder2} value={body} onChange={(e) => setBody(e.target.value)} required rows={5} /></Field>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copy} disabled={!toName.trim() && !subject && !body} className="min-h-[44px] flex-1 rounded-lg border border-zinc-700 px-3 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60">
                {t.correos.copyMail}
              </button>
              {gmailUrl ? (
                <a href={gmailUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-[44px] flex-1 items-center justify-center rounded-lg bg-cyan-600 px-3 py-2.5 text-center text-sm font-semibold text-white hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60">
                  {t.correos.openGmail}
                </a>
              ) : (
                <button type="button" disabled className="min-h-[44px] flex-1 rounded-lg border border-zinc-700 px-3 py-2.5 text-sm text-zinc-400 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60">
                  {t.correos.missingEmail}
                </button>
              )}
              {isAdmin && (
                <button type="submit" disabled={busy || !toName.trim() || !subject.trim() || !body.trim()} className="min-h-[44px] flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
                  {busy ? t.correos.saving : t.correos.saveToLog}
                </button>
              )}
            </div>
            {msg && <p className="text-sm text-emerald-400">{msg}</p>}
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          </form>
        </div>
      </Panel>
    </div>
  );
}

function LogsPanel({ isAdmin, refreshKey }: { isAdmin: boolean; refreshKey: number }) {
  const { t, lang } = useLanguage();
  const { confirm, dialog } = useConfirm(t);
  const locale = lang === "en" ? "en-US" : "es-MX";
  // Tri-estado (Fase 4, FE3/FE2): log con useAsyncLoad; refreshKey lo recarga.
  const logsLoad = useAsyncLoad<EmailLog[]>((signal) => api.listEmailLogs({ signal }), [refreshKey]);
  const rows = logsLoad.data;
  const logsError = logsLoad.error;
  const [error, setError] = useState<string | null>(null);
  // Render incremental en cliente (Fase 4, FE10): el backend no pagina el
  // log, así que se muestran los primeros 20 y "cargar más" revela el resto.
  const [logsVisible, setLogsVisible] = useState(20);

  const load = logsLoad.reload;

  const changeStatus = async (r: EmailLog, st: EmailLogStatus) => {
    try {
      await api.updateEmailLogStatus(r.id, st);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.correos.errChangeStatus);
    }
  };

  const remove = async (r: EmailLog) => {
    if (!(await confirm(t.correos.confirmDeleteLog.replace("{asunto}", r.subject)))) return;
    try {
      await api.deleteEmailLog(r.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.correos.errDelete);
    }
  };

  return (
    <>
      {dialog}
    <Panel
      title={t.correos.logsTitle}
      badge={
        <span className="shrink-0 whitespace-nowrap rounded-full bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-300">
          {rows === null ? (logsError ? "—" : t.correos.badgeLoading) : t.correos.logsCount.replace("{n}", String(rows.length))}
        </span>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">
        {t.correos.logsIntro}
      </p>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {logsError ? <ApiErrorBanner error={logsError} t={t} onRetry={logsLoad.reload} /> : null}
      {rows === null && !logsError ? (
        <p className="py-2 text-sm text-zinc-500">{t.correos.loadingLogs}</p>
      ) : rows === null ? null : rows.length === 0 ? (
        <p className="py-2 text-sm text-zinc-500">{t.correos.emptyLogs}</p>
      ) : (
        <>
        <ul className="divide-y divide-zinc-800/70">
          {rows.slice(0, logsVisible).map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-zinc-100">{r.subject || t.correos.noSubject}</span>
                <span className="text-sm text-zinc-400">→ {r.contact_name}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${r.status === "enviado" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                  {r.status === "enviado" ? t.correos.sentLabel : t.correos.preparedLabel}
                </span>
                {r.template_name && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-200">{r.template_name}</span>}
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-zinc-500">{fmtDate(r.created_at, locale)}</span>
                  {isAdmin && r.status === "preparado" && (
                    <button onClick={() => changeStatus(r, "enviado")} className="min-h-[44px] rounded-lg border border-emerald-900/60 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
                      {t.correos.markSent}
                    </button>
                  )}
                  {isAdmin && (
                    <button onClick={() => remove(r)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60">
                      {t.correos.delete}
                    </button>
                  )}
                </span>
              </div>
              {r.body && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">{r.body}</p>}
            </li>
          ))}
        </ul>
        <LoadMore
          visible={logsVisible}
          total={rows.length}
          t={t}
          onLoadMore={() => setLogsVisible((v) => v + 20)}
        />
        </>
      )}
    </Panel>
    </>
  );
}

export function CorreosPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingTemplate, setPendingTemplate] = useState<EmailTemplate | null>(null);
  const isAdmin = !!me?.is_admin;
  const isCancelled = useCancelled();

  useEffect(() => {
    api.me().then((m) => { if (!isCancelled()) setMe(m); }).catch(() => { if (!isCancelled()) setMe(null); });
  }, [isCancelled]);

  return (
    <div className="space-y-4">
      <TemplatesPanel isAdmin={isAdmin} onUse={(t) => setPendingTemplate(t)} />
      <Composer
        isAdmin={isAdmin}
        onSaved={() => setRefreshKey((k) => k + 1)}
        templateToUse={pendingTemplate}
        onTemplateApplied={() => setPendingTemplate(null)}
      />
      <LogsPanel isAdmin={isAdmin} refreshKey={refreshKey} />
    </div>
  );
}
