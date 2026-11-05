"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type CrmContact, type Invoice, type EmailLog } from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { Field } from "./ui";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

interface Entry {
  key: string;
  date: string | null;
  kind: string;
  title: string;
  detail: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Historial por cliente: línea de tiempo armada SOLO con datos reales
 * ya registrados en APIs existentes — el contacto (registro y notas),
 * sus facturas (Facturas, por nombre o correo del cliente) y sus correos
 * (Correos, por contact_id o correo). Sin endpoint de historial propio:
 * si una fuente falla, se muestra solo lo que existe y se reporta el
 * hueco; nunca se inventan entradas. Llamadas, reuniones u otros hechos
 * no registrados en ningún módulo no pueden aparecer aquí. */
export function CrmHistorial() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const isCancelled = useCancelled();
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [logs, setLogs] = useState<EmailLog[] | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    setGaps([]);
    api.listContacts().then((rows) => { if (!isCancelled()) setContacts(rows); }).catch(() => undefined);
    api.listInvoices().then((rows) => { if (!isCancelled()) setInvoices(rows); }).catch(() => {
      if (!isCancelled()) { setInvoices([]); setGaps((g) => [...g, t.crm.historiaGapFacturas]); }
    });
    api.listEmailLogs().then((rows) => { if (!isCancelled()) setLogs(rows); }).catch(() => {
      if (!isCancelled()) { setLogs([]); setGaps((g) => [...g, t.crm.historiaGapCorreos]); }
    });
  }, [isCancelled, t]);

  const selected = contacts.find((c) => c.id === selectedId) ?? null;

  const entries: Entry[] = useMemo(() => {
    if (!selected) return [];
    const list: Entry[] = [];
    if (selected.created_at) {
      list.push({ key: "created", date: selected.created_at, kind: t.crm.historiaKindContacto, title: t.crm.historiaCreated, detail: selected.name });
    }
    if (selected.updated_at && selected.updated_at !== selected.created_at) {
      list.push({ key: "updated", date: selected.updated_at, kind: t.crm.historiaKindContacto, title: t.crm.historiaUpdated, detail: selected.name });
    }
    if (selected.notes.trim()) {
      // Las notas no guardan fecha propia: se muestran sin fecha en vez
      // de atribuirles la de creación o actualización.
      list.push({ key: "notes", date: null, kind: t.crm.historiaKindNota, title: t.crm.historiaNotes, detail: selected.notes });
    }
    for (const inv of invoices ?? []) {
      const matchName = norm(inv.client_name) === norm(selected.name);
      const matchEmail = !!inv.client_email && !!selected.email && norm(inv.client_email) === norm(selected.email);
      if (matchName || matchEmail) {
        list.push({
          key: `inv-${inv.id}`,
          date: inv.created_at,
          kind: t.crm.historiaKindFactura,
          title: `${t.crm.historiaInvoice} ${inv.number} — ${inv.status}`,
          detail: inv.notes || `${inv.items.length} ${t.crm.historiaItems}`,
        });
      }
    }
    for (const log of logs ?? []) {
      const matchId = log.contact_id !== null && log.contact_id === selected.id;
      const matchEmail = !!log.contact_email && !!selected.email && norm(log.contact_email) === norm(selected.email);
      if (matchId || matchEmail) {
        list.push({
          key: `log-${log.id}`,
          date: log.created_at,
          kind: t.crm.historiaKindCorreo,
          title: log.subject || log.template_name || t.crm.historiaEmail,
          detail: `${log.status}${log.body ? ` — ${log.body.slice(0, 200)}` : ""}`,
        });
      }
    }
    const dated = list.filter((e) => e.date).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const undated = list.filter((e) => !e.date);
    return [...dated, ...undated];
  }, [selected, invoices, logs, t]);

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale, { timeZone: "UTC", hour12: false }) + " UTC" : t.crm.historiaNoDate;

  return (
    <Panel title={t.crm.historiaTitle}>
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">{t.crm.historiaIntro}</p>
      <div className="mb-4">
        <Field label={t.crm.historiaContact}>
          <select className={inputCls} value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)} aria-label={t.crm.historiaContact}>
            <option value="">{t.crm.historiaSelect}</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
      </div>
      {gaps.length > 0 && (
        <p role="alert" className="mb-4 rounded-lg border border-amber-700/60 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-300">
          {t.crm.historiaGapPrefix} {gaps.join(" ")}
        </p>
      )}
      {!selected ? (
        <p className="py-2 text-sm text-zinc-400">{t.crm.historiaSelectHint}</p>
      ) : entries.length === 0 ? (
        <p className="py-2 text-sm text-zinc-400">{t.crm.historiaEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.key} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-100">{e.title}</p>
                <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{e.kind}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-400">{fmtDate(e.date)}</p>
              {e.detail && <p className="mt-1 text-sm text-zinc-300">{e.detail}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
