"use client";

import Link from "next/link";
import { useLanguage } from "../lib/i18n";

/** Icono de verificación (sin emoji): marca de la lista de funciones. */
export function Check() {
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
/** Funciones propias de cada plan, como claves de t.planes, en orden
 * Esencial → Crecimiento → Negocio Total. FUENTE ÚNICA: las tarjetas de
 * abajo y la tabla comparativa (<PlanesCompare />) se derivan de aquí
 * por código; nunca reescribir las listas a mano en otro sitio. Cada
 * nivel acumula el anterior ("Todo lo de X, más:"). */
export const PLAN_FEATURE_KEYS = [
  ["fCrm", "fFacturas", "fInventario", "fCorreos"],
  ["fInvertir", "fEstudiar", "fCrear", "fEspacio"],
  ["fTalento", "fRiesgos", "fPlanillas", "fAnalisis", "fReferidos", "fAjustador"],
] as const;

/** Claves de plan para ?plan= (contrato A2, 2026-11-13): los valores
 * EXACTOS que viajan en /login?mode=register&plan=<clave> y en el
 * payload de registro; el admin los ve en la vista de pendientes.
 * Sufijos de las claves de t.planes (nameEsencial, priceEsencial…). */
export const PLAN_KEYS = ["esencial", "crecimiento", "total"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export function isPlanKey(value: string | null | undefined): value is PlanKey {
  return value === "esencial" || value === "crecimiento" || value === "total";
}

/** Ids de ancla de cada tarjeta de plan (para la segmentación por etapa
 * de la landing: #plan-esencial, #plan-crecimiento, #plan-total). */
export const PLAN_CARD_IDS = ["plan-esencial", "plan-crecimiento", "plan-total"] as const;

/** Nombre visible de un plan por su clave (para el aviso post-registro). */
export function planNameForKey(t: { planes: Record<string, string> }, key: PlanKey): string {
  const map: Record<PlanKey, string> = {
    esencial: t.planes.nameEsencial,
    crecimiento: t.planes.nameCrecimiento,
    total: t.planes.nameTotal,
  };
  return map[key];
}

export function PlanesPanel() {
  const { t } = useLanguage();
  const p = t.planes;

  const cards = [
    {
      id: PLAN_CARD_IDS[0],
      planKey: PLAN_KEYS[0],
      name: p.nameEsencial,
      tag: p.tagEsencial,
      price: p.priceEsencial,
      features: PLAN_FEATURE_KEYS[0].map((k) => p[k]),
      popular: false,
    },
    {
      id: PLAN_CARD_IDS[1],
      planKey: PLAN_KEYS[1],
      name: p.nameCrecimiento,
      tag: p.tagCrecimiento,
      price: p.priceCrecimiento,
      features: PLAN_FEATURE_KEYS[1].map((k) => p[k]),
      includes: p.includesEsencial,
      popular: true,
    },
    {
      id: PLAN_CARD_IDS[2],
      planKey: PLAN_KEYS[2],
      name: p.nameTotal,
      tag: p.tagTotal,
      price: p.priceTotal,
      features: PLAN_FEATURE_KEYS[2].map((k) => p[k]),
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
            id={c.id}
            className={
              c.popular
                ? "relative flex scroll-mt-20 flex-col rounded-xl border-2 border-amber-500 bg-zinc-900/60 p-5 shadow-lg"
                : "flex scroll-mt-20 flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"
            }
          >
            {/* M1 (2026-11-13): sin badge "El más elegido" — era una
                afirmación sin fuente. El borde ámbar de la tarjeta central
                se conserva como distinción visual, sin texto. */}
            <h2 className="text-lg font-bold text-zinc-100">{c.name}</h2>
            <p className="mt-1 text-sm text-zinc-400">{c.tag}</p>
            <p className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold text-zinc-50">{c.price}</span>
              <span className="text-sm text-zinc-400">{p.perMonth}</span>
            </p>
            <p className="mt-1 text-xs font-semibold text-amber-300">{p.trialBadge}</p>
            <ul className="mt-5 flex-1 space-y-2.5 text-sm text-zinc-200">
              {c.includes && <li className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{c.includes}</li>}
              {c.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {/* A2: CTA propio por tarjeta — la elección de plan viaja en
                ?plan= hasta el registro y de ahí al admin. */}
            <Link
              href={`/login?mode=register&plan=${c.planKey}`}
              className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            >
              {p.startWith.replace("{plan}", c.name)}
            </Link>
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
