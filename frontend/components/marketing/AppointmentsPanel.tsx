// Panel de citas (NEST, 2026-11-17): agenda del admin + reserva del
// cliente vinculado (S2). El cliente NO usa /citas (403 fuera del portal,
// S1): lee por GET /portal/citas y crea por POST /citas con el contacto
// derivado del token; el formulario le muestra el nombre fijo.
// Máquina de estados forward-only (patrón ReferidosPanel):
// pendiente → confirmada → completada; cancelada terminal desde
// pendiente/confirmada; nunca se reabre completada/cancelada.
"use client";

import { useState } from "react";
import {
  api, ApiError,
  type Appointment, type AppointmentStatus, type CrmContact, type MeResponse,
} from "../../lib/api";
import { Panel } from "../Panel";
import { ApiErrorBanner, Field, useConfirm } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";
import { formatDateTimeTz } from "../../lib/dates";
import { AppointmentCalendar } from "./AppointmentCalendar";
import { AppointmentForm } from "./AppointmentForm";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

const STATUS_ORDER: AppointmentStatus[] = ["pendiente", "confirmada", "completada", "cancelada"];

function statusCls(status: AppointmentStatus): string {
  switch (status) {
    case "confirmada": return "bg-emerald-500/15 text-emerald-300";
    case "completada": return "bg-sky-500/15 text-sky-300";
    case "cancelada": return "bg-zinc-500/15 text-zinc-400";
    default: return "bg-amber-500/15 text-amber-300";
  }
}

export function AppointmentsPanel({
  me,
  isAdmin,
  portalContactId,
  clientName,
  allowCreate = true,
}: {
  me: MeResponse | null;
  isAdmin: boolean;
  /** Vista previa admin en el portal: citas de ese cliente por /portal/citas. */
  portalContactId?: number;
  /** Nombre del cliente para el formulario (portal o vista previa). */
  clientName?: string;
  /** Portal (vista previa admin): solo lectura; el admin crea desde Marketing. */
  allowCreate?: boolean;
}) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const { confirm, dialog } = useConfirm(t);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [contacts, setContacts] = useState<CrmContact[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // S2: modo portal para el cliente vinculado (y para la vista previa
  // admin del portal). El endpoint del portal no filtra por estado: el
  // filtro se aplica en cliente sobre lo cargado.
  const portalMode = !isAdmin || portalContactId !== undefined;
  const load = useAsyncLoad<Appointment[]>(
    async (signal) => {
      if (portalMode) return api.listPortalAppointments(portalContactId, { signal });
      return api.listAppointments(
        statusFilter ? { status: statusFilter as AppointmentStatus } : undefined,
        { signal },
      );
    },
    [statusFilter, portalMode, portalContactId],
  );
  const loaded = load.data ?? [];
  const appointments =
    portalMode && statusFilter ? loaded.filter((a) => a.status === statusFilter) : loaded;

  // Cliente sin vínculo: /portal/citas responde 403 — no es un error
  // genérico: se explica que falta el vínculo en vez del banner de error.
  const notLinked = !isAdmin && load.error instanceof ApiError && load.error.status === 403;
  // Reservar: admin siempre; cliente vinculado solo cuando su portal
  // cargó (si dio 403, no está vinculado y no se le ofrece el formulario).
  const canBook = allowCreate && (isAdmin || load.data != null);

  const statusLabel = (s: AppointmentStatus) =>
    s === "pendiente" ? t.citas.statusPendiente
    : s === "confirmada" ? t.citas.statusConfirmada
    : s === "completada" ? t.citas.statusCompletada
    : t.citas.statusCancelada;

  const openForm = async (a?: Appointment) => {
    setMsg(null);
    setActionError(null);
    setEditing(a ?? null);
    // Solo el admin en su agenda carga el CRM; el cliente vinculado no
    // elige cliente (nombre fijo) y no toca /crm.
    if (isAdmin && !portalMode && !contacts) {
      try {
        setContacts(await api.listContacts());
      } catch {
        setContacts([]);
      }
    }
    setShowForm(true);
  };

  const changeStatus = async (a: Appointment, status: AppointmentStatus) => {
    setActionError(null);
    setMsg(null);
    try {
      await api.updateAppointment(a.id, { status });
      load.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t.citas.errStatus);
    }
  };

  const remove = async (a: Appointment) => {
    if (!(await confirm(t.citas.confirmDelete.replace("{nombre}", a.client_name)))) return;
    setActionError(null);
    setMsg(null);
    try {
      await api.deleteAppointment(a.id);
      setMsg(t.citas.msgDeleted);
      load.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t.citas.errDelete);
    }
  };

  const upcoming = [...appointments].sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <>
      {dialog}
      <div className="space-y-4">
        <Panel title={t.citas.calendarTitle}>
          {load.loading ? (
            <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.citas.loadingAppointments}</p>
          ) : load.error ? (
            notLinked ? (
              <p className="py-4 text-center text-sm text-zinc-400">{t.portal.notLinkedBody}</p>
            ) : (
              <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
            )
          ) : (
            <AppointmentCalendar appointments={appointments} />
          )}
        </Panel>

        <Panel title={t.citas.listTitle} badge={<span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">{upcoming.length}</span>}>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Field label={t.citas.filterStatusAria} className="min-w-[180px] flex-1">
              <select aria-label={t.citas.filterStatusAria} className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">{t.citas.allStatuses}</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{statusLabel(s)}</option>
                ))}
              </select>
            </Field>
            {canBook && (
              <button
                type="button"
                onClick={() => openForm()}
                className="min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                {t.citas.newAppointment}
              </button>
            )}
          </div>

          {load.loading ? (
            <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.citas.loadingAppointments}</p>
          ) : load.error ? (
            notLinked ? (
              <p className="py-4 text-center text-sm text-zinc-400">{t.portal.notLinkedBody}</p>
            ) : (
              <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
            )
          ) : upcoming.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-center">
              <p className="text-sm text-zinc-400">
                {t.citas.emptyAppointments}
                {statusFilter ? t.citas.emptyForFilter : ""}
              </p>
            </div>
          ) : (
            <>
              <ul className="space-y-3 sm:hidden">
                {upcoming.map((a) => (
                  <li key={a.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-zinc-100">{a.client_name}</p>
                        <p className="mt-1 text-sm text-zinc-300">{a.service_type}</p>
                        <p className="mt-1 text-xs text-zinc-400">{formatDateTimeTz(a.starts_at, locale)} · {a.duration_min} min</p>
                        {a.notes && <p className="mt-1 text-xs text-zinc-400">{a.notes}</p>}
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusCls(a.status)}`}>{statusLabel(a.status)}</span>
                    </div>
                    {isAdmin && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {a.status === "pendiente" && (
                          <button type="button" onClick={() => changeStatus(a, "confirmada")} className="min-h-[44px] rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">{t.citas.confirm}</button>
                        )}
                        {a.status === "confirmada" && (
                          <button type="button" onClick={() => changeStatus(a, "completada")} className="min-h-[44px] rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">{t.citas.complete}</button>
                        )}
                        {(a.status === "pendiente" || a.status === "confirmada") && (
                          <button type="button" onClick={() => changeStatus(a, "cancelada")} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200">{t.citas.cancel}</button>
                        )}
                        <button type="button" onClick={() => openForm(a)} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200">{t.business.edit}</button>
                        <button type="button" onClick={() => remove(a)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-2 text-xs text-red-400">{t.citas.delete}</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-400">
                      <th className="py-3 pr-3 font-semibold">{t.citas.thClient}</th>
                      <th className="py-3 pr-3 font-semibold">{t.citas.thService}</th>
                      <th className="py-3 pr-3 font-semibold">{t.citas.thWhen}</th>
                      <th className="py-3 pr-3 font-semibold">{t.citas.thStatus}</th>
                      <th className="py-3 font-semibold">{t.citas.thActions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {upcoming.map((a) => (
                      <tr key={a.id} className="align-top">
                        <td className="py-3 pr-3 font-semibold text-zinc-100">{a.client_name}</td>
                        <td className="py-3 pr-3 text-zinc-300">{a.service_type}</td>
                        <td className="py-3 pr-3 text-zinc-300">{formatDateTimeTz(a.starts_at, locale)} · {a.duration_min} min</td>
                        <td className="py-3 pr-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusCls(a.status)}`}>{statusLabel(a.status)}</span></td>
                        <td className="py-3">
                          {isAdmin && (
                            <div className="flex flex-wrap gap-2 text-xs">
                              {a.status === "pendiente" && (
                                <button type="button" onClick={() => changeStatus(a, "confirmada")} className="min-h-[44px] text-emerald-400 hover:underline">{t.citas.confirm}</button>
                              )}
                              {a.status === "confirmada" && (
                                <button type="button" onClick={() => changeStatus(a, "completada")} className="min-h-[44px] text-emerald-400 hover:underline">{t.citas.complete}</button>
                              )}
                              {(a.status === "pendiente" || a.status === "confirmada") && (
                                <button type="button" onClick={() => changeStatus(a, "cancelada")} className="min-h-[44px] text-zinc-300 hover:underline">{t.citas.cancel}</button>
                              )}
                              <button type="button" onClick={() => openForm(a)} className="min-h-[44px] text-zinc-300 hover:underline">{t.business.edit}</button>
                              <button type="button" onClick={() => remove(a)} className="min-h-[44px] text-red-400 hover:underline">{t.citas.delete}</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {msg && <p className="mt-3 text-sm text-emerald-400">{msg}</p>}
          {actionError && <p role="alert" className="mt-3 text-sm text-red-400">{actionError}</p>}
          {showForm && canBook && (
            <div className="mt-4">
              <AppointmentForm
                contacts={contacts ?? []}
                initial={editing}
                fixedClientName={
                  portalMode
                    ? (clientName ?? me?.display_name ?? me?.username ?? appointments[0]?.client_name ?? "")
                    : undefined
                }
                onSaved={(m) => { setMsg(m); setShowForm(false); setEditing(null); load.reload(); }}
                onCancel={() => { setShowForm(false); setEditing(null); }}
              />
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
