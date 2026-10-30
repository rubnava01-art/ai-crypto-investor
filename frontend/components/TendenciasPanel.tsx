"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type TrendResearch, type TrendSearch } from "../lib/api";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const linkBtnCls =
  "flex items-center justify-between gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-100 hover:bg-zinc-800";

/** Tendencias: investiga palabras clave para tendencias y campañas.
 * Las preguntas son sugerencias REALES de autocompletado de Google
 * (no volúmenes ni puntajes inventados). Google Trends, AnswerThePublic
 * y Facebook Ad Library no tienen API pública gratuita: los botones
 * abren esas herramientas con la palabra ya puesta (enlaces externos,
 * no datos dentro de la plataforma). */
export function TendenciasPanel() {
  const [keyword, setKeyword] = useState("");
  const [result, setResult] = useState<TrendResearch | null>(null);
  const [recent, setRecent] = useState<TrendSearch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await api.listTrendSearches());
    } catch {
      setRecent([]);
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const research = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = keyword.trim();
    if (!kw) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.researchTrends(kw);
      setResult(data);
      await loadRecent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo investigar la palabra.");
    } finally {
      setBusy(false);
    }
  };

  const enc = result ? encodeURIComponent(result.keyword) : "";
  const deepLinks = result
    ? [
        {
          label: "Google Trends",
          hint: "Tendencias de búsqueda de la palabra",
          href: `https://trends.google.com/trends/explore?q=${enc}&hl=es`,
        },
        {
          label: "Facebook Ad Library",
          hint: "Anuncios activos de la competencia: textos y creativos",
          href: `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=${enc}`,
        },
        {
          label: "AnswerThePublic",
          hint: "Página principal (sin enlace de búsqueda inventado)",
          href: "https://answerthepublic.com/",
        },
      ]
    : [];

  const renderGroup = (title: string, items: string[]) => (
    <div>
      <p className="mb-2 text-sm font-semibold text-zinc-100">
        {title} <span className="font-normal text-zinc-500">({items.length})</span>
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">Sin preguntas encontradas para esta palabra.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((q) => (
            <li key={q} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
              {q}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <Panel title="Investigar palabra clave" badge={<span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">ES + EN</span>}>
        <p className="mb-3 text-xs leading-relaxed text-zinc-500">
          Escribe una palabra en español o inglés y descubre qué preguntas hace la gente sobre ella:
          úsalas para temas de contenido y ángulos de campaña. Las preguntas vienen del autocompletado
          de Google en vivo — no son volúmenes de búsqueda ni puntajes de tendencia.
        </p>
        <form onSubmit={research} className="flex flex-col gap-2 sm:flex-row">
          <input aria-label="Tema a investigar"
            className={inputCls}
            placeholder="Ej. creatina, marketing digital, air fryer…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            maxLength={100}
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={busy || !keyword.trim()}
            className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "Investigando…" : "Investigar"}
          </button>
        </form>
        {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
      </Panel>

      {result && (
        <>
          {result.warning && (
            <p className="rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
              {result.warning}
            </p>
          )}
          <Panel title={`Preguntas que la gente busca: "${result.keyword}"`}>
            <p className="mb-3 text-xs leading-relaxed text-zinc-500">{result.source_note}</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {renderGroup("En español", result.es)}
              {renderGroup("In English", result.en)}
            </div>
          </Panel>

          <Panel title="Abrir en herramientas externas">
            <p className="mb-3 text-xs leading-relaxed text-zinc-500">
              Estos botones son enlaces externos (se abren en otra pestaña) con tu palabra ya puesta.
              Úsalos así: en la Ad Library mira los anuncios activos de competidores — sus textos y
              creativos te dicen qué ángulos ya están probando.
            </p>
            <div className="space-y-2">
              {deepLinks.map((l) => (
                <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className={linkBtnCls}>
                  <span>
                    {l.label}
                    <span className="block text-xs font-normal text-zinc-500">{l.hint}</span>
                  </span>
                  <span aria-hidden="true">↗</span>
                </a>
              ))}
            </div>
          </Panel>
        </>
      )}

      <Panel title="Búsquedas recientes">
        {recent.length === 0 ? (
          <p className="text-sm text-zinc-500">Todavía no has investigado ninguna palabra.</p>
        ) : (
          <ul className="space-y-1">
            {recent.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setKeyword(r.keyword)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  {r.keyword}
                  <span className="ml-2 text-xs text-zinc-500">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
