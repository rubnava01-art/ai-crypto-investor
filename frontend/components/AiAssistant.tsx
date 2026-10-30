"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type AIAskResponse, type AILessonsResponse, type AIStatusResponse } from "../lib/api";
import { Panel } from "./Panel";
import { DemoBadge, EmptyState } from "./badges";

/**
 * Asistente IA — panel técnico de solo lectura.
 * Explica indicadores y señales; nunca ejecuta órdenes ni cambia reglas.
 * Muestra etiqueta DEMO cuando no hay un modelo real configurado.
 */
export function AiAssistant() {
  const [status, setStatus] = useState<AIStatusResponse | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AIAskResponse | null>(null);
  const [lessons, setLessons] = useState<AILessonsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, l] = await Promise.all([api.aiStatus(), api.aiLessons()]);
        if (!cancelled) { setStatus(s); setLessons(l); }
      } catch {
        if (!cancelled) setStatus(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setError(null);
    try {
      const res = await api.aiAsk(q);
      setAnswer(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al preguntar");
    } finally {
      setAsking(false);
    }
  };

  return (
    <Panel
      title="Asistente IA"
      badge={status && status.demo ? <DemoBadge /> : undefined}
    >
      <p className="mb-3 text-xs text-zinc-500">
        Asistente técnico de solo lectura: explica indicadores y señales.
        No ejecuta órdenes ni modifica reglas.
        {status && status.demo && (
          <> Modelo local (DEMO) — configura un proveedor para respuestas avanzadas.</>
        )}
      </p>

      <div className="flex gap-2">
        <input aria-label="Pregunta al asistente"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
          placeholder="¿Qué significa el RSI actual de BTC? ¿Por qué se generó la señal #3?"
          maxLength={2000}
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none"
        />
        <button
          onClick={ask}
          disabled={asking || !question.trim()}
          className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
        >
          {asking ? "…" : "Preguntar"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>
      )}

      {answer && (
        <div className={`mt-3 rounded-lg border px-3 py-2.5 text-sm ${
          answer.refused ? "border-amber-700/60 bg-amber-500/10 text-amber-200" : "border-zinc-800 bg-zinc-950 text-zinc-300"
        }`}>
          <p className="whitespace-pre-wrap">{answer.answer}</p>
          {answer.confidence != null && (
            <p className="mt-2 text-xs text-zinc-500">
              Confianza expresada: {answer.confidence}% (calibrada contra resultados reales)
            </p>
          )}
        </div>
      )}

      <div className="mt-4">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Lecciones aprendidas
        </h3>
        {lessons ? (
          <>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
              {lessons.summary_es}
            </p>
            {lessons.calibration.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {lessons.calibration.map((c) => (
                  <li key={c.bucket} className="flex items-center gap-2 font-mono">
                    <span className="text-zinc-500">{c.bucket}</span>
                    <span className="text-zinc-400">
                      dice {c.claimed_avg_pct}% · acierta {c.actual_win_pct}% · n={c.n}
                    </span>
                    {c.miscalibrated && (
                      <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
                        DESCALIBRADO
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <EmptyState text="Cargando lecciones…" />
        )}
      </div>
    </Panel>
  );
}
