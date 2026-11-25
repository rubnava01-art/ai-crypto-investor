// Skeleton genérico animado (2026-11-14, Agente 1): sustituye las
// pantallas de carga genéricas por placeholders con animate-pulse.
// `className` define tamaño/forma (el llamador pone h-*, w-*,
// rounded-*). Con movimiento reducido el pulso se apaga (ver
// .fintech-skeleton en globals.css).
// `ariaLabel` la pasa el llamador ya traducida (p. ej.
// t.misc.loadingAria, como hace loading.tsx con su propio
// role="status"); sin ella no se emite aria-label — nunca se hardcodea
// español aquí (corrección M-2, QA 2026-11-14).
export function Skeleton({
  className = "",
  ariaLabel,
}: {
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={`fintech-skeleton motion-safe:animate-pulse rounded-lg bg-slate-800 ${className}`}
    />
  );
}

export default Skeleton;

/** Skeleton de lista (filas título + líneas): sustituye al texto plano
 * "Cargando…" en listas de paneles (CRM, Facturas, Inventario, Riesgos,
 * Planillas, Talento, Correos, Señales). `ariaLabel` la pasa el llamador
 * ya traducida (p. ej. t.misc.loadingAria); sin ella no se emite
 * aria-label — nunca se hardcodea español aquí. */
export function ListSkeleton({
  rows = 3,
  ariaLabel,
}: {
  rows?: number;
  ariaLabel?: string;
}) {
  return (
    <div role="status" aria-label={ariaLabel} className="space-y-3 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} aria-hidden="true" className="space-y-2">
          <div className="fintech-skeleton motion-safe:animate-pulse h-4 w-2/5 rounded bg-slate-800" />
          <div className="fintech-skeleton motion-safe:animate-pulse h-3 w-full rounded bg-slate-800" />
          <div className="fintech-skeleton motion-safe:animate-pulse h-3 w-3/4 rounded bg-slate-800" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton con la forma de una MetricCard: etiqueta + valor + cambio. */
export function MetricCardSkeleton({
  className = "",
  ariaLabel,
}: {
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={`fintech-card min-w-0 p-5 ${className}`}
    >
      <div className="fintech-skeleton motion-safe:animate-pulse h-4 w-24 rounded bg-slate-800" />
      <div className="fintech-skeleton motion-safe:animate-pulse mt-3 h-8 w-32 rounded bg-slate-800" />
      <div className="fintech-skeleton motion-safe:animate-pulse mt-3 h-4 w-16 rounded bg-slate-800" />
    </div>
  );
}

/** Skeleton con la forma del Hero: titular + subtítulo + CTAs + tarjeta. */
export function HeroSkeleton({
  className = "",
  ariaLabel,
}: {
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={`grid grid-cols-1 items-start gap-8 lg:grid-cols-2 ${className}`}
    >
      <div>
        <div className="fintech-skeleton motion-safe:animate-pulse h-4 w-40 rounded bg-slate-800" />
        <div className="fintech-skeleton motion-safe:animate-pulse mt-4 h-12 w-full max-w-lg rounded bg-slate-800" />
        <div className="fintech-skeleton motion-safe:animate-pulse mt-3 h-12 w-4/5 max-w-md rounded bg-slate-800" />
        <div className="fintech-skeleton motion-safe:animate-pulse mt-4 h-6 w-3/4 rounded bg-slate-800" />
        <div className="mt-8 flex flex-wrap gap-3">
          <div className="fintech-skeleton motion-safe:animate-pulse h-11 w-36 rounded-lg bg-slate-800" />
          <div className="fintech-skeleton motion-safe:animate-pulse h-11 w-36 rounded-lg bg-slate-800" />
        </div>
      </div>
      <div className="fintech-card p-5 sm:p-6">
        <div className="fintech-skeleton motion-safe:animate-pulse h-6 w-48 rounded bg-slate-800" />
        <div className="fintech-skeleton motion-safe:animate-pulse mt-4 h-40 rounded-lg bg-slate-800" />
      </div>
    </div>
  );
}
