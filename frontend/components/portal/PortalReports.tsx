// Reportes del portal (NEST, 2026-11-17): resumen computado en vivo por el
// servidor (/portal/resumen) + lista de próximas citas. Solo lectura, solo
// lo propio. Solo endpoints /api/business/marketing/portal/*.
"use client";

import { api, type Appointment, type PortalResumen } from "../../lib/api";
import { Panel } from "../Panel";
import { ApiErrorBanner } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";
import { formatMoney } from "../../lib/format";
import { formatDateTimeTz } from "../../lib/dates";

export function PortalReports({ contactId }: { contactId?: number }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const load = useAsyncLoad<{ resumen: PortalResumen; citas: Appointment[] }>(
    async (signal) => {
      const [resumen, citas] = await Promise.all([
        api.getPortalResumen(contactId, { signal }),
        api.listPortalAppointments(contactId, { signal }),
      ]);
      return { resumen, citas };
    },
    [contactId],
  );
  const data = load.data;

  return (
    <Panel title={t.portal.reportsTitle}>
      {load.loading ? (
        <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.portal.loading}</p>
      ) : load.error ? (
        <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
      ) : !data ? (
        <p className="py-4 text-center text-sm text-zinc-400">{t.portal.errLoad}</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <p className="text-xs text-zinc-400">{t.portal.paidTotal}</p>
              <p className="mt-1 text-lg font-semibold text-zinc-100">{formatMoney(data.resumen.facturas.total_pagado, "USD", locale)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <p className="text-xs text-zinc-400">{t.portal.upcomingCount}</p>
              <p className="mt-1 text-lg font-semibold text-zinc-100">{data.resumen.citas_proximas}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <p className="text-xs text-zinc-400">{t.portal.activeCampaigns}</p>
              <p className="mt-1 text-lg font-semibold text-zinc-100">{data.resumen.campanas_activas}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <p className="text-xs text-zinc-400">{t.portal.activeProjects}</p>
              <p className="mt-1 text-lg font-semibold text-zinc-100">{data.resumen.proyectos_activos}</p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.portal.invoicesByStatus}</h3>
            {Object.entries(data.resumen.facturas.por_estado).length === 0 ? (
              <p className="text-sm text-zinc-400">{t.portal.emptyInvoices}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {Object.entries(data.resumen.facturas.por_estado).map(([estado, n]) => (
                  <li key={estado} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                    <span className="text-zinc-300">{estado}</span>
                    <span className="font-semibold text-zinc-100">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.portal.upcomingTitle}</h3>
            {data.citas.length === 0 ? (
              <p className="text-sm text-zinc-400">{t.portal.emptyAppointments}</p>
            ) : (
              <ul className="space-y-2">
                {data.citas.map((a) => (
                  <li key={a.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                    <p className="text-sm font-semibold text-zinc-100">{a.service_type}</p>
                    <p className="text-xs text-zinc-400">{formatDateTimeTz(a.starts_at, locale)} · {a.duration_min} min</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
