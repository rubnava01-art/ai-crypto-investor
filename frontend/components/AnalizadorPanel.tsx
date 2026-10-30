"use client";

import { useState } from "react";
import { api, ApiError, type AnalizarResponse } from "../lib/api";
import { EmptyState } from "./badges";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

function bandaCls(banda: AnalizarResponse["banda"]) {
  if (banda === "alto") return "bg-red-500/15 text-red-300 ring-red-500/40";
  if (banda === "medio") return "bg-amber-500/15 text-amber-300 ring-amber-500/40";
  return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40";
}

/** Analizador IA: pega un link y revisa si el contenido parece creado con
 * IA. El resultado es una ESTIMACIÓN POR INDICIOS (bajo/medio/alto), nunca
 * un veredicto: ningún detector puede afirmar con certeza el origen de un
 * texto. Sin estado, sin llaves externas y sin guardar nada. */
export function AnalizadorPanel() {
  const { t } = useLanguage();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<AnalizarResponse | null>(null);

  const analizar = async (e: React.FormEvent) => {
    e.preventDefault();
    const limpia = url.trim();
    if (!limpia) return;
    setBusy(true);
    setError(null);
    setResultado(null);
    try {
      setResultado(await api.analizarUrl(limpia));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.analizador.errAnalyze);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={t.analizador.panelTitle}
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
          {t.analizador.badge}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        {t.analizador.intro}
      </p>

      <form onSubmit={analizar} className="space-y-2">
        <input
          aria-label={t.analizador.urlAria}
          className={inputCls}
          placeholder={t.analizador.urlPlaceholder}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          maxLength={2048}
          autoComplete="off"
          inputMode="url"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? t.analizador.analyzeBusy : t.analizador.analyze}
        </button>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </form>

      <div className="mt-4 border-t border-zinc-800 pt-3">
        {busy ? (
          <p className="py-2 text-sm text-zinc-500">{t.analizador.analyzing}</p>
        ) : resultado === null ? (
          <EmptyState text={t.analizador.empty} />
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-base font-semibold text-zinc-100">{resultado.titulo}</p>
              <p className="mt-1 break-all text-xs text-zinc-500">{resultado.final_url}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${bandaCls(resultado.banda)}`}>
                  {resultado.etiqueta_banda}
                </span>
                <span className="text-xs text-zinc-400">
                  {t.analizador.scoreLine.replace("{puntaje}", String(resultado.puntaje)).replace("{palabras}", String(resultado.palabras))}
                </span>
              </p>
            </div>

            <ul className="space-y-2">
              {resultado.indicadores.map((ind) => (
                <li key={ind.nombre} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-200">{ind.nombre}</span>
                    <span className="text-sm text-zinc-100">{ind.valor}</span>
                    {ind.punto && (
                      <span className="ml-auto shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
                        {t.analizador.pointBadge}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">{ind.detalle}</p>
                </li>
              ))}
            </ul>

            <p className="text-xs leading-relaxed text-zinc-500">
              <span className="font-semibold text-zinc-300">{t.analizador.ruleLabel}</span>
              {resultado.regla}
            </p>
            <p role="note" className="rounded-lg border border-amber-900/60 bg-amber-950/40 p-3 text-xs leading-relaxed text-amber-200/90">
              {resultado.descargo}
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
