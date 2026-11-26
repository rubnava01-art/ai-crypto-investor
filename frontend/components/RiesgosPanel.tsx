"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { api, ApiError, type MeResponse } from "../lib/api";
import { empresaApi, type Riesgo, type RiesgoEstado, type RiesgoImpacto, type RiesgoProbabilidad } from "../lib/api/empresa";
import { Panel } from "./Panel";
import { EmptyState } from "./badges";
import { ListSkeleton } from "./Skeleton";
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
  const [probFilter, setProbFilter] = useState("");
  const [impFilter, setImpFilter] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [riesgo, setRiesgo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [probabilidad, setProbabilidad] = useState<RiesgoProbabilidad>("media");
  const [impacto, setImpacto] = useState<RiesgoImpacto>("medio");
  const [mitigacion, setMitigacion] = useState("");
  const [responsable, setResponsable] = useState("");
  const [estado, setEstado] = useState<RiesgoEstado>("abierto");
  // Fecha de revisión (Fase 5b, tarea 4): "" = sin fecha fijada.
  const [fechaRevision, setFechaRevision] = useState("");
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
  // Color semántico del estado y del nivel (2026-11-25): antes el estado
  // era un chip gris y probabilidad/impacto texto plano; ahora abierto/
  // alto se distingue de mitigado/bajo de un vistazo.
  const estadoBadge: Record<string, string> = {
    abierto: "bg-amber-500/15 text-amber-300",
    en_curso: "bg-sky-500/15 text-sky-300",
    mitigado: "bg-emerald-500/15 text-emerald-300",
    cerrado: "bg-zinc-500/15 text-zinc-400",
  };
  const nivelColor = (v: string) =>
    v === "alta" || v === "alto" ? "font-semibold text-red-400" : v === "media" || v === "medio" ? "font-semibold text-amber-300" : "text-zinc-300";

  // Filtro memorizado (2026-11-24): antes se recalculaba en cada
  // render; con la lista en memo ya no se re-pide, y el filtrado no
  // se rehace si no cambian filas o filtros.
  const visible = useMemo(() => (rows ?? []).filter((r) => {
    const q = query.trim().toLowerCase();
    if (estadoFilter && r.estado !== estadoFilter) return false;
    if (probFilter && r.probabilidad !== probFilter) return false;
    if (impFilter && r.impacto !== impFilter) return false;
    if (!q) return true;
    return [r.riesgo, r.descripcion, r.responsable].join(" ").toLowerCase().includes(q);
  }), [rows, query, estadoFilter, probFilter, impFilter]);
  // Conteo filtrado (2026-11-24): con búsqueda o filtros activos el
  // badge muestra "visibles / total", mismo patrón que Talento,
  // Planillas y Facturas; sin filtro, solo el total como antes.
  const filtering = query.trim() !== "" || estadoFilter !== "" || probFilter !== "" || impFilter !== "";

  // Matriz de probabilidad × impacto (Fase 5b, tarea 4): las escalas
  // del registro son de 3 niveles (baja/media/alta × bajo/medio/alto),
  // así que la tabla es 3×3 — el equivalente de la 5×5 pedida sin
  // cambiar los enums ni los datos existentes. Cuenta solo riesgos
  // abiertos o en curso; mitigados y cerrados no suman urgencia.
  // Nivel = probabilidad(1-3) × impacto(1-3): >=6 alto, >=3 medio.
  const probIdx = (p: string) => (p === "alta" ? 3 : p === "media" ? 2 : 1);
  const impIdx = (v: string) => (v === "alto" ? 3 : v === "medio" ? 2 : 1);
  const nivelOf = (r: Riesgo) => {
    const s = probIdx(r.probabilidad) * impIdx(r.impacto);
    return s >= 6 ? "alto" : s >= 3 ? "medio" : "bajo";
  };
  const nivelLabel = (n: string) =>
    n === "alto" ? t.riesgos.nivelAlto : n === "medio" ? t.riesgos.nivelMedio : t.riesgos.nivelBajo;
  const activos = useMemo(
    () => (rows ?? []).filter((r) => r.estado === "abierto" || r.estado === "en_curso"),
    [rows],
  );
  const matrixProbs: RiesgoProbabilidad[] = ["alta", "media", "baja"];
  const matrixImps: RiesgoImpacto[] = ["bajo", "medio", "alto"];
  const matrixCount = (p: RiesgoProbabilidad, v: RiesgoImpacto) =>
    activos.filter((r) => r.probabilidad === p && r.impacto === v).length;
  const matrixCellCls = (p: RiesgoProbabilidad, v: RiesgoImpacto) => {
    const s = probIdx(p) * impIdx(v);
    const base = "flex min-h-[52px] flex-col items-center justify-center rounded-lg border px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";
    if (s >= 6) return `${base} border-red-700/60 bg-red-500/15 text-red-200 hover:bg-red-500/25`;
    if (s >= 3) return `${base} border-amber-700/60 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20`;
    return `${base} border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800`;
  };
  // Revisión vencida: fecha pasada y riesgo aún abierto o en curso.
  const todayIso = new Date().toISOString().slice(0, 10);
  const revisionVencida = (r: Riesgo) =>
    !!r.fecha_revision && r.fecha_revision < todayIso && (r.estado === "abierto" || r.estado === "en_curso");

  const resetForm = () => {
    setEditingId(null);
    setRiesgo("");
    setDescripcion("");
    setProbabilidad("media");
    setImpacto("medio");
    setMitigacion("");
    setResponsable("");
    setEstado("abierto");
    setFechaRevision("");
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
    setFechaRevision(r.fecha_revision ?? "");
    setMsg(null);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    const body = { riesgo: riesgo.trim(), descripcion, probabilidad, impacto, mitigacion, responsable: responsable.trim(), estado, fecha_revision: fechaRevision || null };
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
      setError(t.riesgos.errSave);
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
      setError(t.riesgos.errDelete);
    }
  };

  return (
    <>
      {dialog}
      <Panel
        title={t.riesgos.panelTitle}
        badge={
          <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
            {rows === null ? t.riesgos.loading : filtering ? `${visible.length} / ${rows.length}` : `${rows.length}`}
          </span>
        }
      >
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">
          {t.riesgos.intro} {isAdmin ? t.riesgos.introAdmin : t.riesgos.introViewer}
        </p>
        {/* Matriz de probabilidad × impacto (Fase 5b, tarea 4): 3×3
          porque las escalas del registro son de 3 niveles. Cada celda
          cuenta riesgos abiertos o en curso; al pulsarla filtra la
          lista por esa probabilidad e impacto. */}
        {rows !== null && rows.length > 0 && (
          <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <p className="mb-1 text-sm font-semibold text-zinc-200">{t.riesgos.matrixTitle}</p>
            <p className="mb-3 text-xs text-zinc-400">{t.riesgos.matrixNote}</p>
            <div className="grid grid-cols-[72px_repeat(3,1fr)] gap-1.5" role="grid" aria-label={t.riesgos.matrixTitle}>
              <span className="flex items-end pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{t.riesgos.matrixProb} \ {t.riesgos.matrixImp}</span>
              {matrixImps.map((v) => (
                <span key={v} className="pb-1 text-center text-xs font-semibold text-zinc-400">{impLabel(v)}</span>
              ))}
              {matrixProbs.map((p) => (
                <Fragment key={`row-${p}`}>
                  <span className="flex items-center text-xs font-semibold text-zinc-400">{probLabel(p)}</span>
                  {matrixImps.map((v) => (
                    <button
                      key={`${p}-${v}`}
                      type="button"
                      role="gridcell"
                      onClick={() => { setProbFilter(p); setImpFilter(v); }}
                      title={`${probLabel(p)} · ${impLabel(v)}`}
                      className={matrixCellCls(p, v)}
                    >
                      <span className="text-base font-bold leading-none">{matrixCount(p, v)}</span>
                      <span className="mt-0.5 text-[10px] leading-none">{nivelLabel(probIdx(p) * impIdx(v) >= 6 ? "alto" : probIdx(p) * impIdx(v) >= 3 ? "medio" : "bajo")}</span>
                    </button>
                  ))}
                </Fragment>
              ))}
            </div>
            {(probFilter || impFilter) && (
              <button type="button" onClick={() => { setProbFilter(""); setImpFilter(""); }} className="mt-3 min-h-[44px] rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
                {t.riesgos.allProbs} · {t.riesgos.allImps}
              </button>
            )}
          </div>
        )}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_180px_180px]">
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
          <Field label={t.riesgos.filterProbAria}>
            <select className={inputCls} value={probFilter} onChange={(e) => setProbFilter(e.target.value)} aria-label={t.riesgos.filterProbAria}>
              <option value="">{t.riesgos.allProbs}</option>
              <option value="alta">{t.riesgos.probAlta}</option>
              <option value="media">{t.riesgos.probMedia}</option>
              <option value="baja">{t.riesgos.probBaja}</option>
            </select>
          </Field>
          <Field label={t.riesgos.filterImpAria}>
            <select className={inputCls} value={impFilter} onChange={(e) => setImpFilter(e.target.value)} aria-label={t.riesgos.filterImpAria}>
              <option value="">{t.riesgos.allImps}</option>
              <option value="alto">{t.riesgos.impAlto}</option>
              <option value="medio">{t.riesgos.impMedio}</option>
              <option value="bajo">{t.riesgos.impBajo}</option>
            </select>
          </Field>
        </div>
        {loadError ? <ApiErrorBanner error={loadError} t={t} onRetry={load} /> : null}
        {rows === null ? (
          loadError ? null : <ListSkeleton ariaLabel={t.misc.loadingAria} />
        ) : visible.length === 0 ? (
          <EmptyState
            text={(rows ?? []).length > 0 ? t.riesgos.emptyFiltered : t.riesgos.empty}
            actionLabel={isAdmin && rows.length === 0 ? t.riesgos.create : undefined}
            onAction={
              isAdmin && rows.length === 0
                ? () => {
                    document.getElementById("riesgos-form")?.scrollIntoView({ behavior: "smooth" });
                    document.getElementById("riesgos-nuevo-riesgo")?.focus({ preventScroll: true });
                  }
                : undefined
            }
          />
        ) : (
          <ul className="space-y-3">
            {visible.map((r) => (
              <li key={r.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-100">{r.riesgo}</p>
                  <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${estadoBadge[r.estado] ?? estadoBadge.abierto}`}>{estadoLabel(r.estado)}</span>
                </div>
                {r.descripcion && <p className="mt-1 text-sm text-zinc-300">{r.descripcion}</p>}
                <p className="mt-1 text-xs text-zinc-400">{t.riesgos.probLabel}: <span className={nivelColor(r.probabilidad)}>{probLabel(r.probabilidad)}</span> · {t.riesgos.impLabel}: <span className={nivelColor(r.impacto)}>{impLabel(r.impacto)}</span> · {t.riesgos.nivelLabel}: {nivelLabel(nivelOf(r))}</p>
                {r.mitigacion && <p className="mt-1 text-xs text-zinc-400">{t.riesgos.mitigLabel}: {r.mitigacion}</p>}
                {r.responsable && <p className="text-xs text-zinc-400">{t.riesgos.respLabel}: {r.responsable}</p>}
                {r.fecha_revision && (
                  <p className={`text-xs ${revisionVencida(r) ? "font-semibold text-red-300" : "text-zinc-400"}`}>
                    {t.riesgos.reviewLabel.replace("{fecha}", r.fecha_revision)}
                    {revisionVencida(r) ? ` · ${t.riesgos.reviewOverdue}` : ""}
                  </p>
                )}
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
          <form id="riesgos-form" onSubmit={submit} className="mt-5 space-y-3 border-t border-zinc-800 pt-5">
            <p className="text-sm font-semibold text-zinc-200">{editingId !== null ? t.riesgos.editTitle : t.riesgos.newTitle}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t.riesgos.riesgoAria}><input id="riesgos-nuevo-riesgo" aria-label={t.riesgos.riesgoAria} className={inputCls} placeholder={t.riesgos.riesgoPlaceholder} value={riesgo} onChange={(e) => setRiesgo(e.target.value)} required maxLength={200} autoComplete="off" /></Field>
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
              <Field label={t.riesgos.reviewAria}><input aria-label={t.riesgos.reviewAria} type="date" className={inputCls} value={fechaRevision} onChange={(e) => setFechaRevision(e.target.value)} /></Field>
            </div>
            <Field label={t.riesgos.descAria}><textarea aria-label={t.riesgos.descAria} className={inputCls} placeholder={t.riesgos.descPlaceholder} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} /></Field>
            <Field label={t.riesgos.mitigAria}><textarea aria-label={t.riesgos.mitigAria} className={inputCls} placeholder={t.riesgos.mitigPlaceholder} value={mitigacion} onChange={(e) => setMitigacion(e.target.value)} rows={2} /></Field>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="min-h-[44px] flex-1 rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{busy ? t.riesgos.saving : editingId !== null ? t.riesgos.saveChanges : t.riesgos.create}</button>
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
