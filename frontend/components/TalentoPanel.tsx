"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type MeResponse } from "../lib/api";
import { empresaApi, type Empleado, type EmpleadoEstado } from "../lib/api/empresa";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { ApiErrorBanner, useConfirm, Field } from "./ui";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

/** Talento humano: directorio de empleados. Empieza VACÍO — nunca se
 * inventan registros. Sin SSN ni datos bancarios en ningún campo.
 * Solo admin crea/edita/borra; prueba ve lista vacía (el backend la
 * devuelve vacía) con su aviso de solo lectura. */
export function TalentoPanel() {
  const { t } = useLanguage();
  const isCancelled = useCancelled();
  const { confirm, dialog } = useConfirm(t);
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;
  const [rows, setRows] = useState<Empleado[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [nombre, setNombre] = useState("");
  const [puesto, setPuesto] = useState("");
  const [contacto, setContacto] = useState("");
  const [fechaIngreso, setFechaIngreso] = useState("");
  const [estado, setEstado] = useState<EmpleadoEstado>("activo");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await empresaApi.listEmpleados();
      if (isCancelled()) return;
      setRows(data);
      setLoadError(null);
    } catch (e) {
      if (isCancelled()) return;
      setLoadError(e);
    }
  }, [isCancelled]);

  useEffect(() => {
    api.me().then((m) => { if (!isCancelled()) setMe(m); }).catch(() => { if (!isCancelled()) setMe(null); });
    load();
  }, [load, isCancelled]);

  const visible = (rows ?? []).filter((r) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [r.nombre, r.puesto, r.contacto].join(" ").toLowerCase().includes(q);
  });

  const resetForm = () => {
    setEditingId(null);
    setNombre("");
    setPuesto("");
    setContacto("");
    setFechaIngreso("");
    setEstado("activo");
    setNotas("");
  };

  const startEdit = (r: Empleado) => {
    setEditingId(r.id);
    setNombre(r.nombre);
    setPuesto(r.puesto);
    setContacto(r.contacto);
    setFechaIngreso(r.fecha_ingreso ?? "");
    setEstado(r.estado);
    setNotas(r.notas);
    setMsg(null);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    const body = {
      nombre: nombre.trim(),
      puesto: puesto.trim(),
      contacto: contacto.trim(),
      fecha_ingreso: fechaIngreso || null,
      estado,
      notas,
    };
    try {
      if (editingId !== null) {
        await empresaApi.updateEmpleado(editingId, body);
        setMsg(t.talento.msgUpdated.replace("{nombre}", body.nombre));
      } else {
        await empresaApi.createEmpleado(body);
        setMsg(t.talento.msgCreated.replace("{nombre}", body.nombre));
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.talento.errSave);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Empleado) => {
    if (!(await confirm(t.talento.confirmDelete.replace("{nombre}", r.nombre)))) return;
    setError(null);
    setMsg(null);
    try {
      await empresaApi.deleteEmpleado(r.id);
      if (editingId === r.id) resetForm();
      setMsg(t.talento.msgDeleted.replace("{nombre}", r.nombre));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.talento.errDelete);
    }
  };

  return (
    <>
      {dialog}
      <Panel
        title={t.talento.panelTitle}
        badge={
          <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
            {rows === null ? t.talento.loading : `${rows.length}`}
          </span>
        }
      >
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">
          {t.talento.intro} {isAdmin ? t.talento.introAdmin : t.talento.introViewer}
        </p>
        <div className="mb-4">
          <Field label={t.talento.searchAria}>
            <input className={inputCls} placeholder={t.talento.searchPlaceholder} value={query}
              onChange={(e) => setQuery(e.target.value)} aria-label={t.talento.searchAria} />
          </Field>
        </div>
        {loadError ? <ApiErrorBanner error={loadError} t={t} onRetry={load} /> : null}
        {rows === null ? (
          loadError ? null : <p className="py-4 text-center text-sm text-zinc-400">{t.talento.loading}</p>
        ) : visible.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-400">{t.talento.empty}</p>
        ) : (
          <>
            <ul className="space-y-3 sm:hidden">
              {visible.map((r) => (
                <li key={r.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-100">{r.nombre}</p>
                    <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                      {r.estado === "activo" ? t.talento.estadoActivo : t.talento.estadoInactivo}
                    </span>
                  </div>
                  {r.puesto && <p className="mt-1 text-sm text-zinc-300">{r.puesto}</p>}
                  {r.contacto && <p className="text-xs text-zinc-400">{r.contacto}</p>}
                  {r.fecha_ingreso && <p className="text-xs text-zinc-400">{r.fecha_ingreso}</p>}
                  {r.notas && <p className="mt-1 text-xs text-zinc-400">{r.notas}</p>}
                  {isAdmin && (
                    <span className="mt-3 flex gap-1.5">
                      <button onClick={() => startEdit(r)} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800">{t.talento.edit}</button>
                      <button onClick={() => remove(r)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-2.5 text-xs text-red-400 hover:bg-red-950/50">{t.talento.delete}</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-400">
                    <th className="py-3 pr-3 font-semibold">{t.talento.thNombre}</th>
                    <th className="py-3 pr-3 font-semibold">{t.talento.thPuesto}</th>
                    <th className="py-3 pr-3 font-semibold">{t.talento.thContacto}</th>
                    <th className="py-3 pr-3 font-semibold">{t.talento.thIngreso}</th>
                    <th className="py-3 pr-3 font-semibold">{t.talento.thEstado}</th>
                    {isAdmin && <th className="py-3 font-semibold">{t.talento.thAcciones}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {visible.map((r) => (
                    <tr key={r.id} className="align-top hover:bg-zinc-900/40">
                      <td className="py-3 pr-3"><span className="font-semibold text-zinc-100">{r.nombre}</span>{r.notas && <p className="mt-0.5 max-w-[260px] text-xs text-zinc-400">{r.notas}</p>}</td>
                      <td className="py-3 pr-3 text-zinc-300">{r.puesto || "—"}</td>
                      <td className="py-3 pr-3 text-zinc-300">{r.contacto || "—"}</td>
                      <td className="py-3 pr-3 text-zinc-300">{r.fecha_ingreso || "—"}</td>
                      <td className="py-3 pr-3 text-zinc-300">{r.estado === "activo" ? t.talento.estadoActivo : t.talento.estadoInactivo}</td>
                      {isAdmin && (
                        <td className="py-3">
                          <span className="flex gap-1.5">
                            <button onClick={() => startEdit(r)} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">{t.talento.edit}</button>
                            <button onClick={() => remove(r)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/50">{t.talento.delete}</button>
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {isAdmin && (
          <form onSubmit={submit} className="mt-5 space-y-3 border-t border-zinc-800 pt-5">
            <p className="text-sm font-semibold text-zinc-200">{editingId !== null ? t.talento.editTitle : t.talento.newTitle}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t.talento.nameAria}><input aria-label={t.talento.nameAria} className={inputCls} placeholder={t.talento.namePlaceholder} value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={128} autoComplete="off" /></Field>
              <Field label={t.talento.puestoAria}><input aria-label={t.talento.puestoAria} className={inputCls} placeholder={t.talento.puestoPlaceholder} value={puesto} onChange={(e) => setPuesto(e.target.value)} maxLength={128} autoComplete="off" /></Field>
              <Field label={t.talento.contactoAria}><input aria-label={t.talento.contactoAria} className={inputCls} placeholder={t.talento.contactoPlaceholder} value={contacto} onChange={(e) => setContacto(e.target.value)} maxLength={255} autoComplete="off" /></Field>
              <Field label={t.talento.ingresoAria}><input aria-label={t.talento.ingresoAria} className={inputCls} type="date" value={fechaIngreso} onChange={(e) => setFechaIngreso(e.target.value)} /></Field>
              <Field label={t.talento.estadoAria}><select className={inputCls} value={estado} onChange={(e) => setEstado(e.target.value as EmpleadoEstado)} aria-label={t.talento.estadoAria}>
                <option value="activo">{t.talento.estadoActivo}</option>
                <option value="inactivo">{t.talento.estadoInactivo}</option>
              </select></Field>
            </div>
            <Field label={t.talento.notasAria}><textarea aria-label={t.talento.notasAria} className={inputCls} placeholder={t.talento.notasPlaceholder} value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} /></Field>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="min-h-[44px] flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{busy ? t.talento.saving : editingId !== null ? t.talento.saveChanges : t.talento.create}</button>
              {editingId !== null && <button type="button" onClick={resetForm} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800">{t.talento.cancel}</button>}
            </div>
            {msg && <p className="text-sm text-emerald-400">{msg}</p>}
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          </form>
        )}
      </Panel>
    </>
  );
}
