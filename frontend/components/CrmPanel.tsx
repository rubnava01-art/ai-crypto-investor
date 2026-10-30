"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type CrmContact, type CrmContactInput, type CrmSource, type CrmStatus, type MeResponse,
} from "../lib/api";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

export const CRM_SOURCES: { value: CrmSource; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "academia", label: "Academia" },
  { value: "cohley", label: "Cohley" },
  { value: "rivgoods", label: "RIV Goods" },
  { value: "otro", label: "Otro" },
];

export const CRM_STATUSES: { value: CrmStatus; label: string }[] = [
  { value: "nuevo", label: "Nuevo" },
  { value: "contactado", label: "Contactado" },
  { value: "interesado", label: "Interesado" },
  { value: "cliente", label: "Cliente" },
  { value: "inactivo", label: "Inactivo" },
];

const sourceLabel = (s: string) => CRM_SOURCES.find((x) => x.value === s)?.label ?? s;
const statusLabel = (s: string) => CRM_STATUSES.find((x) => x.value === s)?.label ?? s;

const statusBadge: Record<string, string> = {
  nuevo: "bg-sky-500/15 text-sky-300",
  contactado: "bg-amber-500/15 text-amber-300",
  interesado: "bg-violet-500/15 text-violet-300",
  cliente: "bg-emerald-500/15 text-emerald-300",
  inactivo: "bg-zinc-500/15 text-zinc-400",
};

interface FormState {
  name: string;
  email: string;
  phone: string;
  source: CrmSource;
  status: CrmStatus;
  tags: string; // comma-separated in the form
  notes: string;
}

const emptyForm: FormState = {
  name: "",
  email: "",
  phone: "",
  source: "manual",
  status: "nuevo",
  tags: "",
  notes: "",
};

export function CrmPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;

  const [contacts, setContacts] = useState<CrmContact[] | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const load = useCallback(async () => {
    try {
      setContacts(await api.listContacts(query.trim() || undefined, statusFilter || undefined));
    } catch {
      setContacts([]);
    }
  }, [query, statusFilter]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const startEdit = (c: CrmContact) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      email: c.email,
      phone: c.phone,
      source: c.source,
      status: c.status,
      tags: c.tags.join(", "),
      notes: c.notes,
    });
    setMsg(null);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    const body: CrmContactInput = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      source: form.source,
      status: form.status,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      notes: form.notes,
    };
    try {
      if (editingId !== null) {
        await api.updateContact(editingId, body);
        setMsg(`Contacto "${body.name}" actualizado.`);
      } else {
        await api.createContact(body);
        setMsg(`Contacto "${body.name}" creado.`);
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el contacto.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: CrmContact) => {
    if (!window.confirm(`¿Borrar el contacto "${c.name}"? Esta acción no se puede deshacer.`)) return;
    setError(null);
    setMsg(null);
    try {
      await api.deleteContact(c.id);
      if (editingId === c.id) cancelEdit();
      setMsg(`Contacto "${c.name}" borrado.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar el contacto.");
    }
  };

  return (
    <Panel
      title="CRM — Contactos"
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
          {contacts === null ? "Cargando…" : `${contacts.length} contacto${contacts.length === 1 ? "" : "s"}`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        Todos tus contactos en un solo lugar: leads de la <strong className="text-zinc-300">Academia</strong>,
        marcas de <strong className="text-zinc-300">Cohley</strong>, clientes de{" "}
        <strong className="text-zinc-300">RIV Goods</strong> y registros manuales.
        {isAdmin
          ? " Como administrador puedes crear, editar y borrar."
          : " Tu rol de prueba es de solo lectura: puedes ver y buscar, pero no modificar."}
      </p>

      {/* Search + filter */}
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_220px]">
        <input
          className={inputCls}
          placeholder="Buscar por nombre o correo…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar contactos"
        />
        <select
          className={inputCls}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filtrar por estado"
        >
          <option value="">Todos los estados</option>
          {CRM_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      {contacts === null ? (
        <p className="py-3 text-center text-sm text-zinc-500">Cargando contactos…</p>
      ) : contacts.length === 0 ? (
        <p className="py-3 text-center text-sm text-zinc-500">
          Sin contactos{query || statusFilter ? " para ese filtro" : " todavía"}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
                <th className="py-2 pr-3 font-semibold">Nombre</th>
                <th className="py-2 pr-3 font-semibold">Contacto</th>
                <th className="py-2 pr-3 font-semibold">Origen</th>
                <th className="py-2 pr-3 font-semibold">Estado</th>
                <th className="py-2 pr-3 font-semibold">Etiquetas</th>
                {isAdmin && <th className="py-2 font-semibold">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {contacts.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="py-2.5 pr-3">
                    <span className="font-semibold text-zinc-100">{c.name}</span>
                    {c.notes && <p className="mt-0.5 max-w-[260px] text-xs text-zinc-500">{c.notes}</p>}
                  </td>
                  <td className="py-2.5 pr-3 text-zinc-300">
                    {c.email && <p className="break-all">{c.email}</p>}
                    {c.phone && <p className="text-xs text-zinc-500">{c.phone}</p>}
                    {!c.email && !c.phone && <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-zinc-300">{sourceLabel(c.source)}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge[c.status] ?? statusBadge.inactivo}`}>
                      {statusLabel(c.status)}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">{t}</span>
                      ))}
                      {c.tags.length === 0 && <span className="text-zinc-600">—</span>}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="py-2.5">
                      <span className="flex gap-1.5">
                        <button
                          onClick={() => startEdit(c)}
                          className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => remove(c)}
                          className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                        >
                          Borrar
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / edit form (admin only) */}
      {isAdmin && (
        <form onSubmit={submit} className="mt-4 space-y-2 border-t border-zinc-800 pt-4">
          <p className="text-sm font-semibold text-zinc-200">
            {editingId !== null ? "Editar contacto" : "Nuevo contacto"}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input aria-label="Nombre" className={inputCls} placeholder="Nombre *" value={form.name} onChange={set("name")} required maxLength={128} autoComplete="off" />
            <input aria-label="Correo" className={inputCls} placeholder="Correo" type="email" value={form.email} onChange={set("email")} autoComplete="off" />
            <input aria-label="Teléfono" className={inputCls} placeholder="Teléfono" value={form.phone} onChange={set("phone")} autoComplete="off" />
            <input aria-label="Etiquetas (separadas por comas)" className={inputCls} placeholder="Etiquetas (separadas por comas)" value={form.tags} onChange={set("tags")} autoComplete="off" />
            <select className={inputCls} value={form.source} onChange={set("source")} aria-label="Origen">
              {CRM_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>Origen: {s.label}</option>
              ))}
            </select>
            <select className={inputCls} value={form.status} onChange={set("status")} aria-label="Estado">
              {CRM_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>Estado: {s.label}</option>
              ))}
            </select>
          </div>
          <textarea aria-label="Notas"
            className={inputCls}
            placeholder="Notas"
            value={form.notes}
            onChange={set("notes")}
            rows={2}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? "Guardando…" : editingId !== null ? "Guardar cambios" : "Crear contacto"}
            </button>
            {editingId !== null && (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                Cancelar
              </button>
            )}
          </div>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}
      {!isAdmin && (msg || error) && (
        <div className="mt-3">
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </div>
      )}
    </Panel>
  );
}
