// Tarjetas KPI del BI (NEST, 2026-11-17). Cada KPI lleva su línea de
// fuente; sin datos se dice "sin datos", nunca un 0 presentado como dato
// real sin contexto. Sin costos registrados, la rentabilidad es
// "Sin datos suficientes", nunca ventas − 0.
"use client";

import type { BiResumen } from "../../lib/api";
import { useLanguage } from "../../lib/i18n";
import { formatMoney } from "../../lib/format";

function Kpi({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-100">{value}</p>
      <p className="mt-1 text-xs text-zinc-400">{source}</p>
    </div>
  );
}

export function BiKpiCards({ resumen }: { resumen: BiResumen }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const money = (v: string | number | null | undefined) => formatMoney(v, "USD", locale);

  const hasSales = resumen.ventas.n_facturas > 0;
  const hasClients = resumen.clientes.total > 0;
  const costEntries = Object.entries(resumen.costos.por_categoria);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Kpi
        label={t.bi.kpiSales}
        value={hasSales ? money(resumen.ventas.total_pagado) : t.bi.noSales}
        source={t.bi.sourceInvoices.replace("{n}", String(resumen.ventas.n_facturas))}
      />
      <Kpi
        label={t.bi.kpiSalesSent}
        value={hasSales ? money(resumen.ventas.total_enviado) : t.bi.noSales}
        source={t.bi.sourceInvoices.replace("{n}", String(resumen.ventas.n_facturas))}
      />
      <Kpi
        label={t.bi.kpiCosts}
        value={resumen.costos_sin_datos ? t.bi.noCosts : money(resumen.costos.total)}
        source={
          costEntries.length > 0
            ? costEntries.map(([cat, v]) => `${cat}: ${money(v)}`).join(" · ")
            : t.bi.noCosts
        }
      />
      <Kpi
        label={t.bi.kpiProfit}
        value={resumen.costos_sin_datos || resumen.rentabilidad === null ? t.bi.noProfitData : money(resumen.rentabilidad)}
        source={resumen.costos_sin_datos ? t.bi.noCosts : `${t.bi.kpiSales} − ${t.bi.kpiCosts}`}
      />
      <Kpi
        label={t.bi.kpiClients}
        value={hasClients ? String(resumen.clientes.total) : t.bi.noClients}
        source={t.bi.sourceClients.replace("{n}", String(resumen.clientes.total))}
      />
      <Kpi
        label={t.bi.kpiNewClients}
        value={hasClients ? String(resumen.clientes.nuevos_en_periodo) : t.bi.noClients}
        source={t.bi.sourceClients.replace("{n}", String(resumen.clientes.total))}
      />
      <div className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 sm:col-span-3">
        <p className="text-xs text-zinc-400">{t.bi.kpiAds}</p>
        <p className="mt-1 text-sm text-zinc-100">
          {t.bi.adsActive}: {resumen.publicidad.campanas_activas} · {t.bi.adsSpend}: {money(resumen.publicidad.gasto_total)} · {t.bi.referralsActive}: {resumen.publicidad.referidos_activos}
        </p>
      </div>
    </div>
  );
}
