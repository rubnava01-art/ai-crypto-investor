// Sub-sección "Inteligencia" de Negocio > Marketing (NEST, 2026-11-17).
// Vista de negocio con datos del backend agregado: el frontend nunca suma
// facturas en el navegador y nunca importa parseCompanyText. Todo
// require_admin en el servidor.
"use client";

import { useState } from "react";
import {
  api,
  type BiClientes, type BiResumen, type BiVentasPoint, type MeResponse,
} from "../../lib/api";
import { Panel } from "../Panel";
import { ApiErrorBanner, Field } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";
import { formatMoney } from "../../lib/format";
import { todayKey } from "../../lib/dates";
import { BarChart, LineChart, PieChart, type ChartDatum } from "./BiCharts";
import { BiKpiCards } from "./BiKpiCards";
import { CostsPanel } from "./CostsPanel";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

interface BiData {
  resumen: BiResumen;
  ventas: BiVentasPoint[];
  clientes: BiClientes;
}

export function BusinessIntelligencePanel({ me, isAdmin }: { me: MeResponse | null; isAdmin: boolean }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const today = todayKey();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [applied, setApplied] = useState({ from: monthStart, to: today });

  const load = useAsyncLoad<BiData>(
    async (signal) => {
      const [resumen, ventas, clientes] = await Promise.all([
        api.getResumen(applied, { signal }),
        api.listVentas(applied, undefined, { signal }),
        api.getClientes({ signal }),
      ]);
      return { resumen, ventas, clientes };
    },
    [applied.from, applied.to],
  );
  const data = load.data;

  const salesChart: ChartDatum[] = (data?.ventas ?? []).map((p) => ({
    label: p.mes,
    value: Number(p.total_pagado || 0),
  }));
  const clientsChart: ChartDatum[] = Object.entries(data?.clientes.por_status ?? {}).map(([label, value]) => ({
    label,
    value,
  }));
  const moneyFmt = (n: number) => formatMoney(n, "USD", locale);

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-zinc-400">{t.bi.intro}</p>
      <Panel title={t.bi.panelTitle}>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <Field label={t.bi.fromAria} className="min-w-[160px] flex-1">
            <input aria-label={t.bi.fromAria} type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t.bi.toAria} className="min-w-[160px] flex-1">
            <input aria-label={t.bi.toAria} type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <button
            type="button"
            onClick={() => setApplied({ from, to })}
            disabled={!from || !to}
            className="min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50"
          >
            {t.bi.applyRange}
          </button>
        </div>

        {load.loading ? (
          <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.bi.loading}</p>
        ) : load.error ? (
          <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
        ) : !data ? (
          <p className="py-4 text-center text-sm text-zinc-400">{t.bi.errLoad}</p>
        ) : (
          <div className="space-y-6">
            <BiKpiCards resumen={data.resumen} />

            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.bi.salesTitle}</h3>
              {salesChart.length === 0 ? (
                <p className="text-sm text-zinc-400">{t.bi.noSalesSeries}</p>
              ) : (
                <LineChart data={salesChart} fmt={moneyFmt} ariaLabel={t.bi.salesTitle} />
              )}
              <p className="mt-1 text-xs text-zinc-400">
                {t.bi.sourceInvoices.replace("{n}", String(data.resumen.ventas.n_facturas))}
              </p>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.bi.clientsTitle}</h3>
              {clientsChart.length === 0 ? (
                <p className="text-sm text-zinc-400">{t.bi.noClientsData}</p>
              ) : (
                <PieChart data={clientsChart} fmt={(n) => String(n)} ariaLabel={t.bi.clientsTitle} />
              )}
              <p className="mt-1 text-xs text-zinc-400">
                {t.bi.sourceClients.replace("{n}", String(data.resumen.clientes.total))}
              </p>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.bi.topClientsTitle}</h3>
              {data.clientes.top_por_total_pagado.length === 0 ? (
                <p className="text-sm text-zinc-400">{t.bi.noClientsData}</p>
              ) : (
                <>
                  <ul className="space-y-2 sm:hidden">
                    {data.clientes.top_por_total_pagado.map((c) => (
                      <li key={c.contact_id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                        <span className="text-sm font-semibold text-zinc-100">{c.name}</span>
                        <span className="text-sm text-zinc-100">{moneyFmt(Number(c.total_pagado || 0))}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[480px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-400">
                          <th className="py-3 pr-3 font-semibold">{t.bi.thClient}</th>
                          <th className="py-3 font-semibold">{t.bi.thTotal}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/70">
                        {data.clientes.top_por_total_pagado.map((c) => (
                          <tr key={c.contact_id} className="align-top">
                            <td className="py-3 pr-3 font-semibold text-zinc-100">{c.name}</td>
                            <td className="py-3 text-zinc-100">{moneyFmt(Number(c.total_pagado || 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.bi.salesTitle}</h3>
              {salesChart.length === 0 ? (
                <p className="text-sm text-zinc-400">{t.bi.noSalesSeries}</p>
              ) : (
                <BarChart data={salesChart} fmt={moneyFmt} ariaLabel={t.bi.salesTitle} />
              )}
            </div>
          </div>
        )}
        {!isAdmin && me && (
          <p className="mt-3 text-xs text-zinc-400">{t.business.viewerNote}</p>
        )}
      </Panel>

      <CostsPanel isAdmin={isAdmin} range={applied} />
    </div>
  );
}
