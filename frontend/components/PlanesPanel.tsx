"use client";

import { useLanguage } from "../lib/i18n";

/** Icono de verificación (sin emoji): marca de la lista de funciones. */
function Check() {
  return (
    <svg
      className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/** Módulo Planes (2026-11-06): sección de precios de suscripción de
 * Grow Business Platform, con los precios aprobados por Rubén:
 * Esencial $19/mes, Crecimiento $49/mes, Negocio Total $99/mes, todos
 * con 14 días de prueba gratis. Solo muestra los planes: no hay cobro
 * en línea todavía, la prueba y la suscripción se activan con el
 * administrador (ver activationNote). Sin botones de compra falsos. */
export function PlanesPanel() {
  const { t } = useLanguage();
  const p = t.planes;

  const cards = [
    {
      name: p.nameEsencial,
      tag: p.tagEsencial,
      price: p.priceEsencial,
      features: [p.fCrm, p.fFacturas, p.fInventario, p.fCorreos],
      popular: false,
    },
    {
      name: p.nameCrecimiento,
      tag: p.tagCrecimiento,
      price: p.priceCrecimiento,
      features: [p.fInvertir, p.fEstudiar, p.fCrear, p.fEspacio],
      includes: p.includesEsencial,
      popular: true,
    },
    {
      name: p.nameTotal,
      tag: p.tagTotal,
      price: p.priceTotal,
      features: [p.fTalento, p.fRiesgos, p.fPlanillas, p.fAnalisis, p.fReferidos, p.fAjustador],
      includes: p.includesCrecimiento,
      popular: false,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Prueba gratis: banner común a los 3 planes. */}
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
        <p className="text-sm text-amber-100">
          <span className="mr-2 inline-block rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-zinc-950">
            {p.trialBadge}
          </span>
          {p.intro}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <article
            key={c.name}
            className={
              c.popular
                ? "relative flex flex-col rounded-xl border-2 border-amber-500 bg-zinc-900/60 p-5 shadow-lg"
                : "flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"
            }
          >
            {c.popular && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-500 px-3 py-0.5 text-xs font-bold text-zinc-950">
                {p.mostPopular}
              </span>
            )}
            <h2 className="text-lg font-bold text-zinc-100">{c.name}</h2>
            <p className="mt-1 text-sm text-zinc-400">{c.tag}</p>
            <p className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold text-zinc-50">{c.price}</span>
              <span className="text-sm text-zinc-400">{p.perMonth}</span>
            </p>
            <p className="mt-1 text-xs font-semibold text-amber-300">{p.trialBadge}</p>
            <ul className="mt-5 space-y-2.5 text-sm text-zinc-200">
              {c.includes && <li className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{c.includes}</li>}
              {c.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="space-y-1 text-sm text-zinc-400">
        <p>{p.trialNote}</p>
        <p>{p.activationNote}</p>
        <p className="text-xs text-zinc-500">{p.currencyNote}</p>
      </div>
    </div>
  );
}
