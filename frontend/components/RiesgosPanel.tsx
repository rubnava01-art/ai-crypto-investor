"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type MeResponse } from "../lib/api";
import { empresaApi, type Riesgo, type RiesgoEstado, type RiesgoImpacto, type RiesgoProbabilidad } from "../lib/api/empresa";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { ApiErrorBanner, useConfirm, Field } from "./ui";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

/** Gestión de Riesgos: registro de riesgos con probabilidad, impacto,
 * mitigación y estado. Empieza VACÍO. Prueba lee la lista completa en
 * solo lectura; solo admin crea/edita/borra. */
export function RiesgosPanel() {
  const { t } = useLanguage();
  const isCancelled = useCancelled();
  const { confirm, dialog } = useConfirm(t);
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;
  const [rows, setRows] = useState<Riesgo[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [riesgo, setRiesgo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [probabilidad, setProbabilidad] = useState<RiesgoProbabilidad>("media");
  const [impacto, setImpacto] = useState<RiesgoImpacto>("medio");
  const [mitigacion, setMitigacion] = useState("");
  const [responsable, setResponsable] = useState("");
  const [estado, setEstado] = useState<RiesgoEstado>("abierto");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await empresaApi.listRiesgos();
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

  const probLabel = (p: string) =>
    p === "baja" ? t.riesgos.probBaja : p === "alta" ? t.riesgos.probAlta : t.riesgos.probMedia;
  const impLabel = (v: string) =>
    v === "bajo" ? t.riesgos.impBajo : v === "alto" ? t.riesgos.impAlto : t.riesgos.impMedio;
  const estadoLabel = (v: string) =>
    v === "en_curso" ? t.riesgos.estadoEnCurso : v === "mitigado" ? t.riesgos.estadoMitigado : v === "cerrado" ? t.riesgos.estadoCerrado : t.riesgos.estadoAbierto;

  const visible = (rows ?? []).filter((r) => {
    const q = query.trim().toLowerCase();
    if (estadoFilter && r.estado !== estadoFilter) return false;
    if (!q) return true;
    return [r.riesgo, r.descripcion, r.responsable].join(" ").toLowerCase().includes(q);
  });

  const resetForm = () => {
    setEditingId(null);
    setRiesgo("");
    setDescripcion("");
    setProbabilidad("media");
    setImpacto("medio");
    setMitigacion("");
    setResponsable("");
    setEstado("abierto");
  };

  const startEdit = (r: Riesgo) => {
    setEditingId(r.id);
    setRiesgo(r.riesgo);
    setDescripcion(r.descripcion);
    setProbabilidad(r.probabilidad);
    setImpacto(r.impacto);
    setMitigacion(r.mitigacion);
    setResponsable(r.responsable);
    setEstado(r.estado);
    setMsg(null);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    const body = { riesgo: riesgo.trim(), descripcion, probabilidad, impacto, mitigacion, responsable: responsable.trim(), estado };
    try {
      if (editingId !== null) {
        await empresaApi.updateRiesgo(editingId, body);
        setMsg(t.riesgos.msgUpdated.replace("{nombre}", body.riesgo));
      } else {
        await empresaApi.createRiesgo(body);
        setMsg(t.riesgos.msgCreated.replace("{nombre}", body.riesgo));
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.riesgos.errSave);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Riesgo) => {
    if (!(await confirm(t.riesgos.confirmDelete.replace("{nombre}", r.riesgo)))) return;
    setError(null);
    setMsg(null);
    try {
      await empresaApi.deleteRiesgo(r.id);
      if (editingId === r.id) resetForm();
      setMsg(t.riesgos.msgDeleted.replace("{nombre}", r.riesgo));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.riesgos.errDelete);
    }
  };

  return (
    <>
      {dialog}
      <Panel
        title={t.riesgos.panelTitle}
        badge={
          <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
            {rows === null ? t.riesgos.loading : `${rows.length}`}
          </span>
        }
      >
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">
          {t.riesgos.intro} {isAdmin ? t.riesgos.introAdmin : t.riesgos.introViewer}
        </p>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
          <Field label={t.riesgos.searchAria}>
            <input className={inputCls} placeholder={t.riesgos.searchPlaceholder} value={query}
              onChange={(e) => setQuery(e.target.value)} aria-label={t.riesgos.searchAria} />
          </Field>
          <Field label={t.riesgos.filterAria}>
            <select className={inputCls} value={estadoFilter} onChange={(e) => setEstadoFilter(e.target.value)} aria-label={t.riesgos.filterAria}>
              <option value="">{t.riesgos.allStatuses}</option>
              <option value="abierto">{t.riesgos.estadoAbierto}</option>
              <option value="en_curso">{t.riesgos.estadoEnCurso}</option>
              <option value="mitigado">{t.riesgos.estadoMitigado}</option>
              <option value="cerrado">{t.riesgos.estadoCerrado}</option>
            </select>
          </Field>
        </div>
        {loadError ? <ApiErrorBanner error={loadError} t={t} onRetry={load} /> : null}
        {rows === null ? (
          loadError ? null : <p className="py-4 text-center text-sm text-zinc-400">{t.riesgos.loading}</p>
        ) : visible.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-400">{t.riesgos.empty}</p>
        ) : (
          <ul className="space-y-3">
            {visible.map((r) => (
              <li key={r.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-100">{r.riesgo}</p>
                  <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{estadoLabel(r.estado)}</span>
                </div>
                {r.descripcion && <p className="mt-1 text-sm text-zinc-300">{r.descripcion}</p>}
                <p className="mt-1 text-xs text-zinc-400">{t.riesgos.probLabel}: {probLabel(r.probabilidad)} · {t.riesgos.impLabel}: {impLabel(r.impacto)}</p>
                {r.mitigacion && <p className="mt-1 text-xs text-zinc-400">{t.riesgos.mitigLabel}: {r.mitigacion}</p>}
                {r.responsable && <p className="text-xs text-zinc-400">{t.riesgos.respLabel}: {r.responsable}</p>}
                {isAdmin && (
                  <span className="mt-3 flex gap-1.5">
                    <button onClick={() => startEdit(r)} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800">{t.riesgos.edit}</button>
                    <button onClick={() => remove(r)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-2.5 text-xs text-red-400 hover:bg-red-950/50">{t.riesgos.delete}</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && (
          <form onSubmit={submit} className="mt-5 space-y-3 border-t border-zinc-800 pt-5">
            <p className="text-sm font-semibold text-zinc-200">{editingId !== null ? t.riesgos.editTitle : t.riesgos.newTitle}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t.riesgos.riesgoAria}><input aria-label={t.riesgos.riesgoAria} className={inputCls} placeholder={t.riesgos.riesgoPlaceholder} value={riesgo} onChange={(e) => setRiesgo(e.target.value)} required maxLength={200} autoComplete="off" /></Field>
              <Field label={t.riesgos.respAria}><input aria-label={t.riesgos.respAria} className={inputCls} placeholder={t.riesgos.respPlaceholder} value={responsable} onChange={(e) => setResponsable(e.target.value)} maxLength={128} autoComplete="off" /></Field>
              <Field label={t.riesgos.probAria}><select className={inputCls} value={probabilidad} onChange={(e) => setProbabilidad(e.target.value as RiesgoProbabilidad)} aria-label={t.riesgos.probAria}>
                <option value="baja">{t.riesgos.probBaja}</option>
                <option value="media">{t.riesgos.probMedia}</option>
                <option value="alta">{t.riesgos.probAlta}</option>
              </select></Field>
              <Field label={t.riesgos.impAria}><select className={inputCls} value={impacto} onChange={(e) => setImpacto(e.target.value as RiesgoImpacto)} aria-label={t.riesgos.impAria}>
                <option value="bajo">{t.riesgos.impBajo}</option>
                <option value="medio">{t.riesgos.impMedio}</option>
                <option value="alto">{t.riesgos.impAlto}</option>
              </select></Field>
              <Field label={t.riesgos.estadoAria}><select className={inputCls} value={estado} onChange={(e) => setEstado(e.target.value as RiesgoEstado)} aria-label={t.riesgos.estadoAria}>
                <option value="abierto">{t.riesgos.estadoAbierto}</option>
                <option value="en_curso">{t.riesgos.estadoEnCurso}</option>
                <option value="mitigado">{t.riesgos.estadoMitigado}</option>
                <option value="cerrado">{t.riesgos.estadoCerrado}</option>
              </select></Field>
            </div>
            <Field label={t.riesgos.descAria}><textarea aria-label={t.riesgos.descAria} className={inputCls} placeholder={t.riesgos.descPlaceholder} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} /></Field>
            <Field label={t.riesgos.mitigAria}><textarea aria-label={t.riesgos.mitigAria} className={inputCls} placeholder={t.riesgos.mitigPlaceholder} value={mitigacion} onChange={(e) => setMitigacion(e.target.value)} rows={2} /></Field>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="min-h-[44px] flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{busy ? t.riesgos.saving : editingId !== null ? t.riesgos.saveChanges : t.riesgos.create}</button>
              {editingId !== null && <button type="button" onClick={resetForm} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800">{t.riesgos.cancel}</button>}
            </div>
            {msg && <p className="text-sm text-emerald-400">{msg}</p>}
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          </form>
        )}
      </Panel>
    </>
  );
}
