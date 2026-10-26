"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type MeResponse, type Revelation } from "../lib/api";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : null;

/* ------------------------------------------------------------------ */
/* Meditación: respiración guiada 4-4-6 + temporizador, todo local.    */
/* ------------------------------------------------------------------ */

type BreathPhase = { label: string; seconds: number };

const BREATH: BreathPhase[] = [
  { label: "Inhala", seconds: 4 },
  { label: "Sostén", seconds: 4 },
  { label: "Exhala", seconds: 6 },
];

function MeditationPanel() {
  const [breathing, setBreathing] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [phaseLeft, setPhaseLeft] = useState(BREATH[0].seconds);
  const [cycles, setCycles] = useState(0);
  const [timerMin, setTimerMin] = useState(5);
  const [timerLeft, setTimerLeft] = useState<number | null>(null);
  const [timerDone, setTimerDone] = useState(false);
  const breathTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopBreath = useCallback(() => {
    if (breathTimer.current) clearInterval(breathTimer.current);
    breathTimer.current = null;
    setBreathing(false);
  }, []);

  useEffect(() => () => {
    stopBreath();
    if (timerRef.current) clearInterval(timerRef.current);
  }, [stopBreath]);

  const startBreath = () => {
    stopBreath();
    setPhaseIdx(0);
    setPhaseLeft(BREATH[0].seconds);
    setCycles(0);
    setBreathing(true);
    breathTimer.current = setInterval(() => {
      setPhaseLeft((left) => {
        if (left > 1) return left - 1;
        setPhaseIdx((idx) => {
          const next = (idx + 1) % BREATH.length;
          if (next === 0) setCycles((c) => c + 1);
          setPhaseLeft(BREATH[next].seconds);
          return next;
        });
        return left;
      });
    }, 1000);
  };

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimerDone(false);
    setTimerLeft(timerMin * 60);
    timerRef.current = setInterval(() => {
      setTimerLeft((left) => {
        if (left === null || left <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          setTimerDone(true);
          return 0;
        }
        return left - 1;
      });
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setTimerLeft(null);
    setTimerDone(false);
  };

  const phase = BREATH[phaseIdx];
  const circleScale = phase.label === "Inhala" ? 1.25 : phase.label === "Exhala" ? 0.8 : 1.1;
  const mm = timerLeft === null ? null : `${Math.floor(timerLeft / 60)}:${String(timerLeft % 60).padStart(2, "0")}`;

  return (
    <Panel
      title="Meditación"
      badge={
        <span className="rounded-full bg-teal-500/15 px-2.5 py-1 text-xs font-semibold text-teal-300">
          Respira
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        Un momento de calma antes de decidir. La respiración guiada sigue el ritmo
        4-4-6 (inhala 4, sostén 4, exhala 6); el temporizador es solo silencio y
        tiempo para ti. Nada de esto se guarda ni se comparte.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-center">
          <div
            className="mx-auto flex h-32 w-32 items-center justify-center rounded-full bg-teal-500/20 transition-transform duration-1000"
            style={{ transform: `scale(${breathing ? circleScale : 1})` }}
          >
            <span className="text-lg font-semibold text-teal-200">
              {breathing ? phase.label : "Respira"}
            </span>
          </div>
          <p className="mt-3 text-sm text-zinc-400">
            {breathing ? (
              <>
                {phaseLeft}s · ciclo {cycles + 1}
              </>
            ) : (
              "Ritmo 4-4-6 · sin prisa"
            )}
          </p>
          <button
            type="button"
            onClick={breathing ? stopBreath : startBreath}
            className="mt-3 w-full rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500"
          >
            {breathing ? "Detener respiración" : "Empezar respiración"}
          </button>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-center">
          <p className="text-4xl font-bold tracking-wider text-zinc-100">
            {mm ?? `${timerMin}:00`}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            {timerDone ? "Tiempo cumplido. Quédate un momento más si quieres." : timerLeft !== null ? "Meditando…" : "Elige la duración y empieza"}
          </p>
          <div className="mt-3 flex justify-center gap-2">
            {[5, 10, 15].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setTimerMin(m); setTimerLeft(null); setTimerDone(false); }}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${timerMin === m ? "bg-teal-600 text-white" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
              >
                {m} min
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={timerLeft !== null && !timerDone ? stopTimer : startTimer}
            className="mt-3 w-full rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500"
          >
            {timerLeft !== null && !timerDone ? "Detener" : "Empezar meditación"}
          </button>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Revelaciones: diario personal (lo escribes tú, nada inventado).     */
/* ------------------------------------------------------------------ */

function RevelationsPanel({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<Revelation[] | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.listRevelations());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.createRevelation({ title: title.trim(), text });
      setMsg("Revelación guardada.");
      setTitle("");
      setText("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Revelation) => {
    if (!window.confirm(`¿Borrar la revelación "${r.title}"?`)) return;
    setError(null);
    try {
      await api.deleteRevelation(r.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar.");
    }
  };

  return (
    <Panel
      title="Revelaciones"
      badge={
        <span className="rounded-full bg-teal-500/15 px-2.5 py-1 text-xs font-semibold text-teal-300">
          {rows === null ? "Cargando…" : `${rows.length} notas`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        Tu diario de ideas, lecciones y cosas que te caen en meditación. Lo
        escribes tú: aquí nada se genera solo.
        {!isAdmin && " Tu rol de prueba es de solo lectura."}
      </p>

      {isAdmin && (
        <form onSubmit={add} className="space-y-2">
          <input className={inputCls} placeholder="Título de la revelación *" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" />
          <textarea className={inputCls} placeholder="Escríbela como te llegó…" value={text} onChange={(e) => setText(e.target.value)} rows={3} />
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="w-full rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Guardar revelación"}
          </button>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3">
        {rows === null ? (
          <p className="py-2 text-sm text-zinc-500">Cargando revelaciones…</p>
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">Todavía no hay revelaciones guardadas.</p>
        ) : (
          <ul className="divide-y divide-zinc-800/70">
            {rows.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-zinc-100">{r.title}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-zinc-600">{fmtDate(r.created_at)}</span>
                    {isAdmin && (
                      <button
                        onClick={() => remove(r)}
                        className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                      >
                        Borrar
                      </button>
                    )}
                  </span>
                </div>
                {r.text && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{r.text}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

export function EspacioPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  return (
    <div className="space-y-4">
      <MeditationPanel />
      <RevelationsPanel isAdmin={isAdmin} />
    </div>
  );
}
