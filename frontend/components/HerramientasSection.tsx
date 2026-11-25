"use client";

// Sección pública «Herramientas» — TBT-Herramientas, FASE 2 (2026-11-24).
// Componente COMPARTIDO: sección #herramientas de la landing + página
// pública /herramientas (mismo componente, dos montajes). Contenido 100 %
// estático: no lee el token ni dispara llamadas autenticadas.
// - Cada tarjeta: título real (t.nav / t.clases / t.crear / t.logo /
//   t.mockup / t.estudiarGestos / t.landing), qué hace (t.herramientas
//   <id>Desc), límite honesto (t.herramientas <id>Limit, línea ámbar,
//   patrón LandingAi) y badge «Incluido en {plan}» DERIVADO de
//   PLAN_FEATURE_KEYS (mismo cálculo acumulativo que PlanesCompare; la
//   fuente única no se toca). Sin precio por herramienta: el modelo es
//   suscripción mensual; el «kit» es el plan, no una suma de piezas.
// - CTA «Probar» → /login?next=<ruta> (la página de login redirige sola
//   a <ruta> si ya hay sesión); las 2 de acceso libre van a su ancla
//   directa con «Pruébala sin cuenta». CTA secundario «Ver en qué plan
//   va» → /#plan-<clave> (con / delante para que funcione también desde
//   la página /herramientas, donde el ancla no existe).
// - Filtro por 4 categorías (títulos de t.landing.cat*Title, los del
//   menú) + buscador que ignora acentos y mayúsculas (patrón ModuleNav);
//   sin resultados, role="status". Grid como LandingAi.
// - Cierre «una herramienta o todo el kit» con los 3 precios de t.planes
//   (sin duplicar) + CTA a /#planes, y bloque «pregunta gratis»: abrir
//   el Asistente flotante (evento growbusiness:open-asistente, que
//   escucha AsistenteChat) + «Escríbenos» → /contacto. Texto honesto:
//   conversación con el Asistente / mensaje, NUNCA llamada de 20 min
//   con una persona (no existe ese equipo).
// - Sin testimonios, clientes, métricas ni badges de popularidad.
//   Toda mención a Invertir conserva «Simulación — sin dinero real»
//   (en el límite de su tarjeta); ninguna tarjeta promete ganancias.

import Link from "next/link";
import { useState } from "react";
import { useLanguage } from "../lib/i18n";
import {
  HERRAMIENTAS,
  HERRAMIENTA_CATEGORIES,
  OPEN_ASISTENTE_EVENT,
  type HerramientaCategoria,
  type HerramientaDef,
  type HerramientaId,
} from "../lib/herramientas";
import { PLAN_CARD_IDS, PLAN_FEATURE_KEYS, PLAN_KEYS, planNameForKey } from "./PlanesPanel";

/** Normaliza para el buscador (patrón ModuleNav): minúsculas, sin acentos. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Plan mínimo que incluye una función (mismo cálculo que PlanesCompare:
 * cada nivel acumula el anterior). Índice 0 = Esencial, 1 = Crecimiento,
 * 2 = Negocio Total; -1 si la función no está en la matriz (en v1 no
 * ocurre: el corte de lanzamiento solo lista herramientas cubiertas). */
const includedByPlan: Set<string>[] = PLAN_FEATURE_KEYS.map((_, i) =>
  new Set(PLAN_FEATURE_KEYS.slice(0, i + 1).flat()),
);
function planIndexForFeature(featureKey: string): number {
  return includedByPlan.findIndex((included) => included.has(featureKey));
}

/** Iconos stroke por categoría (currentColor, sin emoji, sin imágenes),
 * estilo ModuleNav: un acento por familia. */
function CategoryIcon({ categoria }: { categoria: HerramientaCategoria }) {
  const common = {
    className: "h-5 w-5 shrink-0",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  if (categoria === "invierte")
    return (
      <svg {...common}>
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 3 3 5-6" />
      </svg>
    );
  if (categoria === "aprende")
    return (
      <svg {...common}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    );
  if (categoria === "crea")
    return (
      <svg {...common}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

const CATEGORY_ACCENT: Record<HerramientaCategoria, string> = {
  invierte: "text-emerald-400",
  aprende: "text-sky-400",
  crea: "text-violet-400",
  gestiona: "text-amber-400",
};

export function HerramientasSection({ headingLevel = "h2" }: { headingLevel?: "h1" | "h2" } = {}) {
  const { t } = useLanguage();
  const h = t.herramientas;
  const l = t.landing;
  const p = t.planes;
  const [category, setCategory] = useState<HerramientaCategoria | "todas">("todas");
  const [query, setQuery] = useState("");

  // Títulos reales por herramienta (explícitos, sin acceso dinámico):
  // t.nav para los módulos, t.clases para las 5 de Clases, t.crear /
  // t.logo / t.mockup para Crear, t.estudiarGestos para las secciones
  // de Estudiar y t.landing.ai6Title para los precios en vivo.
  const titles: Record<HerramientaId, string> = {
    invertir: t.nav.invertir.label,
    precios: l.ai6Title,
    academia: t.estudiarGestos.tabAcademia,
    manuales: t.estudiarGestos.tabManuales,
    juego: t.estudiarGestos.tabJuego,
    videos: t.estudiarGestos.tabVideos,
    calculadora: t.clases.calcTitle,
    conversor: t.clases.convTitle,
    grafica: t.clases.chartTitle,
    indicadores: t.clases.indTitle,
    bitcoin: t.clases.btcTitle,
    copies: t.crear.copyTitle,
    logo: t.logo.title,
    mockup: t.mockup.title,
    tendencias: t.crear.trendsTitle,
    crm: t.nav.crm.label,
    facturas: t.nav.facturas.label,
    inventario: t.nav.inventario.label,
    correos: t.nav.correos.label,
    referidos: t.nav.referidos.label,
    talento: t.nav.talento.label,
    riesgos: t.nav.riesgos.label,
    planillas: t.nav.planillas.label,
    analisis: t.nav.analisis.label,
    espacio: t.nav.espacio.label,
  };
  // Qué hace + límite honesto por herramienta (explícitos, mismo patrón
  // que LandingAi: ai{N}Title/Desc/Limit).
  const texts: Record<HerramientaId, { desc: string; limit: string }> = {
    invertir: { desc: h.invertirDesc, limit: h.invertirLimit },
    precios: { desc: h.preciosDesc, limit: h.preciosLimit },
    academia: { desc: h.academiaDesc, limit: h.academiaLimit },
    manuales: { desc: h.manualesDesc, limit: h.manualesLimit },
    juego: { desc: h.juegoDesc, limit: h.juegoLimit },
    videos: { desc: h.videosDesc, limit: h.videosLimit },
    calculadora: { desc: h.calculadoraDesc, limit: h.calculadoraLimit },
    conversor: { desc: h.conversorDesc, limit: h.conversorLimit },
    grafica: { desc: h.graficaDesc, limit: h.graficaLimit },
    indicadores: { desc: h.indicadoresDesc, limit: h.indicadoresLimit },
    bitcoin: { desc: h.bitcoinDesc, limit: h.bitcoinLimit },
    copies: { desc: h.copiesDesc, limit: h.copiesLimit },
    logo: { desc: h.logoDesc, limit: h.logoLimit },
    mockup: { desc: h.mockupDesc, limit: h.mockupLimit },
    tendencias: { desc: h.tendenciasDesc, limit: h.tendenciasLimit },
    crm: { desc: h.crmDesc, limit: h.crmLimit },
    facturas: { desc: h.facturasDesc, limit: h.facturasLimit },
    inventario: { desc: h.inventarioDesc, limit: h.inventarioLimit },
    correos: { desc: h.correosDesc, limit: h.correosLimit },
    referidos: { desc: h.referidosDesc, limit: h.referidosLimit },
    talento: { desc: h.talentoDesc, limit: h.talentoLimit },
    riesgos: { desc: h.riesgosDesc, limit: h.riesgosLimit },
    planillas: { desc: h.planillasDesc, limit: h.planillasLimit },
    analisis: { desc: h.analisisDesc, limit: h.analisisLimit },
    espacio: { desc: h.espacioDesc, limit: h.espacioLimit },
  };
  const categoryTitle: Record<HerramientaCategoria, string> = {
    invierte: l.catSimTitle,
    aprende: l.catAcademyTitle,
    crea: l.catContentTitle,
    gestiona: l.catManageTitle,
  };

  // 25 herramientas: el filtrado es trivial, sin memoizar.
  const q = norm(query.trim());
  const filtered = HERRAMIENTAS.filter((tool) => {
    if (category !== "todas" && tool.categoria !== category) return false;
    if (!q) return true;
    const haystack = norm(`${titles[tool.id]} ${texts[tool.id].desc} ${categoryTitle[tool.categoria]}`);
    return haystack.includes(q);
  });

  const openAsistente = () => {
    window.dispatchEvent(new CustomEvent(OPEN_ASISTENTE_EVENT));
  };

  const Heading = headingLevel;
  const kitPlans = [
    { name: p.nameEsencial, price: p.priceEsencial },
    { name: p.nameCrecimiento, price: p.priceCrecimiento },
    { name: p.nameTotal, price: p.priceTotal },
  ];

  return (
    <section id="herramientas" aria-label={h.sectionAria} className="scroll-mt-20 border-t border-slate-800/80 py-10 sm:py-12">
      <Heading className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">{h.title}</Heading>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">{h.intro}</p>

      {/* Filtro por categoría + buscador. */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label={h.filterAria} className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={category === "todas"}
            onClick={() => setCategory("todas")}
            className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
              category === "todas"
                ? "border-blue-500 bg-blue-600 text-white"
                : "border-white/10 bg-white/[0.03] text-slate-200 hover:border-blue-500/40"
            }`}
          >
            {h.filterAll}
          </button>
          {HERRAMIENTA_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                category === cat
                  ? "border-blue-500 bg-blue-600 text-white"
                  : "border-white/10 bg-white/[0.03] text-slate-200 hover:border-blue-500/40"
              }`}
            >
              {categoryTitle[cat]}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="herramientas-buscar">
          {h.searchAria}
        </label>
        <input
          id="herramientas-buscar"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={h.searchPlaceholder}
          aria-label={h.searchAria}
          className="min-h-[44px] w-full rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 sm:w-64"
        />
      </div>

      {/* Grid de tarjetas (patrón LandingAi). */}
      {filtered.length === 0 ? (
        <p role="status" className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5 text-sm leading-relaxed text-slate-400">
          {h.noResults}
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tool: HerramientaDef) => {
            const planIdx = planIndexForFeature(tool.featureKey);
            // H-06 (QA TBT-Herramientas): sin plan en la matriz NO se
            // asume Esencial — en desarrollo se falla alto y en
            // producción la tarjeta no se renderiza. El test impide el
            // caso en v1; esto es defensa en profundidad.
            if (planIdx < 0) {
              if (process.env.NODE_ENV !== "production") {
                throw new Error(`Herramienta sin plan en PLAN_FEATURE_KEYS: ${tool.id}`);
              }
              return null;
            }
            const planKey = PLAN_KEYS[planIdx];
            const planName = planNameForKey(t, planKey);
            const badge = h.includedIn.replace("{plan}", planName);
            const tryHref = tool.free ? tool.href : `/login?next=${encodeURIComponent(tool.href)}`;
            const tryLabel = tool.free ? h.tryFree : h.tryCta;
            return (
              <article
                key={tool.id}
                aria-label={`${titles[tool.id]} — ${badge}`}
                className="flex flex-col rounded-xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={CATEGORY_ACCENT[tool.categoria]}>
                    <CategoryIcon categoria={tool.categoria} />
                  </span>
                  {badge && (
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300">
                      {badge}
                    </span>
                  )}
                </div>
                <h3 className="mt-3 text-lg font-bold text-slate-50">{titles[tool.id]}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">{texts[tool.id].desc}</p>
                <p className="mt-3 border-t border-white/10 pt-3 text-sm leading-relaxed text-amber-300/90">
                  {texts[tool.id].limit}
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <Link
                    href={tryHref}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                  >
                    {tryLabel}
                  </Link>
                  <a
                    href={`/#${PLAN_CARD_IDS[planIdx]}`}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2.5 text-sm font-semibold text-blue-400 transition-colors hover:text-blue-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                  >
                    {h.seePlan}
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Cierre «una herramienta o todo el kit» (precios de t.planes). */}
      <div className="mt-8 rounded-xl border border-blue-500/30 bg-blue-500/[0.07] px-4 py-6 backdrop-blur sm:px-6">
        <h3 className="text-xl font-bold tracking-tight text-slate-50">{h.kitTitle}</h3>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{h.kitDesc}</p>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {kitPlans.map((plan) => (
            <p key={plan.name} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-slate-200">{plan.name}</span>
              <span className="text-2xl font-extrabold tabular-nums tracking-tight text-slate-50">{plan.price}</span>
              <span className="text-sm text-slate-400">{p.perMonth}</span>
            </p>
          ))}
        </div>
        <p className="mt-4">
          <span className="inline-block rounded-full bg-emerald-500/15 px-3.5 py-1.5 text-sm font-bold text-emerald-300">
            {p.trialBadge}
          </span>
        </p>
        <div className="mt-4">
          <Link
            href="/#planes"
            className="inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
          >
            {h.kitCta}
          </Link>
        </div>
      </div>

      {/* Bloque «pregunta gratis»: Asistente flotante + /contacto. */}
      <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur sm:p-6">
        <h3 className="text-lg font-bold text-slate-50">{h.askTitle}</h3>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{h.askDesc}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={openAsistente}
            className="inline-flex min-h-[44px] items-center rounded-lg bg-emerald-700 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {h.askChatCta}
          </button>
          <Link
            href="/contacto"
            className="inline-flex min-h-[44px] items-center rounded-lg border border-zinc-700 px-5 py-3 text-sm font-bold text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
          >
            {h.askWriteCta}
          </Link>
        </div>
      </div>
    </section>
  );
}
