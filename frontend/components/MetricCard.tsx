// Crypto Metric Card — rediseño fintech (2026-11-14, Agente 1).
// Tarjeta glass con etiqueta, valor en tabular-nums y variación con
// color semántico. NINGÚN dato hardcodeado: todo llega por props.
// change >= 0 → esmeralda con ▲/+ ; change < 0 → rojo con ▼/− ;
// sin change → tono neutro. Con loading=true muestra el skeleton.
import { MetricCardSkeleton } from "./Skeleton";

export type MetricCardTone = "up" | "down" | "neutral";

export type MetricCardProps = {
  label: string;
  value: string;
  change?: number | null;
  changeLabel?: string;
  tone?: MetricCardTone;
  loading?: boolean;
  /** Etiqueta accesible del skeleton de carga, traducida por el
   * llamador (p. ej. t.misc.loadingAria). Sin ella no se emite
   * aria-label — nunca se hardcodea español aquí (M-2, QA 2026-11-14). */
  loadingAriaLabel?: string;
};

export function MetricCard({
  label,
  value,
  change = null,
  changeLabel,
  tone,
  loading = false,
  loadingAriaLabel,
}: MetricCardProps) {
  if (loading) return <MetricCardSkeleton ariaLabel={loadingAriaLabel} />;

  // El tono explícito manda; si no se pasa, se deduce del signo.
  const resolvedTone: MetricCardTone =
    tone ?? (change === null ? "neutral" : change >= 0 ? "up" : "down");

  const changeClass =
    resolvedTone === "up"
      ? "text-emerald-500"
      : resolvedTone === "down"
        ? "text-red-500"
        : "text-slate-400";

  const changeGlyph =
    resolvedTone === "up" ? "▲" : resolvedTone === "down" ? "▼" : null;
  const changeSign =
    change === null ? null : change >= 0 ? `+${change}` : `${change}`;

  return (
    <div className="fintech-card fintech-lift min-w-0 p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="fintech-nums mt-2 break-words text-2xl font-extrabold tracking-tight text-slate-50">
        {value}
      </p>
      {change !== null || changeLabel ? (
        // Legible sin color: el signo +/− y el glifo ▲/▼ comunican la
        // dirección aunque no se distinga el verde del rojo.
        <p className={`mt-2 text-sm font-semibold ${changeClass}`}>
          {changeGlyph ? (
            <span aria-hidden="true" className="mr-1">
              {changeGlyph}
            </span>
          ) : null}
          {changeSign !== null ? <span className="fintech-nums">{changeSign}</span> : null}
          {changeLabel ? (
            <span className="ml-1.5 font-medium text-slate-400">{changeLabel}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
