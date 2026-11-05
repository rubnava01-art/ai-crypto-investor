"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type MeResponse } from "../lib/api";
import { empresaApi, type Planilla, type PlanillaEstado } from "../lib/api/empresa";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { ApiErrorBanner, useConfirm, Field } from "./ui";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

/** Planillas: REGISTROS de nómina solamente (periodo, empleado, monto,
 * estado). No hay cálculo de impuestos, no hay pagos ni movimiento de
 * dinero: el monto se guarda tal como se registra. Empieza VACÍO.
 * Solo admin crea/edita/borra; prueba ve lista vacía (el backend la
 * devuelve vacía) con su aviso de solo lectura. */
export function PlanillasPanel() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const isCancelled = useCancelled();
  const { confirm, dialog } = useConfirm(t);
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;
  const [rows, setRows] = useState<Planilla[] | null>(null);
  const [empleados, setEmpleados] = useState<{ id: number; nombre: string }[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [periodoFilter, setPeriodoFilter] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [periodo, setPeriodo] = useState("");
  const [empleadoId, setEmpleadoId] = useState("");
  const [monto, setMonto] = useState("");
  const [estado, setEstado] = useState<PlanillaEstado>("pendiente");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await empresaApi.listPlanillas();
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
    // Lista de empleados solo para el selector del formulario (admin).
    // Si falla o viene vacía (prueba), el formulario permite escribir el
    // periodo y el monto sin empleado asociado.
    empresaApi.listEmpleados()
      .then((list) => { if (!isCancelled()) setEmpleados(list.map((e) => ({ id: e.id, nombre: e.nombre }))); })
      .catch(() => { if (!isCancelled()) setEmpleados([]); });
  }, [load, isCancelled]);

  const visible = useMemo(() => {
    const q = periodoFilter.trim();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((r) => r.periodo.includes(q));
  }, [rows, periodoFilter]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    return {
      pendiente: list.filter((r) => r.estado === "pendiente").reduce((a, r) => a + r.monto, 0),
      pagado: list.filter((r) => r.estado === "pagado").reduce((a, r) => a + r.monto, 0),
    };
  }, [rows]);

  const fmt = (n: number) => n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const resetForm = () => {
    setEditingId(null);
    setPeriodo("");
    setEmpleadoId("");
    setMonto("");
    setEstado("pendiente");
    setNotas("");
  };

  const startEdit = (r: Planilla) => {
    setEditingId(r.id);
    setPeriodo(r.periodo);
    setEmpleadoId(r.empleado_id !== null ? String(r.empleado_id) : "");
    setMonto(String(r.monto));
    setEstado(r.estado);
    setNotas(r.notas);
    setMsg(null);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(monto);
    if (!Number.isFinite(parsed)) {
      setError(t.planillas.errMonto);
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    const body = {
      periodo: periodo.trim(),
      empleado_id: empleadoId ? Number(empleadoId) : null,
      monto: parsed,
      estado,
      notas,
    };
    try {
      if (editingId !== null) {
        await empresaApi.updatePlanilla(editingId, body);
        setMsg(t.planillas.msgUpdated.replace("{periodo}", body.periodo));
      } else {
        await empresaApi.createPlanilla(body);
        setMsg(t.planillas.msgCreated.replace("{periodo}", body.periodo));
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.planillas.errSave);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Planilla) => {
    if (!(await confirm(t.planillas.confirmDelete.replace("{periodo}", r.periodo)))) return;
    setError(null);
    setMsg(null);
    try {
      await empresaApi.deletePlanilla(r.id);
      if (editingId === r.id) resetForm();
      setMsg(t.planillas.msgDeleted.replace("{periodo}", r.periodo));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.planillas.errDelete);
    }
  };

  return (
    <>
      {dialog}
      <Panel
        title={t.planillas.panelTitle}
        badge={
          <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
            {rows === null ? t.planillas.loading : `${rows.length}`}
          </span>
        }
      >
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">
          {t.planillas.intro} {isAdmin ? t.planillas.introAdmin : t.planillas.introViewer}
        </p>
        <p className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-xs leading-relaxed text-zinc-400">
          {t.planillas.recordNote}
        </p>
        {rows !== null && rows.length > 0 && (
          <p className="mb-4 text-sm text-zinc-300">
            {t.planillas.totalPendiente}: {fmt(totals.pendiente)} · {t.planillas.totalPagado}: {fmt(totals.pagado)}
          </p>
        )}
        <div className="mb-4">
          <Field label={t.planillas.filterAria}>
            <input className={inputCls} placeholder={t.planillas.filterPlaceholder} value={periodoFilter}
              onChange={(e) => setPeriodoFilter(e.target.value)} aria-label={t.planillas.filterAria} />
          </Field>
        </div>
        {loadError ? <ApiErrorBanner error={loadError} t={t} onRetry={load} /> : null}
        {rows === null ? (
          loadError ? null : <p className="py-4 text-center text-sm text-zinc-400">{t.planillas.loading}</p>
        ) : visible.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-400">{t.planillas.empty}</p>
        ) : (
          <ul className="space-y-3">
            {visible.map((r) => (
              <li key={r.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-100">{r.periodo} · {fmt(r.monto)}</p>
                  <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                    {r.estado === "pagado" ? t.planillas.estadoPagado : t.planillas.estadoPendiente}
                  </span>
                </div>
                <p className="mt-1 text-sm text-zinc-300">{r.empleado_nombre ? r.empleado_nombre : t.planillas.noEmpleado}</p>
                {r.notas && <p className="mt-1 text-xs text-zinc-400">{r.notas}</p>}
                {isAdmin && (
                  <span className="mt-3 flex gap-1.5">
                    <button onClick={() => startEdit(r)} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800">{t.planillas.edit}</button>
                    <button onClick={() => remove(r)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-2.5 text-xs text-red-400 hover:bg-red-950/50">{t.planillas.delete}</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && (
          <form onSubmit={submit} className="mt-5 space-y-3 border-t border-zinc-800 pt-5">
            <p className="text-sm font-semibold text-zinc-200">{editingId !== null ? t.planillas.editTitle : t.planillas.newTitle}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t.planillas.periodoAria}>
                <input aria-label={t.planillas.periodoAria} className={inputCls} placeholder={t.planillas.periodoPlaceholder} value={periodo} onChange={(e) => setPeriodo(e.target.value)} required maxLength={7} autoComplete="off" />
              </Field>
              <Field label={t.planillas.empleadoAria}>
                <select className={inputCls} value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)} aria-label={t.planillas.empleadoAria}>
                  <option value="">{t.planillas.noEmpleado}</option>
                  {empleados.map((e) => (
                    <option key={e.id} value={String(e.id)}>{e.nombre}</option>
                  ))}
                </select>
              </Field>
              <Field label={t.planillas.montoAria}>
                <input aria-label={t.planillas.montoAria} className={inputCls} type="number" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} required autoComplete="off" />
              </Field>
              <Field label={t.planillas.estadoAria}>
                <select className={inputCls} value={estado} onChange={(e) => setEstado(e.target.value as PlanillaEstado)} aria-label={t.planillas.estadoAria}>
                  <option value="pendiente">{t.planillas.estadoPendiente}</option>
                  <option value="pagado">{t.planillas.estadoPagado}</option>
                </select>
              </Field>
            </div>
            <Field label={t.planillas.notasAria}><textarea aria-label={t.planillas.notasAria} className={inputCls} placeholder={t.planillas.notasPlaceholder} value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} /></Field>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="min-h-[44px] flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{busy ? t.planillas.saving : editingId !== null ? t.planillas.saveChanges : t.planillas.create}</button>
              {editingId !== null && <button type="button" onClick={resetForm} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800">{t.planillas.cancel}</button>}
            </div>
            {msg && <p className="text-sm text-emerald-400">{msg}</p>}
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          </form>
        )}
      </Panel>
    </>
  );
}
