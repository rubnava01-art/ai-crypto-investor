"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type WebAudit } from "../lib/api";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

/** Auditor web: revisa UNA página (velocidad medida + SEO básico).
 * El puntaje es transparente: % de la lista de verificación aprobado,
 * siempre mostrado CON la lista completa. NO es un puntaje Lighthouse
 * ni PageSpeed, no hay rastreo, sitemap ni Core Web Vitals. El servidor
 * rechaza URLs privadas/reservadas antes de descargar nada. */
export function AuditorPanel() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<WebAudit | null>(null);
  const [recent, setRecent] = useState<WebAudit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await api.listWebAudits());
    } catch {
      setRecent([]);
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = url.trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.runWebAudit(target);
      setResult(data);
      await loadRecent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo auditar la URL.");
    } finally {
      setBusy(false);
    }
  };

  const scoreColor =
    !result || result.score === null
      ? "text-zinc-300"
      : result.score >= 80
        ? "text-emerald-400"
        : result.score >= 50
          ? "text-amber-400"
          : "text-red-400";

  return (
    <div className="space-y-4">
      <Panel title="Auditar una página" badge={<span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">1 página</span>}>
        <p className="mb-3 text-xs leading-relaxed text-zinc-500">
          Pega el link de una página pública y mide su carga real más una revisión SEO básica.
          Solo se descarga esa página (sin rastrear el sitio). Por seguridad, el servidor rechaza
          direcciones privadas o internas.
        </p>
        <form onSubmit={run} className="flex flex-col gap-2 sm:flex-row">
          <input aria-label="URL a auditar"
            className={inputCls}
            placeholder="https://ejemplo.com/pagina"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            maxLength={2048}
            autoComplete="off"
            inputMode="url"
          />
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "Auditando…" : "Auditar"}
          </button>
        </form>
        {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
      </Panel>

      {result && (
        <Panel title="Resultado">
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <div className="text-center">
              <p className={`text-5xl font-bold ${scoreColor}`}>
                {result.score === null ? "—" : result.score}
              </p>
              <p className="text-xs text-zinc-500">puntaje / 100</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-zinc-100">{result.url}</p>
              <p className="truncate text-xs text-zinc-500">Final: {result.final_url}</p>
              <p className="mt-1 text-xs text-zinc-500">
                Revisión básica de una sola página. NO es un puntaje Lighthouse ni PageSpeed.
              </p>
              {result.note && <p className="mt-1 text-xs text-amber-300">{result.note}</p>}
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              ["Estado HTTP", String(result.status)],
              ["Redirecciones", String(result.redirect_count)],
              ["TTFB", `${result.ttfb_ms} ms`],
              ["Tiempo total", `${result.total_ms} ms`],
              ["Tamaño", `${result.size_kb} KB`],
              ["HTTPS", result.is_https ? "Sí" : "No"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                <p className="text-xs text-zinc-500">{label}</p>
                <p className="text-sm font-semibold text-zinc-100">{value}</p>
              </div>
            ))}
          </div>

          {result.checks.length > 0 && (
            <ul className="divide-y divide-zinc-800/70">
              {result.checks.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-2 py-2">
                  <span aria-hidden="true" className={c.passed ? "text-emerald-400" : "text-red-400"}>
                    {c.passed ? "✓" : "✗"}
                  </span>
                  <span className="text-sm font-semibold text-zinc-100">{c.label}</span>
                  <span className="text-sm text-zinc-300">{c.value}</span>
                  <span className="ml-auto text-xs text-zinc-500">ideal: {c.ideal}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Panel title="Auditorías recientes">
        {recent.length === 0 ? (
          <p className="text-sm text-zinc-500">Todavía no hay auditorías guardadas.</p>
        ) : (
          <ul className="space-y-1">
            {recent.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setResult(a)}
                  className="flex w-full flex-wrap items-baseline gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-left hover:bg-zinc-800"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{a.url}</span>
                  <span className="text-sm font-semibold text-zinc-100">
                    {a.score === null ? "sin puntaje" : `${a.score}/100`}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {a.created_at ? new Date(a.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : ""}
                    {a.owner_username ? ` · ${a.owner_username}` : ""}
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
