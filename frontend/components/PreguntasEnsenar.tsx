// Bandeja "Preguntas por enseñar" (corrida 2026-11-23, chat potente).
// Panel SOLO-admin dentro de /asistente (sin ruta nueva): lista las
// preguntas que el Asistente no supo responder, con formulario para
// enseñarle la respuesta (módulo/ruta opcionales) y botón descartar,
// más la lista de reglas activas con desactivar. El backend refuerza
// el acceso admin; en cliente el panel no se renderiza si /me no
// confirma admin (fail-closed). Si el backend aún no expone estos
// endpoints (Agente 2 en paralelo), un 404 muestra el aviso
// "aún no disponible" en vez de un error genérico.
"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../lib/api";
import {
  createRegla,
  deletePregunta,
  deleteRegla,
  listPreguntas,
  listReglas,
  type AsistentePregunta,
  type AsistenteRegla,
} from "../lib/asistente";
import { useLanguage } from "../lib/i18n";
import { ApiErrorBanner, useConfirm } from "./ui";
import { MetricCard } from "./MetricCard";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

type Draft = { respuesta: string; modulo: string; ruta: string };

export function PreguntasEnsenar() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const { confirm, dialog } = useConfirm(t);
  // Tri-estado fail-closed: hasta que /me confirme admin, nada.
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [preguntas, setPreguntas] = useState<AsistentePregunta[] | null>(null);
  const [reglas, setReglas] = useState<AsistenteRegla[] | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((m) => {
        if (!cancelled) setIsAdmin(!!m.is_admin);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setNotAvailable(false);
    try {
      const [ps, rs] = await Promise.all([listPreguntas(), listReglas()]);
      setPreguntas(ps);
      setReglas(rs);
    } catch (e) {
      // 404 = el backend aún no expone la bandeja (Agente 2 en paralelo):
      // aviso honesto, no error genérico.
      if (e instanceof ApiError && e.status === 404) {
        setNotAvailable(true);
        setPreguntas([]);
        setReglas([]);
      } else {
        setError(e);
      }
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const fmtFecha = (iso: string | null): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  };

  const setDraft = (id: number, patch: Partial<Draft>) =>
    setDrafts((prev) => {
      const base: Draft = prev[id] ?? { respuesta: "", modulo: "", ruta: "" };
      return { ...prev, [id]: { ...base, ...patch } };
    });

  const saveRule = async (p: AsistentePregunta) => {
    const draft = drafts[p.id] ?? { respuesta: "", modulo: "", ruta: "" };
    const respuesta = draft.respuesta.trim();
    if (!respuesta) return;
    setBusyId(p.id);
    setError(null);
    setMsg(null);
    try {
      await createRegla(p.id, {
        respuesta,
        ...(draft.modulo.trim() ? { modulo: draft.modulo.trim() } : {}),
        ...(draft.ruta.trim() ? { ruta: draft.ruta.trim() } : {}),
      });
      setMsg(t.preguntas.msgSaved);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e : new Error(t.preguntas.errSave));
    } finally {
      setBusyId(null);
    }
  };

  const discard = async (p: AsistentePregunta) => {
    if (!(await confirm(t.preguntas.confirmDiscard))) return;
    setBusyId(p.id);
    setError(null);
    setMsg(null);
    try {
      await deletePregunta(p.id);
      setMsg(t.preguntas.msgDiscarded);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e : new Error(t.preguntas.errDelete));
    } finally {
      setBusyId(null);
    }
  };

  const deactivateRule = async (r: AsistenteRegla) => {
    if (!(await confirm(t.preguntas.confirmDeactivate))) return;
    setBusyId(r.id);
    setError(null);
    setMsg(null);
    try {
      await deleteRegla(r.id);
      setMsg(t.preguntas.msgRuleDeleted);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e : new Error(t.preguntas.errDelete));
    } finally {
      setBusyId(null);
    }
  };

  // No admin / sin sesión / aún verificando: el panel no existe.
  if (!isAdmin) return null;

  const pending = preguntas ?? [];
  const activeRules = reglas ?? [];

  return (
    <>
      {dialog}
      <section aria-label={t.preguntas.title} className="fintech-card mt-4 p-5 sm:p-6">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold uppercase leading-6 tracking-wider text-slate-200">
            {t.preguntas.title}
          </h2>
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
            {t.asistente.adminBadge}
          </span>
        </div>
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">{t.preguntas.intro}</p>

        {msg && (
          <p role="status" className="mb-3 text-sm text-emerald-400">
            {msg}
          </p>
        )}
        {error ? (
          <ApiErrorBanner error={error} t={t} onRetry={load} />
        ) : notAvailable ? (
          <p className="py-2 text-sm text-zinc-400">{t.preguntas.notAvailable}</p>
        ) : preguntas === null ? (
          <p role="status" className="py-2 text-sm text-zinc-400">
            {t.preguntas.loading}
          </p>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <MetricCard label={t.preguntas.title} value={String(pending.length)} />
              <MetricCard label={t.preguntas.rulesTitle} value={String(activeRules.length)} />
            </div>

            {pending.length === 0 ? (
              <p className="py-2 text-sm text-zinc-400">{t.preguntas.empty}</p>
            ) : (
              <ul className="space-y-4">
                {pending.map((p) => {
                  const draft = drafts[p.id] ?? { respuesta: "", modulo: "", ruta: "" };
                  const busy = busyId === p.id;
                  return (
                    <li key={p.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                      <p className="text-sm font-semibold text-zinc-100">{p.pregunta}</p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {t.preguntas.timesLabel.replace("{n}", String(p.veces))}
                        {p.ultima_vez ? ` · ${t.preguntas.lastSeen.replace("{fecha}", fmtFecha(p.ultima_vez))}` : ""}
                      </p>
                      <div className="mt-3 space-y-2">
                        <label className="block text-xs text-zinc-400">
                          {t.preguntas.answerLabel}
                          <textarea
                            aria-label={t.preguntas.answerAria}
                            className={`${inputCls} mt-1`}
                            placeholder={t.preguntas.answerPlaceholder}
                            value={draft.respuesta}
                            onChange={(e) => setDraft(p.id, { respuesta: e.target.value })}
                            rows={2}
                          />
                        </label>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <label className="block text-xs text-zinc-400">
                            {t.preguntas.moduleLabel}
                            <input
                              aria-label={t.preguntas.moduleAria}
                              className={`${inputCls} mt-1`}
                              placeholder={t.preguntas.modulePlaceholder}
                              value={draft.modulo}
                              onChange={(e) => setDraft(p.id, { modulo: e.target.value })}
                              maxLength={60}
                            />
                          </label>
                          <label className="block text-xs text-zinc-400">
                            {t.preguntas.routeLabel}
                            <input
                              aria-label={t.preguntas.routeAria}
                              className={`${inputCls} mt-1`}
                              placeholder={t.preguntas.routePlaceholder}
                              value={draft.ruta}
                              onChange={(e) => setDraft(p.id, { ruta: e.target.value })}
                              maxLength={120}
                            />
                          </label>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void saveRule(p)}
                            disabled={busy || !draft.respuesta.trim()}
                            className="min-h-[44px] flex-1 rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                          >
                            {busy ? t.preguntas.saving : t.preguntas.saveRule}
                          </button>
                          <button
                            type="button"
                            onClick={() => void discard(p)}
                            disabled={busy}
                            className="min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                          >
                            {t.preguntas.discard}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <h3 className="mb-2 mt-6 text-sm font-semibold text-zinc-200">{t.preguntas.rulesTitle}</h3>
            {activeRules.length === 0 ? (
              <p className="py-2 text-sm text-zinc-400">{t.preguntas.emptyRules}</p>
            ) : (
              <ul className="space-y-2">
                {activeRules.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5"
                  >
                    <span className="min-w-0 flex-1 text-sm text-zinc-200">
                      {r.pregunta ? <strong className="font-semibold">{r.pregunta} — </strong> : null}
                      {r.respuesta}
                      {r.ruta ? <span className="ml-2 font-mono text-xs text-emerald-300">{r.ruta}</span> : null}
                      {!r.ruta && r.modulo ? <span className="ml-2 font-mono text-xs text-emerald-300">{r.modulo}</span> : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => void deactivateRule(r)}
                      disabled={busyId === r.id}
                      className="min-h-[36px] rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                    >
                      {t.preguntas.deactivate}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </>
  );
}
