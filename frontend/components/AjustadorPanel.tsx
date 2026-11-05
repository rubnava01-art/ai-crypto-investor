"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type MeResponse } from "../lib/api";
import {
  ajustadorApi,
  SECCIONES_AJUSTADOR,
  type AgenteKey,
  type Ajuste,
  type AjusteEstado,
} from "../lib/api/ajustador";
import { Panel } from "./Panel";
import { familyForHref } from "./ModuleNav";
import { useLanguage, type NavKey } from "../lib/i18n";
import { novedadesSistema } from "../lib/novedades";
import { useCancelled } from "../lib/useLoad";
import { ApiErrorBanner, useConfirm, Field } from "./ui";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

/** Agente optimizador por sección (sistema de 3 agentes, AGENT-SYSTEM.md):
 * Agente 1 UI/UX y Frontend, Agente 2 Performance y Backend, Agente 3
 * QA, Seguridad y Calidad. */
const AGENT_BY_SECTION: Record<string, AgenteKey> = {
  inicio: "agente1",
  estudiar: "agente1",
  crear: "agente1",
  analizador: "agente1",
  espacio: "agente1",
  perfil: "agente1",
  chat: "agente1",
  recomendaciones: "agente1",
  tendencias: "agente1",
  invertir: "agente2",
  crm: "agente2",
  facturas: "agente2",
  correos: "agente2",
  inventario: "agente2",
  analisis: "agente2",
  auditor: "agente2",
  desarrollo: "agente2",
  referidos: "agente3",
  business: "agente3",
  talento: "agente3",
  riesgos: "agente3",
  planillas: "agente3",
  privacidad: "agente3",
  usuarios: "agente3",
};

/** Últimas mejoras por sección: índices en novedadesSistema (ya
 * ordenado de más reciente a más antiguo). Una entrada se asigna a
 * una sección SOLO cuando su texto la nombra — nunca se inventa.
 * Las entradas de SEO (2026-11-03) y de la interfaz PRO (2026-11-01)
 * son de todo el sitio y no se asignan a ninguna sección. Las
 * secciones sin entrada muestran "Sin mejoras registradas".
 * OJO: al anteponer entradas nuevas, todos los índices existentes
 * se desplazan; este mapa se actualizó con las 2 entradas del
 * 2026-11-05 ([0] Ajustador+Videos, [1] diaria salud de la BD). */
const LAST_BY_SECTION: Record<string, number[]> = {
  ajustador: [0],
  estudiar: [0, 3, 4],
  inicio: [1, 9],
  perfil: [2],
  talento: [5],
  riesgos: [5],
  planillas: [5],
  crm: [5],
  analisis: [5],
  invertir: [6, 8],
  usuarios: [8, 9],
  espacio: [9],
};

/** Ajustador: tablero de mejora continua. Es un TABLERO DE GESTIÓN,
 * no un ejecutor de código: el trabajo real de los agentes se hace a
 * través de Swapy en las sesiones y en las mejoras diarias; el tablero
 * lo registra y lo sigue. Las propuestas son solo propuestas (estado
 * propuesta/en_curso/aplicada) y la lista empieza VACÍA. Solo admin
 * propone/edita/borra; prueba ve el tablero y las propuestas en solo
 * lectura (la página NO redirige a prueba, a diferencia de /usuarios). */
export function AjustadorPanel() {
  const { t } = useLanguage();
  const isCancelled = useCancelled();
  const { confirm, dialog } = useConfirm(t);
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;
  const [rows, setRows] = useState<Ajuste[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [seccion, setSeccion] = useState("crm");
  const [agente, setAgente] = useState<AgenteKey>("agente1");
  const [propuesta, setPropuesta] = useState("");
  const [estado, setEstado] = useState<AjusteEstado>("propuesta");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await ajustadorApi.listAjustes();
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

  const sectionLabel = (key: string) =>
    t.nav[key as NavKey]?.label ?? key;
  const familyLabel = (key: string) =>
    t.navGroups[familyForHref(key === "invertir" ? "/" : `/${key}`)] ?? familyForHref(key);
  const agentLabel = (key: AgenteKey) =>
    key === "agente1" ? t.ajustador.agent1 : key === "agente2" ? t.ajustador.agent2 : t.ajustador.agent3;
  const statusLabel = (s: AjusteEstado) =>
    s === "propuesta" ? t.ajustador.statusPropuesta : s === "en_curso" ? t.ajustador.statusEnCurso : t.ajustador.statusAplicada;
  const lastImprovements = (key: string) =>
    (LAST_BY_SECTION[key] ?? [])
      .map((i) => novedadesSistema[i])
      .filter(Boolean);

  const resetForm = () => {
    setEditingId(null);
    setSeccion("crm");
    setAgente("agente1");
    setPropuesta("");
    setEstado("propuesta");
  };

  const startEdit = (r: Ajuste) => {
    setEditingId(r.id);
    setSeccion(r.seccion);
    setAgente(r.agente);
    setPropuesta(r.propuesta);
    setEstado(r.estado);
    setMsg(null);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    const body = {
      seccion,
      agente,
      propuesta: propuesta.trim(),
      estado,
    };
    try {
      if (editingId !== null) {
        await ajustadorApi.updateAjuste(editingId, body);
        setMsg(t.ajustador.msgUpdated);
      } else {
        await ajustadorApi.createAjuste(body);
        setMsg(t.ajustador.msgCreated);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.ajustador.errSave);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Ajuste) => {
    if (!(await confirm(t.ajustador.confirmDelete))) return;
    setError(null);
    setMsg(null);
    try {
      await ajustadorApi.deleteAjuste(r.id);
      if (editingId === r.id) resetForm();
      setMsg(t.ajustador.msgDeleted);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.ajustador.errDelete);
    }
  };

  return (
    <>
      {dialog}
      <Panel
        title={t.ajustador.panelTitle}
        badge={
          <span className="shrink-0 whitespace-nowrap rounded-full bg-zinc-600/25 px-2.5 py-1 text-xs font-semibold text-zinc-300">
            {t.ajustador.adminLabel}
          </span>
        }
      >
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">{t.ajustador.intro}</p>
        {me && !isAdmin && (
          <p className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2.5 text-sm text-amber-200">
            {t.ajustador.readOnly}
          </p>
        )}

        {/* Tablero de secciones */}
        <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.ajustador.boardTitle}</h3>
        <ul className="mb-6 space-y-3 sm:hidden">
          {SECCIONES_AJUSTADOR.map((key) => {
            const last = lastImprovements(key);
            return (
              <li key={key} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-100">{sectionLabel(key)}</p>
                  <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                    {familyLabel(key)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-400">{agentLabel(AGENT_BY_SECTION[key])}</p>
                {last.length === 0 ? (
                  <p className="mt-1 text-xs italic text-zinc-500">{t.ajustador.noImprovement}</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {last.map((n) => (
                      <li key={n.date + n.title} className="text-xs text-zinc-300">
                        {n.title} <span className="text-zinc-500">({n.date})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mb-6 hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-400">
                <th className="py-3 pr-3 font-semibold">{t.ajustador.thSection}</th>
                <th className="py-3 pr-3 font-semibold">{t.ajustador.thFamily}</th>
                <th className="py-3 pr-3 font-semibold">{t.ajustador.thAgent}</th>
                <th className="py-3 font-semibold">{t.ajustador.thLast}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {SECCIONES_AJUSTADOR.map((key) => {
                const last = lastImprovements(key);
                return (
                  <tr key={key} className="align-top hover:bg-zinc-900/40">
                    <td className="py-3 pr-3"><span className="font-semibold text-zinc-100">{sectionLabel(key)}</span></td>
                    <td className="py-3 pr-3 text-zinc-300">{familyLabel(key)}</td>
                    <td className="py-3 pr-3 text-zinc-300">{agentLabel(AGENT_BY_SECTION[key])}</td>
                    <td className="py-3">
                      {last.length === 0 ? (
                        <span className="text-xs italic text-zinc-500">{t.ajustador.noImprovement}</span>
                      ) : (
                        <ul className="space-y-1">
                          {last.map((n) => (
                            <li key={n.date + n.title} className="text-xs text-zinc-300">
                              {n.title} <span className="text-zinc-500">({n.date})</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mejoras propuestas */}
        <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.ajustador.proposalsTitle}</h3>
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">{t.ajustador.proposalsIntro}</p>
        {loadError ? <ApiErrorBanner error={loadError} t={t} onRetry={load} /> : null}
        {rows === null ? (
          loadError ? null : <p className="py-4 text-center text-sm text-zinc-400">{t.ajustador.loading}</p>
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-400">{t.ajustador.proposalsEmpty}</p>
        ) : (
          <>
            <ul className="space-y-3 sm:hidden">
              {rows.map((r) => (
                <li key={r.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-100">{sectionLabel(r.seccion)}</p>
                    <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                      {statusLabel(r.estado)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">{agentLabel(r.agente)}</p>
                  <p className="mt-1 text-sm text-zinc-300">{r.propuesta}</p>
                  {isAdmin && (
                    <span className="mt-3 flex gap-1.5">
                      <button onClick={() => startEdit(r)} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800">{t.ajustador.edit}</button>
                      <button onClick={() => remove(r)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-2.5 text-xs text-red-400 hover:bg-red-950/50">{t.ajustador.delete}</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-400">
                    <th className="py-3 pr-3 font-semibold">{t.ajustador.thSection}</th>
                    <th className="py-3 pr-3 font-semibold">{t.ajustador.thAgent}</th>
                    <th className="py-3 pr-3 font-semibold">{t.ajustador.proposalAria}</th>
                    <th className="py-3 pr-3 font-semibold">{t.ajustador.statusAria}</th>
                    {isAdmin && <th className="py-3 font-semibold">{t.ajustador.edit}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top hover:bg-zinc-900/40">
                      <td className="py-3 pr-3"><span className="font-semibold text-zinc-100">{sectionLabel(r.seccion)}</span></td>
                      <td className="py-3 pr-3 text-zinc-300">{agentLabel(r.agente)}</td>
                      <td className="py-3 pr-3 text-zinc-300">{r.propuesta}</td>
                      <td className="py-3 pr-3 text-zinc-300">{statusLabel(r.estado)}</td>
                      {isAdmin && (
                        <td className="py-3">
                          <span className="flex gap-1.5">
                            <button onClick={() => startEdit(r)} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">{t.ajustador.edit}</button>
                            <button onClick={() => remove(r)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/50">{t.ajustador.delete}</button>
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
            <p className="text-sm font-semibold text-zinc-200">{editingId !== null ? t.ajustador.saveChanges : t.ajustador.newTitle}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label={t.ajustador.sectionAria}>
                <select className={inputCls} value={seccion} onChange={(e) => setSeccion(e.target.value)} aria-label={t.ajustador.sectionAria}>
                  {SECCIONES_AJUSTADOR.map((key) => (
                    <option key={key} value={key}>{sectionLabel(key)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t.ajustador.agentAria}>
                <select className={inputCls} value={agente} onChange={(e) => setAgente(e.target.value as AgenteKey)} aria-label={t.ajustador.agentAria}>
                  <option value="agente1">{t.ajustador.agent1}</option>
                  <option value="agente2">{t.ajustador.agent2}</option>
                  <option value="agente3">{t.ajustador.agent3}</option>
                </select>
              </Field>
              <Field label={t.ajustador.statusAria}>
                <select className={inputCls} value={estado} onChange={(e) => setEstado(e.target.value as AjusteEstado)} aria-label={t.ajustador.statusAria}>
                  <option value="propuesta">{t.ajustador.statusPropuesta}</option>
                  <option value="en_curso">{t.ajustador.statusEnCurso}</option>
                  <option value="aplicada">{t.ajustador.statusAplicada}</option>
                </select>
              </Field>
            </div>
            <Field label={t.ajustador.proposalAria}>
              <textarea aria-label={t.ajustador.proposalAria} className={inputCls} placeholder={t.ajustador.proposalPlaceholder} value={propuesta} onChange={(e) => setPropuesta(e.target.value)} rows={3} required maxLength={5000} />
            </Field>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="min-h-[44px] flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{busy ? t.ajustador.saving : editingId !== null ? t.ajustador.saveChanges : t.ajustador.create}</button>
              {editingId !== null && <button type="button" onClick={resetForm} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800">{t.ajustador.cancel}</button>}
            </div>
            {msg && <p className="text-sm text-emerald-400">{msg}</p>}
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          </form>
        )}
      </Panel>
    </>
  );
}
