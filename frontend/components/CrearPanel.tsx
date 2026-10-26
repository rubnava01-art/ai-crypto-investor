"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type AIStatusResponse, type CopyDraft, type CopyPlatform, type CopyTone, type MeResponse, type TrendNote,
} from "../lib/api";
import { Panel } from "./Panel";
import { LogoGenerator } from "./LogoGenerator";
import { ShirtMockupGenerator } from "./ShirtMockupGenerator";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const PLATFORMS: { value: CopyPlatform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "threads", label: "Threads" },
  { value: "facebook", label: "Facebook" },
];

const TONES: { value: CopyTone; label: string }[] = [
  { value: "directo", label: "Directo" },
  { value: "educativo", label: "Educativo" },
  { value: "divertido", label: "Divertido" },
  { value: "profesional", label: "Profesional" },
];

const platformLabel = (p: string) => PLATFORMS.find((x) => x.value === p)?.label ?? p;
const toneLabel = (t: string) => TONES.find((x) => x.value === t)?.label ?? t;

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : null;

function CopyGenerator({ isAdmin }: { isAdmin: boolean }) {
  const [aiStatus, setAiStatus] = useState<AIStatusResponse | null>(null);
  const [drafts, setDrafts] = useState<CopyDraft[] | null>(null);
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState<CopyPlatform>("instagram");
  const [tone, setTone] = useState<CopyTone>("directo");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDrafts(await api.listCopies());
    } catch {
      setDrafts([]);
    }
  }, []);

  useEffect(() => {
    api.aiStatus().then(setAiStatus).catch(() => setAiStatus(null));
    load();
  }, [load]);

  const isDemo = aiStatus ? aiStatus.demo : true;

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const draft = await api.generateCopy({ topic: topic.trim(), platform, tone });
      setMsg(draft.demo ? "Copy generado en modo demo y guardado." : "Copy generado y guardado.");
      setTopic("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo generar el copy.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: CopyDraft) => {
    if (!window.confirm("¿Borrar este copy guardado?")) return;
    setError(null);
    setMsg(null);
    try {
      await api.deleteCopy(d.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar el copy.");
    }
  };

  return (
    <Panel
      title="Generador de copies"
      badge={
        isDemo ? (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
            Modo demo
          </span>
        ) : (
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
            IA configurada
          </span>
        )
      }
    >
      {isDemo && (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm leading-relaxed text-amber-200">
          Estás en <strong>modo demo</strong>: el proveedor de IA es el modelo local de
          prueba, así que los copies son texto de demostración, no redacción real de IA.
          Configura la llave de OpenAI en el servidor para copies reales.
        </p>
      )}
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        La tendencia alimenta el copy, el copy trae leads y los leads caen en el CRM.
        Cada copy generado se guarda aquí para reutilizarlo.
        {!isAdmin && " Tu rol de prueba es de solo lectura: puedes ver los copies guardados, pero no generar ni borrar."}
      </p>

      {isAdmin && (
        <form onSubmit={generate} className="space-y-2">
          <input
            className={inputCls}
            placeholder="Tema o producto del copy (p. ej. Lanzamiento de la Academia)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            required
            maxLength={200}
            autoComplete="off"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select className={inputCls} value={platform} onChange={(e) => setPlatform(e.target.value as CopyPlatform)} aria-label="Plataforma">
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>Plataforma: {p.label}</option>
              ))}
            </select>
            <select className={inputCls} value={tone} onChange={(e) => setTone(e.target.value as CopyTone)} aria-label="Tono">
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>Tono: {t.label}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={busy || !topic.trim()}
            className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "Generando…" : "Generar copy"}
          </button>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Copies guardados ({drafts === null ? "…" : drafts.length})
        </p>
        {drafts === null ? (
          <p className="py-2 text-sm text-zinc-500">Cargando copies…</p>
        ) : drafts.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">Todavía no hay copies guardados.</p>
        ) : (
          <ul className="divide-y divide-zinc-800/70">
            {drafts.map((d) => (
              <li key={d.id} className="py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">{platformLabel(d.platform)}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">{toneLabel(d.tone)}</span>
                  {d.demo && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">Demo</span>
                  )}
                  <span className="text-xs text-zinc-500">{d.topic}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-zinc-600">{fmtDate(d.created_at)}</span>
                    {isAdmin && (
                      <button
                        onClick={() => remove(d)}
                        className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                      >
                        Borrar
                      </button>
                    )}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{d.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function TrendsPanel({ isAdmin }: { isAdmin: boolean }) {
  const [trends, setTrends] = useState<TrendNote[] | null>(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTrends(await api.listTrends());
    } catch {
      setTrends([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createTrend({ title: title.trim(), source: source.trim(), summary });
      setTitle("");
      setSource("");
      setSummary("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la tendencia.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: TrendNote) => {
    if (!window.confirm(`¿Borrar la tendencia "${t.title}"?`)) return;
    setError(null);
    try {
      await api.deleteTrend(t.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar la tendencia.");
    }
  };

  return (
    <Panel
      title="Panel de tendencias"
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
          {trends === null ? "Cargando…" : `${trends.length} notas`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        Investigación de tendencias que alimenta tus copies. Las primeras notas son los
        temas que ya publicaste en Threads (vía @tecnologia); las nuevas se agregan a
        mano o desde la investigación.
        {!isAdmin && " Tu rol de prueba es de solo lectura."}
      </p>

      {trends === null ? (
        <p className="py-2 text-sm text-zinc-500">Cargando tendencias…</p>
      ) : trends.length === 0 ? (
        <p className="py-2 text-sm text-zinc-500">
          Sin tendencias registradas todavía. Cuando investigues un tema, agrégalo aquí.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-800/70">
          {trends.map((t) => (
            <li key={t.id} className="py-2.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-zinc-100">{t.title}</span>
                {t.published_on && <span className="text-xs text-zinc-500">{fmtDate(t.published_on)}</span>}
                {isAdmin && (
                  <button
                    onClick={() => remove(t)}
                    className="ml-auto rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                  >
                    Borrar
                  </button>
                )}
              </div>
              {t.source && <p className="mt-0.5 text-xs text-zinc-500">Fuente: {t.source}</p>}
              {t.summary && <p className="mt-0.5 text-sm text-zinc-400">{t.summary}</p>}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <form onSubmit={add} className="mt-4 space-y-2 border-t border-zinc-800 pt-4">
          <p className="text-sm font-semibold text-zinc-200">Nueva tendencia</p>
          <input className={inputCls} placeholder="Título de la tendencia *" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" />
          <input className={inputCls} placeholder="Fuente (p. ej. @tecnologia, investigación propia)" value={source} onChange={(e) => setSource(e.target.value)} maxLength={120} autoComplete="off" />
          <textarea className={inputCls} placeholder="Resumen breve" value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Agregar tendencia"}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>
      )}
      {!isAdmin && error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </Panel>
  );
}

export function CrearPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  return (
    <div className="space-y-4">
      <CopyGenerator isAdmin={isAdmin} />
      <LogoGenerator />
      <ShirtMockupGenerator />
      <TrendsPanel isAdmin={isAdmin} />
    </div>
  );
}
