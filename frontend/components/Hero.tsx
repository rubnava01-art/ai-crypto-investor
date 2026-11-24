// Hero de alto impacto — rediseño fintech (2026-11-14, Agente 1).
// Presentacional: todo el texto llega por props (i18n en el llamador).
// `children` es el slot de la calculadora de interés compuesto: el hero
// la recibe y la muestra en la tarjeta glass de la derecha; nunca se
// reimplementa ni se quita aquí.
import Link from "next/link";
import type { ReactNode } from "react";

export type HeroProps = {
  eyebrow?: string;
  /** Badge de simulación junto al eyebrow (Fase 2, 2026-11-23). */
  simBadge?: string;
  /** Disclaimer de simulación bajo los CTAs (texto existente, sube de posición). */
  simNote?: string;
  title: string;
  subtitle?: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  /** Si se pasa, sustituye al enlace secundario (p. ej. el botón de
   * prueba sin registro, que abre el reto matemático en vez de navegar). */
  secondaryButton?: ReactNode;
  children?: ReactNode;
};

export function Hero({
  eyebrow,
  simBadge,
  simNote,
  title,
  subtitle,
  primaryLabel,
  primaryHref,
  secondaryLabel,
  secondaryHref,
  secondaryButton,
  children,
}: HeroProps) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-[#030712] py-12 sm:py-16">
      {/* Glow decorativo fintech: esmeralda + azul, solo ambiente. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-blue-500/10 blur-3xl" />
      </div>

      <div className="relative grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {eyebrow ? (
              <p className="fintech-eyebrow">{eyebrow}</p>
            ) : null}
            {simBadge ? (
              <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-300">
                {simBadge}
              </span>
            ) : null}
          </div>
          {/* Titular masivo, móvil primero: 36px a 390px, 48px en sm,
              60px en escritorio. Sin desbordamiento: tracking ajustado
              y palabras largas con balanceo. */}
          <h1 className="max-w-3xl text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-50 sm:text-5xl lg:text-6xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">
              {subtitle}
            </p>
          ) : null}
          {/* Doble CTA con el sistema de botones: primario sólido de
              marca, secundario glass con borde sutil. */}
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={primaryHref} className="fintech-btn fintech-btn-primary">
              {primaryLabel}
            </Link>
            {secondaryButton ??
              (secondaryLabel && secondaryHref ? (
                <Link href={secondaryHref} className="fintech-btn fintech-btn-secondary">
                  {secondaryLabel}
                </Link>
              ) : null)}
          </div>
          {simNote ? (
            <p className="mt-4 max-w-2xl text-sm font-medium leading-relaxed text-amber-400">
              {simNote}
            </p>
          ) : null}
        </div>

        {children ? (
          <div className="fintech-card min-w-0 p-5 sm:p-6">{children}</div>
        ) : null}
      </div>
    </section>
  );
}
