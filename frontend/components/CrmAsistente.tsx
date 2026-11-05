"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type CrmContact, type Invoice, type MeResponse } from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { Field } from "./ui";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

const norm = (s: string) => s.trim().toLowerCase();

/** Asistente del CRM — panel COMPACTO, no un chatbot. Etiquetado con
 * honestidad como "Asistencia por reglas": el proveedor de IA de la
 * plataforma es STUB (sin llave de OpenAI en funcionamiento), así que
 * aquí NO hay llamadas a IA externa ni texto generado. Todo son reglas
 * sobre datos ya registrados: búsqueda de clientes, alta rápida (reusa
 * el flujo de creación existente) y sugerencias derivadas de facturas y
 * notas reales. Solo admin crea; prueba ve búsqueda y sugerencias en
 * solo lectura. */
export function CrmAsistente() {
  const { t } = useLanguage();
  const isCancelled = useCancelled();
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.listContacts().then((rows) => { if (!isCancelled()) setContacts(rows); }).catch(() => undefined);
    api.listInvoices().then((rows) => { if (!isCancelled()) setInvoices(rows); }).catch(() => undefined);
  };

  useEffect(() => {
    api.me().then((m) => { if (!isCancelled()) setMe(m); }).catch(() => { if (!isCancelled()) setMe(null); });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return contacts.filter((c) => [c.name, c.email, c.phone].join(" ").toLowerCase().includes(q)).slice(0, 10);
  }, [contacts, query]);

  // Reglas (solo datos registrados, sin inferencias ni texto generado):
  const suggestions = useMemo(() => {
    const pending = new Map<number, string[]>();
    for (const inv of invoices) {
      if (inv.status === "pagada") continue;
      const c = contacts.find((ct) =>
        norm(ct.name) === norm(inv.client_name) ||
        (!!ct.email && !!inv.client_email && norm(ct.email) === norm(inv.client_email)));
      if (c) {
        const arr = pending.get(c.id) ?? [];
        arr.push(inv.number);
        pending.set(c.id, arr);
      }
    }
    const byId = new Map(contacts.map((c) => [c.id, c]));
    return {
      pending: [...pending.entries()].map(([id, numbers]) => ({
        contact: byId.get(id),
        text: t.crm.asistentePending.replace("{nombre}", byId.get(id)?.name ?? "").replace("{facturas}", numbers.join(", ")),
      })).slice(0, 10),
      noNotes: contacts.filter((c) => !c.notes.trim()).slice(0, 10),
      noContact: contacts.filter((c) => !c.email.trim() && !c.phone.trim()).slice(0, 10),
      inactive: contacts.filter((c) => c.status === "inactivo").slice(0, 10),
    };
  }, [contacts, invoices, t]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const created = await api.createContact({ name: name.trim(), email: email.trim(), phone: phone.trim(), source: "manual", status: "nuevo", tags: [], notes: "" });
      setMsg(t.crm.asistenteCreated.replace("{nombre}", created.name));
      setName("");
      setEmail("");
      setPhone("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.crm.asistenteErrSave);
    } finally {
      setBusy(false);
    }
  };

  const rule = (title: string, items: { contact?: CrmContact; text: string }[] | CrmContact[], render: (c: CrmContact) => string) => (
    <div>
      <p className="text-sm font-semibold text-zinc-200">{title}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-zinc-400">{t.crm.asistenteNone}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {items.map((it, i) => {
            const c = "contact" in it ? it.contact : (it as CrmContact);
            const text = "text" in it && typeof it.text === "string" ? it.text : render(c as CrmContact);
            return <li key={`${c?.id ?? i}-${i}`} className="text-sm text-zinc-300">{text}</li>;
          })}
        </ul>
      )}
    </div>
  );

  return (
    <Panel title={t.crm.asistenteTitle} badge={
      <span className="shrink-0 whitespace-nowrap rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-300">
        {t.crm.asistenteLabel}
      </span>
    }>
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">{t.crm.asistenteIntro}</p>
      <div className="mb-4">
        <Field label={t.crm.asistenteSearchAria}>
          <input className={inputCls} placeholder={t.crm.asistenteSearch} value={query}
            onChange={(e) => setQuery(e.target.value)} aria-label={t.crm.asistenteSearchAria} />
        </Field>
        {query.trim() !== "" && (
          found.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-400">{t.crm.asistenteNone}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {found.map((c) => (
                <li key={c.id} className="text-sm text-zinc-300">
                  {c.name}{c.email ? ` — ${c.email}` : ""}{c.phone ? ` — ${c.phone}` : ""}
                </li>
              ))}
            </ul>
          )
        )}
      </div>
      {isAdmin && (
        <form onSubmit={create} className="mb-5 space-y-3 border-t border-zinc-800 pt-5">
          <p className="text-sm font-semibold text-zinc-200">{t.crm.asistenteQuickNew}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t.crm.asistenteName}><input aria-label={t.crm.asistenteName} className={inputCls} placeholder={t.crm.asistenteName} value={name} onChange={(e) => setName(e.target.value)} required maxLength={128} autoComplete="off" /></Field>
            <Field label={t.crm.asistenteEmail}><input aria-label={t.crm.asistenteEmail} className={inputCls} type="email" placeholder={t.crm.asistenteEmail} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Field>
            <Field label={t.crm.asistentePhone}><input aria-label={t.crm.asistentePhone} className={inputCls} placeholder={t.crm.asistentePhone} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" /></Field>
          </div>
          <button type="submit" disabled={busy} className="min-h-[44px] rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
            {busy ? t.crm.asistenteSaving : t.crm.asistenteCreate}
          </button>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}
      {!isAdmin && <p className="mb-5 text-sm text-zinc-400">{t.crm.asistenteReadOnly}</p>}
      <div className="space-y-4 border-t border-zinc-800 pt-5">
        {rule(t.crm.asistentePendingTitle, suggestions.pending, () => "")}
        {rule(t.crm.asistenteNoNotesTitle, suggestions.noNotes, (c) => t.crm.asistenteNoNotes.replace("{nombre}", c.name))}
        {rule(t.crm.asistenteNoContactTitle, suggestions.noContact, (c) => t.crm.asistenteNoContact.replace("{nombre}", c.name))}
        {rule(t.crm.asistenteInactiveTitle, suggestions.inactive, (c) => t.crm.asistenteInactive.replace("{nombre}", c.name))}
      </div>
    </Panel>
  );
}
