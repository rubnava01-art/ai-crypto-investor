"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api, ApiError,
  type CrmContact, type EmailLog, type EmailLogStatus, type EmailTemplate,
  type Invoice, type MeResponse, type ReferralCampaign,
} from "../lib/api";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : null;

/** Reemplaza {{nombre}}, {{negocio}}, {{telefono}}, {{email}} con datos del contacto. */
function applyTokens(text: string, c: CrmContact | null, fallbackName: string) {
  return text
    .replaceAll("{{nombre}}", c?.name ?? fallbackName)
    .replaceAll("{{negocio}}", c?.name ?? fallbackName)
    .replaceAll("{{telefono}}", c?.phone ?? "")
    .replaceAll("{{email}}", c?.email ?? "");
}

function TemplatesPanel({ isAdmin, onUse }: { isAdmin: boolean; onUse: (t: EmailTemplate) => void }) {
  const [rows, setRows] = useState<EmailTemplate[] | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.listEmailTemplates());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.createEmailTemplate({ name: name.trim(), subject, body });
      setMsg("Plantilla guardada.");
      setName("");
      setSubject("");
      setBody("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: EmailTemplate) => {
    if (!window.confirm(`¿Borrar la plantilla "${t.name}"?`)) return;
    try {
      await api.deleteEmailTemplate(t.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar.");
    }
  };

  return (
    <Panel
      title="Mis plantillas de correo"
      badge={
        <span className="rounded-full bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-300">
          {rows === null ? "Cargando…" : `${rows.length} plantillas`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        Crea tus propios correos una vez y reutilízalos. En el texto puedes usar
        {" {{nombre}}, {{negocio}}, {{telefono}} y {{email}} "} y al componer se
        reemplazan solos con los datos del contacto.
        {!isAdmin && " Tu rol de prueba es de solo lectura."}
      </p>

      {isAdmin && (
        <form onSubmit={add} className="space-y-2">
          <input aria-label="Nombre de la plantilla" className={inputCls} placeholder="Nombre de la plantilla *" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoComplete="off" />
          <input aria-label="Asunto (puede usar {{nombre}})" className={inputCls} placeholder="Asunto (puede usar {{nombre}})" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} autoComplete="off" />
          <textarea aria-label="Cuerpo del correo" className={inputCls} placeholder="Cuerpo del correo… Hola {{nombre}}, …" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
          <button type="submit" disabled={busy || !name.trim()} className="w-full rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">
            {busy ? "Guardando…" : "Guardar plantilla"}
          </button>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3">
        {rows === null ? (
          <p className="py-2 text-sm text-zinc-500">Cargando plantillas…</p>
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">Todavía no hay plantillas. Crea la primera arriba.</p>
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
                        <button onClick={() => onUse(t)} className="rounded-lg bg-cyan-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-cyan-500">
                          Usar
                        </button>
                        <button onClick={() => remove(t)} className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50">
                          Borrar
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
  );
}

function Composer({ isAdmin, onSaved, templateToUse, onTemplateApplied }: {
  isAdmin: boolean;
  onSaved: () => void;
  templateToUse: EmailTemplate | null;
  onTemplateApplied: () => void;
}) {
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
    setMsg(`Plantilla "${templateToUse.name}" cargada. Revisa el texto antes de guardarlo.`);
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
    try {
      await navigator.clipboard.writeText(`Para: ${toName} <${toEmail}>\nAsunto: ${subject}\n\n${body}`);
      setMsg("Correo copiado al portapapeles.");
    } catch {
      setError("No se pudo copiar. Selecciónalo a mano.");
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
      setMsg("Correo guardado en el registro como preparado.");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="correo-compositor">
      <Panel
        title="Redactar correo"
        badge={
          <span className="rounded-full bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-300">
            CRM conectado
          </span>
        }
      >
        <p className="mb-3 text-xs leading-relaxed text-zinc-500">
          Elige un contacto del CRM y la plataforma recupera su información:
          teléfono, email, etiquetas, estado, notas, sus facturas y sus campañas
          de referidos. El correo se prepara aquí; el envío lo haces tú desde tu
          Gmail (esta versión no envía desde el servidor) y luego lo marcas
          como enviado en el registro.
          {!isAdmin && " Tu rol de prueba es de solo lectura."}
        </p>

        <div className="space-y-2">
          {contacts.length > 0 && (
            <select className={inputCls} value={contactId} onChange={(e) => setContactId(e.target.value)} aria-label="Contacto del CRM">
              <option value="">Contacto del CRM…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input aria-label="Nombre (si no es del CRM)" className={inputCls} placeholder="Nombre (si no es del CRM)" value={manualName} onChange={(e) => setManualName(e.target.value)} maxLength={200} autoComplete="off" />
            <input aria-label="Email del destinatario" className={inputCls} placeholder="Email del destinatario" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} maxLength={200} autoComplete="off" />
          </div>

          {contact && recovered && (
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm leading-relaxed text-zinc-200">
              <p className="font-semibold text-cyan-200">Información recuperada de {contact.name}</p>
              <p className="text-zinc-300">
                {contact.phone && <>Tel: {contact.phone} · </>}
                {contact.email && <>Email: {contact.email} · </>}
                Estado: {contact.status}
                {contact.tags.length > 0 && <> · Etiquetas: {contact.tags.join(", ")}</>}
              </p>
              {contact.notes && <p className="text-zinc-400">Notas: {contact.notes}</p>}
              <p className="text-zinc-400">
                Facturas: {recovered.invoices.length}
                {recovered.invoices.length > 0 && <> ({recovered.invoices.map((i) => `${i.number} ${i.status}`).join(", ")})</>}
                {" · "}Campañas de referidos: {recovered.campaigns.length}
                {recovered.campaigns.length > 0 && <> ({recovered.campaigns.map((c) => c.name).join(", ")})</>}
              </p>
            </div>
          )}

          <form onSubmit={save} className="space-y-2">
            <input aria-label="Asunto" className={inputCls} placeholder="Asunto *" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={300} autoComplete="off" />
            <textarea aria-label="Cuerpo del correo" className={inputCls} placeholder="Cuerpo del correo *" value={body} onChange={(e) => setBody(e.target.value)} required rows={5} />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copy} disabled={!toName.trim() && !subject && !body} className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50">
                Copiar correo
              </button>
              {gmailUrl ? (
                <a href={gmailUrl} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-lg bg-cyan-600 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-cyan-500">
                  Abrir en Gmail ↗
                </a>
              ) : (
                <button type="button" disabled className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-500 disabled:opacity-50">
                  Falta el email del destinatario
                </button>
              )}
              {isAdmin && (
                <button type="submit" disabled={busy || !toName.trim() || !subject.trim() || !body.trim()} className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                  {busy ? "Guardando…" : "Guardar en registro"}
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
  const [rows, setRows] = useState<EmailLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.listEmailLogs());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const changeStatus = async (r: EmailLog, st: EmailLogStatus) => {
    try {
      await api.updateEmailLogStatus(r.id, st);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el estado.");
    }
  };

  const remove = async (r: EmailLog) => {
    if (!window.confirm(`¿Borrar el registro "${r.subject}"?`)) return;
    try {
      await api.deleteEmailLog(r.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar.");
    }
  };

  return (
    <Panel
      title="Registro de correos"
      badge={
        <span className="rounded-full bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-300">
          {rows === null ? "Cargando…" : `${rows.length} correos`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        La línea de tiempo de correos por contacto, al estilo HubSpot: qué se
        preparó y qué ya enviaste tú desde tu Gmail.
      </p>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {rows === null ? (
        <p className="py-2 text-sm text-zinc-500">Cargando registro…</p>
      ) : rows.length === 0 ? (
        <p className="py-2 text-sm text-zinc-500">Todavía no hay correos registrados.</p>
      ) : (
        <ul className="divide-y divide-zinc-800/70">
          {rows.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-zinc-100">{r.subject || "(sin asunto)"}</span>
                <span className="text-sm text-zinc-400">→ {r.contact_name}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${r.status === "enviado" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                  {r.status === "enviado" ? "Enviado" : "Preparado"}
                </span>
                {r.template_name && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">{r.template_name}</span>}
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-zinc-600">{fmtDate(r.created_at)}</span>
                  {isAdmin && r.status === "preparado" && (
                    <button onClick={() => changeStatus(r, "enviado")} className="rounded-lg border border-emerald-900/60 px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-950/50">
                      Marcar enviado
                    </button>
                  )}
                  {isAdmin && (
                    <button onClick={() => remove(r)} className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50">
                      Borrar
                    </button>
                  )}
                </span>
              </div>
              {r.body && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">{r.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function CorreosPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingTemplate, setPendingTemplate] = useState<EmailTemplate | null>(null);
  const isAdmin = !!me?.is_admin;

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

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
