"use client";

import Link from "next/link";
import { useLanguage } from "../lib/i18n";
import { paymentUrlForPlan } from "../lib/pagos";
import { PLAN_KEYS } from "../lib/planes";
import { safeHttpHref } from "../lib/urls";

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
 * administrador (ver activationNote). Sin botones de compra falsos.
 * C5 (2026-11-14): el CTA de cada tarjeta pasa por
 * `paymentUrlForPlan` (lib/pagos.ts): si el plan ya tiene URL de pago
 * de PayPal, el CTA va directo al pago; si es `null` (hoy, los 3),
 * sigue el flujo actual de registro con plan elegido. */
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
 * Sufijos de las claves de t.planes (nameEsencial, priceEsencial…).
 * Definidos en lib/planes.ts (2.4, 2026-11-26): /login los importaba
 * desde aquí y arrastraba todo este módulo al chunk de login. Se
 * re-exportan para no romper a los importadores existentes. */
export { PLAN_KEYS, isPlanKey, planNameForKey, type PlanKey } from "../lib/planes";

/** Ids de ancla de cada tarjeta de plan (para la segmentación por etapa
 * de la landing: #plan-esencial, #plan-crecimiento, #plan-total). */
export const PLAN_CARD_IDS = ["plan-esencial", "plan-crecimiento", "plan-total"] as const;


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

      <div className="grid gap-4 md:grid-cols-3 md:gap-5">
        {cards.map((c) => {
          // C5: URL de pago del plan (hoy `null` en los 3: flujo actual).
          // F4 (2026-11-23, B3): solo http/https llega a href; una URL
          // con otro esquema no se enlaza y el CTA cae al registro.
          const payUrl = safeHttpHref(paymentUrlForPlan(c.planKey));
          return (
          <article
            key={c.name}
            id={c.id}
            className={
              c.popular
                ? "relative flex scroll-mt-20 flex-col rounded-xl border-2 border-amber-500 bg-zinc-900/60 p-6 shadow-2xl shadow-amber-500/10 md:scale-[1.02]"
                : "flex scroll-mt-20 flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 p-6"
            }
          >
            {/* M1 (2026-11-13): sin badge "El más elegido" — era una
                afirmación sin fuente. El borde ámbar de la tarjeta central
                se conserva como distinción visual, sin texto. C5
                (2026-11-14): la tarjeta central además crece (scale) y
                gana sombra, para destacar sin inventar ninguna
                afirmación. */}
            <h2 className="text-lg font-bold text-zinc-100">{c.name}</h2>
            <p className="mt-1 text-sm text-zinc-400">{c.tag}</p>
            {/* C5: el precio manda — mucho más grande que el nombre, con
                la prueba gratis como píldora prominente justo debajo. */}
            <p className="mt-5 flex items-baseline gap-1.5">
              <span className="text-5xl font-extrabold tabular-nums tracking-tight text-zinc-50 sm:text-6xl">{c.price}</span>
              <span className="text-base text-zinc-400">{p.perMonth}</span>
            </p>
            <p className="mt-3">
              <span className="inline-block rounded-full bg-amber-500/15 px-3 py-1 text-sm font-bold text-amber-300">
                {p.trialBadge}
              </span>
            </p>
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
                ?plan= hasta el registro y de ahí al admin.
                C5 (2026-11-14): el CTA pasa por `paymentUrlForPlan`
                (lib/pagos.ts). Hoy las 3 URLs son `null`, así que el
                CTA es exactamente el de antes (registro con plan
                elegido, intacto). Cuando el dueño ponga la URL de pago
                de PayPal de un plan, ese CTA irá directo al pago. */}
            {payUrl ? (
              <a
                href={payUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
              >
                {p.startWith.replace("{plan}", c.name)}
              </a>
            ) : (
              <Link
                href={`/login?mode=register&plan=${c.planKey}`}
                className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
              >
                {p.startWith.replace("{plan}", c.name)}
              </Link>
            )}
          </article>
          );
        })}
      </div>

      <div className="space-y-1 text-sm text-zinc-400">
        <p>{p.trialNote}</p>
        <p>{p.activationNote}</p>
        <p className="text-xs text-zinc-400">{p.currencyNote}</p>
        {/* Fase 2 mejoras-v1, tarea 3: reembolsos y cancelación. */}
        <p className="pt-2">
          <Link href="/legal/reembolsos" className="font-semibold text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            {p.refundsLink}
          </Link>
        </p>
      </div>

      {/* M-1 (TBT-Herramientas, FASE 2, 2026-11-24): enlace cruzado al
          final de PlanesPanel (NO en las tarjetas, para no tocar el
          flujo de registro): ver las herramientas una a una y preguntar
          gratis. En la landing queda entre las tarjetas y la tabla
          comparativa (<PlanesCompare /> se monta después de este panel);
          en la página /planes, que no monta la tabla, queda al pie de
          los planes. PLAN_FEATURE_KEYS no se toca. */}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Link
          href="/herramientas"
          className="inline-flex min-h-[44px] items-center rounded-lg px-2 py-2.5 font-semibold text-blue-400 hover:text-blue-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
        >
          {p.toolsLink}
        </Link>
        <Link
          href="/contacto"
          className="inline-flex min-h-[44px] items-center rounded-lg px-2 py-2.5 font-semibold text-blue-400 hover:text-blue-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
        >
          {p.askFree}
        </Link>
      </p>
    </div>
  );
}
