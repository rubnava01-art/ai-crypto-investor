"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  api, ApiError,
  type CrmContact, type EmailLog, type EmailLogStatus, type EmailTemplate,
  type Invoice, type MeResponse, type ReferralCampaign,
} from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage, type Dictionary } from "../lib/i18n";
import { useAsyncLoad, useCancelled } from "../lib/useLoad";
import { ApiErrorBanner, copyTextWithFallback, useConfirm, Field } from "./ui";

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

/** Tamaño de página real contra el backend (ítem 17): cada "Cargar más"
 * pide limit/offset al servidor, no revela filas ya descargadas. */
const PAGE_SIZE = 25;

/** Skeleton de lista (M-2): sustituye al texto plano "Cargando…" en
 * plantillas y registro. */
function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Cargando" className="space-y-3 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} aria-hidden="true" className="space-y-2">
          <div className="h-4 w-2/5 motion-safe:animate-pulse rounded bg-zinc-800" />
          <div className="h-3 w-full motion-safe:animate-pulse rounded bg-zinc-900/70" />
          <div className="h-3 w-3/4 motion-safe:animate-pulse rounded bg-zinc-900/70" />
        </div>
      ))}
    </div>
  );
}

/** Cuerpo con line-clamp-2 + "Ver más" por fila (M-3): las plantillas y
 * los registros largos ya no inflan el DOM ni el scroll. */
function ClampedBody({ text, t }: { text: string; t: Dictionary }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 160;
  return (
    <div>
      <p className={`mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400 ${expanded || !long ? "" : "line-clamp-2"}`}>
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 min-h-[44px] px-1 py-1 text-xs font-semibold text-cyan-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
        >
          {expanded ? t.correos.showLess : t.correos.showMore}
        </button>
      )}
    </div>
  );
}

/** Borrador del compositor en sessionStorage (A-4): sobrevive a una
 * expiración de sesión (401 → login → vuelta a /correos). Corrección QA
 * 2026-11-10 nº 2: el borrador queda atado al usuario que lo escribió
 * (`owner`, username de /me). sessionStorage es por pestaña, no por usuario:
 * sin esto, tras cerrar sesión el borrador con PII de cliente reaparecía
 * ante otro usuario en la misma pestaña. */
const DRAFT_KEY = "grow-correo-borrador";

interface CorreoDraft {
  contactId: string;
  manualName: string;
  manualEmail: string;
  subject: string;
  body: string;
  templateName: string;
  /** Username de /me que escribió el borrador ("" = borrador anterior a
   * esta corrección, sin propietario: se conserva por compatibilidad). */
  owner: string;
}

const EMPTY_DRAFT: CorreoDraft = { contactId: "", manualName: "", manualEmail: "", subject: "", body: "", templateName: "", owner: "" };

function loadDraft(): CorreoDraft {
  if (typeof window === "undefined") return EMPTY_DRAFT;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY_DRAFT;
    const p = JSON.parse(raw) as Partial<CorreoDraft>;
    return {
      contactId: typeof p.contactId === "string" ? p.contactId : "",
      manualName: typeof p.manualName === "string" ? p.manualName : "",
      manualEmail: typeof p.manualEmail === "string" ? p.manualEmail : "",
      subject: typeof p.subject === "string" ? p.subject : "",
      body: typeof p.body === "string" ? p.body : "",
      templateName: typeof p.templateName === "string" ? p.templateName : "",
      owner: typeof p.owner === "string" ? p.owner : "",
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

function TemplatesPanel({ isAdmin, onUse }: { isAdmin: boolean; onUse: (t: EmailTemplate) => void }) {
  const { t: tt } = useLanguage();
  const { confirm, dialog } = useConfirm(tt);
  // Paginación real (M-3): cada página pide limit/offset al backend; el
  // botón "Cargar más" trae la siguiente, no revela filas locales.
  const [page, setPage] = useState(0);
  const templatesLoad = useAsyncLoad<EmailTemplate[]>(
    (signal) => api.listEmailTemplates({ signal, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [page],
  );
  const templatesError = templatesLoad.error;
  const [rows, setRows] = useState<EmailTemplate[]>([]);
  const [hasMore, setHasMore] = useState(false);
  // No re-aplicar la misma página dos veces (p. ej. al cambiar `page` con
  // datos viejos aún en memoria): solo el array recién resuelto acumula.
  const appliedRef = useRef<EmailTemplate[] | null>(null);
  useEffect(() => {
    const d = templatesLoad.data;
    if (!d || appliedRef.current === d) return;
    appliedRef.current = d;
    setHasMore(d.length === PAGE_SIZE);
    setRows((prev) => (page === 0 ? d : [...prev, ...d.filter((r) => !prev.some((p) => p.id === r.id))]));
  }, [templatesLoad.data, page]);
  const loadingFirst = templatesLoad.loading && rows.length === 0;
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = templatesLoad.reload;
  // Tras crear/borrar, volver a la primera página para que la lista
  // refleje el cambio (la nueva plantilla encabeza, orden id desc).
  const resetList = () => {
    if (page === 0) load();
    else setPage(0);
  };

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
      resetList();
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
      resetList();
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
          {loadingFirst ? tt.correos.badgeLoading : templatesError && rows.length === 0 ? "—" : tt.correos.templatesCount.replace("{n}", String(rows.length))}
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
        {loadingFirst && !templatesError ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">{tt.correos.emptyTemplates}</p>
        ) : (
          <>
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
                {t.body && <ClampedBody text={t.body} t={tt} />}
              </li>
            ))}
          </ul>
          {hasMore && (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={templatesLoad.loading}
                className="min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
              >
                {templatesLoad.loading ? tt.correos.badgeLoading : tt.reliability.loadMore}
              </button>
            </div>
          )}
          </>
        )}
      </div>
    </Panel>
    </>
  );
}

function Composer({ isAdmin, owner, onSaved, templateToUse, onTemplateApplied }: {
  isAdmin: boolean;
  /** Username de /me (null mientras no resuelve): propietario del borrador. */
  owner: string | null;
  onSaved: () => void;
  templateToUse: EmailTemplate | null;
  onTemplateApplied: () => void;
}) {
  const { t } = useLanguage();
  // Borrador restaurado al montar (A-4): los campos arrancan con lo que
  // había en sessionStorage, si lo había.
  const [draft0] = useState(loadDraft);
  // Carga bajo demanda (A-2/M-8): nada de esto se pide al montar. Los
  // contactos se cargan al abrir el selector; facturas y campañas, solo
  // cuando ya hay un contacto elegido. Todo con useAsyncLoad + signal.
  const [contactsRequested, setContactsRequested] = useState(false);
  const contactsLoad = useAsyncLoad<CrmContact[]>(
    (signal) => (contactsRequested ? api.listContacts(undefined, undefined, { signal }) : Promise.resolve([])),
    [contactsRequested],
  );
  const contacts = contactsLoad.data ?? [];
  const [contactId, setContactId] = useState(draft0.contactId);
  const [manualName, setManualName] = useState(draft0.manualName);
  const [manualEmail, setManualEmail] = useState(draft0.manualEmail);
  const [subject, setSubject] = useState(draft0.subject);
  const [body, setBody] = useState(draft0.body);
  const [templateName, setTemplateName] = useState(draft0.templateName);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contact = contacts.find((c) => String(c.id) === contactId) ?? null;
  const invoicesLoad = useAsyncLoad<Invoice[]>(
    (signal) => (contact ? api.listInvoices({ signal }) : Promise.resolve([])),
    [contact?.id],
  );
  const campaignsLoad = useAsyncLoad<ReferralCampaign[]>(
    (signal) => (contact ? api.listReferralCampaigns(undefined, { signal }) : Promise.resolve([])),
    [contact?.id],
  );
  const invoices = invoicesLoad.data ?? [];
  const campaigns = campaignsLoad.data ?? [];

  // Corrección QA 2026-11-10 nº 2: al resolverse el usuario actual, si el
  // borrador guardado pertenece a otro usuario (otra sesión en la misma
  // pestaña), se descarta — campos vacíos y clave borrada — para que su PII
  // no reaparezca ante el usuario nuevo. Un borrador sin propietario (de
  // antes de esta corrección) se conserva. El borrador del mismo usuario
  // sigue sobreviviendo a una expiración de sesión (A-4).
  useEffect(() => {
    if (!owner) return;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<CorreoDraft>;
      if (typeof p.owner === "string" && p.owner !== "" && p.owner !== owner) {
        sessionStorage.removeItem(DRAFT_KEY);
        setContactId("");
        setManualName("");
        setManualEmail("");
        setSubject("");
        setBody("");
        setTemplateName("");
      }
    } catch {
      // Borrador ilegible: loadDraft ya devuelve vacío.
    }
  }, [owner]);

  // Borrador con debounce (A-4): cada cambio se guarda en sessionStorage
  // 500 ms después; si todo queda vacío, se borra la clave.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const empty = !contactId && !manualName && !manualEmail && !subject && !body && !templateName;
        if (empty) sessionStorage.removeItem(DRAFT_KEY);
        else {
          // Propietario del borrador: el usuario actual si ya se conoce;
          // si aún no, se conserva el ya guardado para no borrarlo.
          let draftOwner = owner ?? "";
          if (!draftOwner) {
            try {
              const prev = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null") as Partial<CorreoDraft> | null;
              if (typeof prev?.owner === "string") draftOwner = prev.owner;
            } catch {
              // Borrador previo ilegible: sin propietario.
            }
          }
          sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ contactId, manualName, manualEmail, subject, body, templateName, owner: draftOwner }));
        }
      } catch {
        // sessionStorage lleno o bloqueado: el borrador solo vive en memoria.
      }
    }, 500);
    return () => clearTimeout(id);
  }, [contactId, manualName, manualEmail, subject, body, templateName, owner]);

  // Recover info: todo lo que la plataforma ya sabe de este contacto.
  // Las facturas se casan por contact_id cuando existe; si no, por nombre
  // exacto (respaldo v1: las facturas solo traen client_name).
  const recovered = useMemo(() => {
    if (!contact) return null;
    return {
      invoices: invoices.filter((i) =>
        i.contact_id != null ? i.contact_id === contact.id : i.client_name.toLowerCase() === contact.name.toLowerCase(),
      ),
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
      // Guardado con éxito: limpiar el borrador y dejar el compositor
      // vacío (si no, el debounce lo volvería a guardar).
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // sessionStorage bloqueado: nada que limpiar.
      }
      setContactId("");
      setManualName("");
      setManualEmail("");
      setSubject("");
      setBody("");
      setTemplateName("");
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
          <Field label={t.correos.crmContactAria}><select className={inputCls} value={contactId} onChange={(e) => setContactId(e.target.value)} onFocus={() => setContactsRequested(true)} aria-label={t.correos.crmContactAria}>
            <option value="">{contactsLoad.loading ? t.correos.badgeLoading : t.correos.crmContactOption}</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select></Field>
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
  // Paginación real (M-3): cada página pide limit/offset al backend; el
  // botón "Cargar más" trae la siguiente, no revela filas locales.
  const [page, setPage] = useState(0);
  const logsLoad = useAsyncLoad<EmailLog[]>(
    (signal) => api.listEmailLogs({ signal, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [refreshKey, page],
  );
  const logsError = logsLoad.error;
  const [rows, setRows] = useState<EmailLog[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const appliedRef = useRef<EmailLog[] | null>(null);
  // Al guardar un correo nuevo (refreshKey), volver a la primera página.
  useEffect(() => {
    setPage(0);
    setRows([]);
  }, [refreshKey]);
  useEffect(() => {
    const d = logsLoad.data;
    if (!d || appliedRef.current === d) return;
    appliedRef.current = d;
    setHasMore(d.length === PAGE_SIZE);
    setRows((prev) => (page === 0 ? d : [...prev, ...d.filter((r) => !prev.some((p) => p.id === r.id))]));
  }, [logsLoad.data, page]);
  const loadingFirst = logsLoad.loading && rows.length === 0;
  const [error, setError] = useState<string | null>(null);

  const load = logsLoad.reload;
  // Tras cambiar estado o borrar, volver a la primera página para no
  // dejar filas obsoletas acumuladas.
  const resetList = () => {
    if (page === 0) load();
    else setPage(0);
  };

  const changeStatus = async (r: EmailLog, st: EmailLogStatus) => {
    try {
      await api.updateEmailLogStatus(r.id, st);
      resetList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.correos.errChangeStatus);
    }
  };

  const remove = async (r: EmailLog) => {
    if (!(await confirm(t.correos.confirmDeleteLog.replace("{asunto}", r.subject)))) return;
    try {
      await api.deleteEmailLog(r.id);
      resetList();
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
          {loadingFirst ? t.correos.badgeLoading : logsError && rows.length === 0 ? "—" : t.correos.logsCount.replace("{n}", String(rows.length))}
        </span>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">
        {t.correos.logsIntro}
      </p>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {logsError ? <ApiErrorBanner error={logsError} t={t} onRetry={logsLoad.reload} /> : null}
      {loadingFirst && !logsError ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <p className="py-2 text-sm text-zinc-500">{t.correos.emptyLogs}</p>
      ) : (
        <>
        <ul className="divide-y divide-zinc-800/70">
          {rows.map((r) => (
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
              {r.body && <ClampedBody text={r.body} t={t} />}
            </li>
          ))}
        </ul>
        {hasMore && (
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={logsLoad.loading}
              className="min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
            >
              {logsLoad.loading ? t.correos.badgeLoading : t.reliability.loadMore}
            </button>
          </div>
        )}
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
        owner={me?.username ?? null}
        onSaved={() => setRefreshKey((k) => k + 1)}
        templateToUse={pendingTemplate}
        onTemplateApplied={() => setPendingTemplate(null)}
      />
      <LogsPanel isAdmin={isAdmin} refreshKey={refreshKey} />
    </div>
  );
}
