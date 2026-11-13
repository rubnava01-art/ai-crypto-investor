"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../lib/i18n";
import { PublicNav } from "./PublicNav";
import { PlanesPanel } from "./PlanesPanel";
import { CompoundCalculator } from "./CompoundCalculator";
import { landingModuleKeys } from "./ModuleNav";
import { SkipLink } from "./ui";
import { Footer } from "./Footer";

// M3 (2026-11-13): lo que está bajo el pliegue (sección IA y tabla
// comparativa) no viaja en el bundle inicial: se carga al renderizar,
// con un estado de carga visible. El héroe y la franja de precios se
// quedan en el bundle inicial.
const sectionLoading = () => (
  <div role="status" className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-sm text-zinc-400">
    <SectionLoadingText />
  </div>
);
function SectionLoadingText() {
  const { t } = useLanguage();
  return <>{t.common.loading}</>;
}
const LandingAi = dynamic(() => import("./LandingAi").then((m) => m.LandingAi), {
  ssr: false,
  loading: sectionLoading,
});
const PlanesCompare = dynamic(() => import("./PlanesCompare").then((m) => m.PlanesCompare), {
  ssr: false,
  loading: sectionLoading,
});

/** Presentación pública de Grow Business Platform (2026-11-12): lo que
 * ve un visitante sin sesión en la raíz, en vez de acabar en /login.
 * Contenido estático: no lee el token ni dispara llamadas autenticadas.
 * Precios y beneficios a la vista, sin clic: franja compacta de precios
 * justo bajo el héroe + la sección completa de planes justo después de
 * los módulos. Los precios y beneficios vienen de t.planes a través de
 * <PlanesPanel /> (una sola fuente: Esencial $19, Crecimiento $49,
 * Negocio Total $99, 14 días gratis). Los módulos extra son los reales
 * del menú (t.nav, mismos nombres que ModuleNav): nada inventado.
 * Sin emojis; fondo casi negro y azul fuerte, como la casa.
 *
 * Orden de secciones: héroe (con calculadora) → franja de confianza →
 * franja de precios → 4 pilares → sección IA → etapas → planes + tabla
 * comparativa → cómo empezar → cierre final con CTA → footer.
 * Convención "24 módulos": landingModuleKeys().length (24) = rutas de
 * ModuleNav (28) menos las 4 con presentación propia: / (Invertir),
 * /estudiar, /crear e /inicio (la propia portada). Gestionar es familia,
 * no ruta: sus módulos (crm, facturas, correos…) están dentro de los 24.
 * La cifra se deriva de MODULES, nunca a mano; los 3 módulos solo-admin
 * van marcados con "(solo admin)". */

// M8 (2026-11-13): constantes con nombre en vez de regex sobre el texto
// del badge o literales sueltos. TRIAL_DAYS es la duración de la prueba
// gratis (misma que p.trialBadge, "14 días gratis"); LANG_COUNT es el
// número de idiomas (tipo Lang en lib/i18n/types.ts: es + en).
const TRIAL_DAYS = 14;
const LANG_COUNT = 2;

const CTA_CLASS =
  "inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60";

function StartFreeCta({ label }: { label: string }) {
  return (
    <Link href="/login?mode=register" className={CTA_CLASS}>
      {label}
    </Link>
  );
}

export function Landing() {
  const { t } = useLanguage();
  const l = t.landing;
  const p = t.planes;
  const c = t.clases;
  // M2: CTA sticky discreto solo en móvil, visible cuando el héroe ya
  // quedó arriba (el visitante que baja hasta la tabla no tiene que
  // subir a buscar un CTA).
  const heroRef = useRef<HTMLElement | null>(null);
  const [showStickyCta, setShowStickyCta] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const bottom = heroRef.current?.getBoundingClientRect().bottom ?? 0;
      setShowStickyCta(bottom < 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const pillars = [
    { id: "pilar-invertir", title: l.modInvertirTitle, desc: l.modInvertirDesc },
    { id: "pilar-estudiar", title: l.modEstudiarTitle, desc: l.modEstudiarDesc },
    { id: "pilar-crear", title: l.modCrearTitle, desc: l.modCrearDesc },
    { id: "pilar-gestionar", title: l.modGestionarTitle, desc: l.modGestionarDesc },
  ];
  // Resto de módulos reales (ModuleNav / t.nav), fuera de los 4 pilares
  // (Invertir, Estudiar, Crear ya son tarjetas) y de Inicio (la propia
  // portada). Se deriva de MODULES (M8): si el menú cambia, la lista y
  // el "24 módulos" cambian solos. Solo nombres: la lista completa vive
  // en el menú al entrar.
  const moreModules = landingModuleKeys();
  const steps = [
    { n: "1", title: l.howStep1Title, desc: l.howStep1Desc },
    { n: "2", title: l.howStep2Title, desc: l.howStep2Desc },
    { n: "3", title: l.howStep3Title, desc: l.howStep3Desc },
  ];
  // Franja compacta: precios y prueba gratis, todo de t.planes (una sola
  // fuente; ningún precio escrito a mano aquí).
  const stripPlans = [
    { name: p.nameEsencial, price: p.priceEsencial },
    { name: p.nameCrecimiento, price: p.priceCrecimiento },
    { name: p.nameTotal, price: p.priceTotal },
  ];
  // Franja de confianza: cifras derivadas del código, nunca a mano.
  // Los días de prueba y los idiomas son constantes con nombre (M8).
  const trustItems = [
    { value: String(moreModules.length), label: l.trustModules },
    { value: String(pillars.length), label: l.trustPillars },
    { value: String(stripPlans.length), label: l.trustPlans },
    { value: String(TRIAL_DAYS), label: l.trustTrial },
    { value: String(LANG_COUNT), label: l.trustLangs },
  ];
  // Segmentación por etapa: cada etapa enlaza a su tarjeta de plan.
  const stages = [
    { stage: l.stageStartTitle, name: p.nameEsencial, tag: p.tagEsencial, href: "#plan-esencial" },
    { stage: l.stageGrowTitle, name: p.nameCrecimiento, tag: p.tagCrecimiento, href: "#plan-crecimiento" },
    { stage: l.stageScaleTitle, name: p.nameTotal, tag: p.tagTotal, href: "#plan-total" },
  ];
  // Mini-índice de las 5 herramientas de Clases (mini-panel Estudiar).
  const classTools = [
    { name: c.calcTitle, desc: l.pillarEstudiarTool1Desc },
    { name: c.convTitle, desc: l.pillarEstudiarTool2Desc },
    { name: c.chartTitle, desc: l.pillarEstudiarTool3Desc },
    { name: c.indTitle, desc: l.pillarEstudiarTool4Desc },
    { name: c.btcTitle, desc: l.pillarEstudiarTool5Desc },
  ];

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <PublicNav />
      <main id="contenido" tabIndex={-1} className="mx-auto max-w-6xl px-4 outline-none sm:px-6">
        <SkipLink label={t.shell.skipLink} />
        {/* Héroe: texto a la izquierda, calculadora a la derecha en
            escritorio; apilado en móvil. La calculadora es 100 %
            navegador (sin red, sin auth) y reutiliza t.clases.calc*. */}
        <section ref={heroRef} className="py-12 sm:py-16">
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
                {l.eyebrow}
              </p>
              <h1 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
                {l.title}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
                {l.subtitle}
              </p>
              {/* M2: jerarquía de un solo primario — Registrarse primero
                  (el visitante sin cuenta), Entrar como secundario y Ver
                  planes como enlace terciario. */}
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/login?mode=register" className={CTA_CLASS}>
                  {l.ctaRegister}
                </Link>
                <Link
                  href="/login"
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-zinc-700 px-5 py-3 text-sm font-bold text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                >
                  {l.ctaLogin}
                </Link>
                <a
                  href="#planes"
                  className="inline-flex min-h-[44px] items-center rounded-lg px-3 py-3 text-sm font-semibold text-blue-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                >
                  {l.ctaPlans}
                </a>
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h2 className="text-lg font-bold text-zinc-50">{c.calcTitle}</h2>
              <div className="mt-3">
                <CompoundCalculator idPrefix="hero-calc" />
              </div>
            </div>
          </div>
        </section>

        {/* Franja de confianza: 5 cifras reales, derivadas del código. */}
        <section id="confianza" aria-label={l.trustTitle} className="scroll-mt-20 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-5 sm:px-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {trustItems.map((item) => (
              <div key={item.label} className="text-center">
                <p className="text-3xl font-extrabold tabular-nums text-zinc-50">{item.value}</p>
                <p className="mt-1 text-sm text-zinc-400">{item.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Franja compacta de precios: los 3 precios + 14 días gratis,
            visibles sin bajar ni pulsar. El detalle con beneficios está
            en la sección de planes, justo después de los módulos. */}
        <section aria-label={p.title} className="mt-6 rounded-xl border border-blue-800/60 bg-blue-500/10 px-4 py-5 sm:px-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {stripPlans.map((plan) => (
              <div key={plan.name} className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 sm:flex-col sm:items-start">
                <span className="text-sm font-semibold text-zinc-200">{plan.name}</span>
                <span className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold text-zinc-50">{plan.price}</span>
                  <span className="text-sm text-zinc-400">{p.perMonth}</span>
                </span>
                <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-bold text-white">
                  {p.trialBadge}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center sm:text-left">
            <a
              href="#planes"
              className="inline-flex min-h-[44px] items-center rounded-lg px-2 py-2.5 text-sm font-semibold text-blue-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            >
              {l.priceStripCta}
            </a>
          </p>
        </section>

        {/* Módulos: 4 bloques verticales (uno por pilar) con mini-panel
            honesto y CTA propio; después, la lista de 24 módulos. Los
            mini-paneles son estáticos (sin fetch, sin token, sin datos
            falsos); el contenido de ejemplo va etiquetado "Ejemplo". */}
        <section aria-label={l.modulesTitle} className="border-t border-zinc-800 py-10 sm:py-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{l.modulesTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            {l.modulesIntro}
          </p>
          <div className="mt-6 space-y-6">
            {pillars.map((pillar, i) => (
              <article key={pillar.id} id={pillar.id} aria-label={pillar.title} className="scroll-mt-20 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
                <h3 className="text-lg font-bold text-zinc-50">{pillar.title}</h3>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">{pillar.desc}</p>
                {/* Mini-panel Invertir: evaluador de estrategia (estático). */}
                {i === 0 && (
                  <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
                    <p className="text-sm font-semibold text-zinc-100">{l.pillarInvertirPanelTitle}</p>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-400">{l.pillarInvertirPanelBody}</p>
                    <p className="mt-2 text-sm font-medium text-amber-400">{l.pillarInvertirSimNote}</p>
                  </div>
                )}
                {/* Mini-panel Estudiar: índice de las 5 herramientas de Clases. */}
                {i === 1 && (
                  <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
                    <p className="text-sm font-semibold text-zinc-100">{l.pillarEstudiarPanelTitle}</p>
                    <ul className="mt-2 space-y-2">
                      {classTools.map((tool) => (
                        <li key={tool.name} className="text-sm leading-relaxed text-zinc-400">
                          <span className="font-semibold text-zinc-200">{tool.name}</span>
                          {" — "}
                          {tool.desc}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-sm font-medium text-amber-400">{l.pillarEstudiarAuthNote}</p>
                  </div>
                )}
                {/* Mini-panel Crear: muestra del generador de logo (SVG en
                    navegador, sin backend), etiquetada como ejemplo. */}
                {i === 2 && (
                  <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-zinc-100">{l.pillarCrearPanelTitle}</p>
                      <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-bold text-zinc-200">
                        {l.exampleLabel}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <svg viewBox="0 0 96 96" className="h-24 w-24 shrink-0 rounded-xl" role="img" aria-label={l.pillarCrearPanelTitle}>
                        <rect width="96" height="96" rx="16" fill="#2563eb" />
                        <path d="M48 22 L74 70 L22 70 Z" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinejoin="round" />
                        <circle cx="48" cy="58" r="7" fill="#ffffff" />
                      </svg>
                      <p className="max-w-sm text-sm leading-relaxed text-zinc-400">{l.pillarCrearPanelBody}</p>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-400">{l.pillarCrearNote}</p>
                  </div>
                )}
                {/* Mini-panel Gestionar: contacto + plantilla de ejemplo. */}
                {i === 3 && (
                  <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-zinc-100">{l.pillarGestionarPanelTitle}</p>
                      <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-bold text-zinc-200">
                        {l.exampleLabel}
                      </span>
                    </div>
                    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                      <p className="text-sm font-semibold text-zinc-100">{l.pillarGestionarContactName}</p>
                      <p className="mt-0.5 text-sm text-zinc-400">{l.pillarGestionarContactEmail}</p>
                      <p className="text-sm text-zinc-400">{l.pillarGestionarContactPhone}</p>
                    </div>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                      {l.pillarGestionarTemplateLabel}
                    </p>
                    <p className="mt-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm leading-relaxed text-zinc-200">
                      {l.pillarGestionarTemplate}
                    </p>
                  </div>
                )}
                <div className="mt-4">
                  <StartFreeCta label={l.ctaStartFree} />
                </div>
              </article>
            ))}
          </div>
          <h3 className="mt-8 text-lg font-bold text-zinc-50">{l.moreModulesTitle}</h3>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">{l.moreModulesIntro}</p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {moreModules.map(({ key, adminOnly }) => (
              <li
                key={key}
                className="rounded-full border border-zinc-700 bg-zinc-900/60 px-3.5 py-2 text-sm font-medium text-zinc-200"
              >
                {t.nav[key].label}
                {adminOnly && <span className="text-zinc-400"> ({l.adminOnlyTag})</span>}
              </li>
            ))}
          </ul>
        </section>

        {/* Sección IA y Automatización (13 herramientas reales). */}
        <LandingAi />

        {/* Para cada etapa: Empieza / Crece / Escala → su plan. */}
        <section id="etapas" aria-label={l.stageTitle} className="scroll-mt-20 border-t border-zinc-800 py-10 sm:py-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{l.stageTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            {l.stageIntro}
          </p>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {stages.map((s) => (
              <article key={s.stage} className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                <h3 className="text-lg font-bold text-zinc-50">{s.stage}</h3>
                <p className="mt-2 text-base font-semibold text-zinc-100">{s.name}</p>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-zinc-400">{s.tag}</p>
                <a
                  href={s.href}
                  className="mt-4 inline-flex min-h-[44px] items-center rounded-lg px-3 py-3 text-sm font-semibold text-blue-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                >
                  {l.stageCta}: {s.name}
                </a>
              </article>
            ))}
          </div>
        </section>

        {/* Planes reales (una sola fuente: PlanesPanel / t.planes) */}
        <section id="planes" aria-label={l.plansTitle} className="scroll-mt-20 border-t border-zinc-800 py-10 sm:py-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{l.plansTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            {l.plansIntro}
          </p>
          <div className="mt-6">
            <PlanesPanel />
          </div>
          <PlanesCompare />
          <div className="mt-6">
            <StartFreeCta label={l.ctaStartFree} />
          </div>
          <p className="mt-6 text-sm leading-relaxed text-zinc-400">{l.simNote}</p>
        </section>

        {/* Cómo empezar */}
        <section aria-label={l.howTitle} className="border-t border-zinc-800 py-10 sm:py-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{l.howTitle}</h2>
          <ol className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {steps.map((s) => (
              <li key={s.n} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-base font-extrabold text-white">
                  {s.n}
                </span>
                <h3 className="mt-4 text-lg font-bold text-zinc-50">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.desc}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Cierre final: CTA + microcopy de activación por admin. */}
        <section aria-label={l.finalTitle} className="border-t border-zinc-800 py-10 text-center sm:py-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{l.finalTitle}</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            {l.finalDesc}
          </p>
          <div className="mt-6 flex justify-center">
            <StartFreeCta label={l.ctaStartFree} />
          </div>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-zinc-400">{l.howStep2Desc}</p>
        </section>
      </main>
      {/* M2: CTA sticky discreto solo en móvil, tras pasar el héroe. */}
      {showStickyCta && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur sm:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
            <p className="min-w-0 text-xs leading-snug text-zinc-400">
              {p.trialBadge} · {p.nameEsencial} {p.priceEsencial}
              {p.perMonth}
            </p>
            <Link href="/login?mode=register" className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60">
              {l.ctaStartFree}
            </Link>
          </div>
        </div>
      )}
      <Footer />
    </div>
  );
}
