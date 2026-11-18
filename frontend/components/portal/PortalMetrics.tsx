// Indicadores del portal (NEST, 2026-11-17): tarjetas con los agregados
// en vivo del cliente (/portal/resumen). Ceros si no hay datos; nunca
// contadores globales. Solo endpoints /api/business/marketing/portal/*.
"use client";

import { api, type PortalResumen } from "../../lib/api";
import { Panel } from "../Panel";
import { ApiErrorBanner } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";
import { formatMoney } from "../../lib/format";

export function PortalMetrics({ contactId }: { contactId?: number }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const load = useAsyncLoad<PortalResumen>(
    (signal) => api.getPortalResumen(contactId, { signal }),
    [contactId],
  );
  const resumen = load.data;

  return (
    <Panel title={t.portal.metricsTitle}>
      {load.loading ? (
        <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.portal.loading}</p>
      ) : load.error ? (
        <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
      ) : !resumen ? (
        <p className="py-4 text-center text-sm text-zinc-400">{t.portal.errLoad}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <p className="text-xs text-zinc-400">{t.portal.paidTotal}</p>
            <p className="mt-1 text-lg font-semibold text-zinc-100">{formatMoney(resumen.facturas.total_pagado, "USD", locale)}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <p className="text-xs text-zinc-400">{t.portal.upcomingCount}</p>
            <p className="mt-1 text-lg font-semibold text-zinc-100">{resumen.citas_proximas}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <p className="text-xs text-zinc-400">{t.portal.activeCampaigns}</p>
            <p className="mt-1 text-lg font-semibold text-zinc-100">{resumen.campanas_activas}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <p className="text-xs text-zinc-400">{t.portal.activeProjects}</p>
            <p className="mt-1 text-lg font-semibold text-zinc-100">{resumen.proyectos_activos}</p>
          </div>
          <div className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 sm:col-span-4">
            <p className="text-xs text-zinc-400">{t.portal.invoicesByStatus}</p>
            <p className="mt-1 text-sm text-zinc-100">
              {Object.entries(resumen.facturas.por_estado).length === 0
                ? t.portal.emptyInvoices
                : Object.entries(resumen.facturas.por_estado).map(([estado, n]) => `${estado}: ${n}`).join(" · ")}
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}
