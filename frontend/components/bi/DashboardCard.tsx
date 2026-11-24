// Tarjeta de gráfica estilo Semrush (corrida 2026-11-23, chat potente +
// perfiles). Referencia SOLO visual: la guía de Semrush
// (semrush.com/blog/how-to-optimize-website-for-seo/, leída 2026-11-24)
// muestra tarjetas de métricas limpias con número grande + contexto,
// gráficas claras y jerarquía fuerte con mucho aire. Los datos aquí
// son SIEMPRE propios de la plataforma: si un panel no tiene datos
// reales, la tarjeta muestra el vacío ("Sin datos todavía"), nunca
// cifras inventadas. Sin afiliación ni datos de Semrush: solo el
// estilo. Sin dependencias nuevas: SVG/CSS, como BiCharts.
"use client";

import type { ReactNode } from "react";
import { useLanguage } from "../../lib/i18n";

export function ChartCard({
  title,
  context,
  empty = false,
  emptyText,
  children,
}: {
  title: string;
  context?: string;
  /** Sin datos reales: muestra el vacío en vez del gráfico. */
  empty?: boolean;
  /** Texto del vacío; por defecto, el genérico de datos propios. */
  emptyText?: string;
  children?: ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <section className="fintech-card p-5">
      <h3 className="text-sm font-semibold uppercase leading-6 tracking-wider text-slate-200">
        {title}
      </h3>
      {context ? (
        <p className="mt-1 text-sm leading-relaxed text-slate-400">{context}</p>
      ) : null}
      <div className="mt-4">
        {empty ? (
          <p className="py-6 text-center text-sm text-zinc-400">{emptyText ?? t.bi.noData}</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
