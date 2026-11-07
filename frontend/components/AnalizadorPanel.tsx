"use client";

import { useState } from "react";
import { api, ApiError, type AnalizarResponse } from "../lib/api";
import { EmptyState } from "./badges";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40";

function bandaCls(banda: AnalizarResponse["banda"]) {
  if (banda === "alto") return "bg-red-500/15 text-red-300 ring-red-500/40";
  if (banda === "medio") return "bg-amber-500/15 text-amber-300 ring-amber-500/40";
  return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40";
}

function sevBadgeCls(severidad: string) {
  if (severidad === "error") return "bg-red-500/10 text-red-400 ring-red-500/30";
  if (severidad === "advertencia") return "bg-amber-500/10 text-amber-300 ring-amber-500/30";
  return "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30";
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

  const sevName: Record<string, string> = {
    error: t.analizador.severityError,
    advertencia: t.analizador.severityWarning,
    aviso: t.analizador.severityNotice,
  };
  // Grupos del informe: primero el contenido (lo único que puntúa) y
  // luego la estructura de la página (solo contexto).
  const grupos: { id: string; titulo: string }[] = [
    { id: "contenido", titulo: t.analizador.groupContenido },
    { id: "estructura", titulo: t.analizador.groupEstructura },
  ];

  return (
    <Panel
      title={t.analizador.panelTitle}
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
          {t.analizador.badge}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-400">
        {t.analizador.intro}
      </p>

      <form onSubmit={analizar} className="space-y-3">
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
          className="w-full rounded-lg bg-emerald-600 min-h-[44px] px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
        >
          {busy ? t.analizador.analyzeBusy : t.analizador.analyze}
        </button>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </form>

      <div className="mt-4 border-t border-zinc-800 pt-3">
        {busy ? (
          <p className="py-2 text-sm text-zinc-400">{t.analizador.analyzing}</p>
        ) : resultado === null ? (
          <EmptyState text={t.analizador.empty} />
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-lg font-semibold text-zinc-100">{resultado.titulo}</p>
              <p className="mt-1 break-all text-xs text-zinc-400">{resultado.final_url}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${bandaCls(resultado.banda)}`}>
                  {resultado.etiqueta_banda}
                </span>
                <span className="text-xs text-zinc-400">
                  {t.analizador.scoreLine.replace("{puntaje}", String(resultado.puntaje)).replace("{maximo}", String(resultado.puntaje_maximo)).replace("{palabras}", String(resultado.palabras))}
                </span>
              </p>
            </div>

            {grupos.map((grupo) => {
              const items = resultado.indicadores.filter(
                (ind) => (ind.categoria ?? "contenido") === grupo.id,
              );
              if (items.length === 0) return null;
              return (
                <div key={grupo.id}>
                  <p className="mb-2 text-sm font-semibold text-zinc-100">{grupo.titulo}</p>
                  <ul className="space-y-3">
                    {items.map((ind) => (
                      <li key={ind.nombre} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-200">{ind.nombre}</span>
                          <span className="text-sm text-zinc-100">{ind.valor}</span>
                          <span className="ml-auto flex shrink-0 items-center gap-2">
                            {ind.punto && (
                              <span className="rounded-full bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-300">
                                {t.analizador.pointBadge}
                              </span>
                            )}
                            {ind.pasa ? (
                              <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                                ✓ {t.analizador.okLabel}
                              </span>
                            ) : (
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ring-1 ring-inset ${sevBadgeCls(ind.severidad)}`}>
                                {sevName[ind.severidad] ?? t.analizador.severityNotice}
                              </span>
                            )}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-400">{ind.detalle}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}

            {resultado.desglose.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-semibold text-zinc-100">{t.analizador.breakdownTitle}</p>
                <ul className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  {resultado.desglose.map((fila) => (
                    <li key={fila.nombre} className="flex items-start justify-between gap-3 text-xs">
                      <span className="text-zinc-300">
                        {fila.nombre}
                        <span className="block text-zinc-500">{fila.detalle}</span>
                      </span>
                      <span className="shrink-0 font-semibold text-zinc-100">
                        {fila.puntos} / {fila.maximo}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs font-semibold text-zinc-200">
                  {t.analizador.breakdownTotal.replace("{puntaje}", String(resultado.puntaje)).replace("{maximo}", String(resultado.puntaje_maximo))}
                </p>
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-semibold text-zinc-100">{t.analizador.nextStepsTitle}</p>
              {resultado.siguientes_pasos.length === 0 ? (
                <p className="text-xs leading-relaxed text-zinc-400">{t.analizador.noSteps}</p>
              ) : (
                <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-zinc-300">
                  {resultado.siguientes_pasos.map((paso) => (
                    <li key={paso}>{paso}</li>
                  ))}
                </ol>
              )}
            </div>

            <p className="text-xs leading-relaxed text-zinc-400">
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
