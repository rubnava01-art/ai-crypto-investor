"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../lib/i18n";
import { PublicNav } from "./PublicNav";
import { CompoundCalculator } from "./CompoundCalculator";
import { landingModuleKeys, landingModulesByCategory, CATEGORY_TITLE_KEY } from "./ModuleNav";
import { SkipLink } from "./ui";
import { Footer } from "./Footer";
import { Hero } from "./Hero";
import { GuestTrialButton } from "./GuestTrial";
import { TrustStrip } from "./TrustStrip";
import { Skeleton } from "./Skeleton";

// M3 (2026-11-13): lo que está bajo el pliegue (sección IA, tabla
// comparativa y, desde F-4 2026-11-14, la sección de planes) no viaja
// en el bundle inicial: se carga al renderizar, con un estado de carga
// visible. El héroe y la franja de precios se quedan en el bundle inicial.
// Rediseño fintech 2026-11-14 (Agente 2): el héroe lo compone <Hero />
// (Agente UX/UI) con la calculadora existente como children; la franja
// de confianza la compone <TrustStrip /> con SOLO números reales
// derivados del código (25 módulos, 4 pilares, 3 planes, 14 días
// gratis, 2 idiomas). Fallbacks de carga con <Skeleton />.
const sectionLoading = () => <SectionLoadingSkeleton />;
function SectionLoadingSkeleton() {
  const { t } = useLanguage();
  return (
    <div role="status">
      <span className="sr-only">{t.common.loading}</span>
      <Skeleton className="h-44 w-full rounded-xl" ariaLabel={t.misc.loadingAria} />
    </div>
  );
}
const LandingAi = dynamic(() => import("./LandingAi").then((m) => m.LandingAi), {
  ssr: false,
  loading: sectionLoading,
});
const PlanesCompare = dynamic(() => import("./PlanesCompare").then((m) => m.PlanesCompare), {
  ssr: false,
  loading: sectionLoading,
});
// F-4 (2026-11-14, Agente 2): PlanesPanel también lazy (está bajo el
// pliegue, como LandingAi/PlanesCompare). El registro con plan elegido
// no vive en este componente: cada tarjeta enlaza a
// /login?mode=register&plan=<clave> y /login lee `plan` de la URL y lo
// envía como requested_plan; hacer lazy el panel no toca ese flujo.
const PlanesPanel = dynamic(() => import("./PlanesPanel").then((m) => m.PlanesPanel), {
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
 * Sin emojis; fondo casi negro (#030712–#0B0F19), glassmorphism, azul
 * fuerte y emerald, como la casa.
 *
 * Orden de secciones: héroe (con calculadora) → franja de confianza →
 * franja de precios → 4 pilares → sección IA → etapas → planes + tabla
 * comparativa → cómo empezar → cierre final con CTA → footer.
 * Convención "25 módulos": landingModuleKeys().length (25) = rutas de
 * ModuleNav (29) menos las 4 con presentación propia: / (Invertir),
 * /estudiar, /crear e /inicio (la propia portada). Gestionar es familia,
 * no ruta: sus módulos (crm, facturas, correos…) están dentro de los 25.
 * La cifra se deriva de MODULES, nunca a mano; los 3 módulos solo-admin
 * van marcados con "(solo admin)". */

const CTA_CLASS =
  "inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition-all duration-200 hover:bg-blue-700 hover:shadow-blue-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 motion-safe:active:scale-[0.98] sm:w-auto";

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
  // el "25 módulos" cambian solos. Solo nombres: la lista completa vive
  // en el menú al entrar.
  const moreModules = landingModuleKeys();
  // Módulos extra agrupados por categoría (Fase 4): las 4 categorías +
  // Sistema aparte, sin cambiar rutas ni claves.
  const moreModulesByCategory = landingModulesByCategory();
  const categoryTitle = (cat: string) => l[CATEGORY_TITLE_KEY[cat]] ?? cat;
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
  // Segmentación por etapa: cada etapa enlaza a su tarjeta de plan.
  const stages = [
    { stage: l.stageStartTitle, name: p.nameEsencial, tag: p.tagEsencial, href: "#plan-esencial" },
    { stage: l.stageGrowTitle, name: p.nameCrecimiento, tag: p.tagCrecimiento, href: "#plan-crecimiento" },
    { stage: l.stageScaleTitle, name: p.nameTotal, tag: p.tagTotal, href: "#plan-total" },
  ];
  // Seguridad y Transparencia (Fase 2, 2026-11-23): solo hechos reales
  // sobre la plataforma — qué se guarda, cómo se protege la cuenta,
  // quién está detrás, para qué sirve y el aviso de simulación. Nada
  // inventado: sin equipo, fotos, sellos ni certificaciones.
  const securityItems = [
    { title: l.securityDataTitle, body: l.securityDataBody },
    { title: l.securityAccountTitle, body: l.securityAccountBody },
    { title: l.securityWhoTitle, body: l.securityWhoBody },
    { title: l.securityPurposeTitle, body: l.securityPurposeBody },
    { title: l.securitySimTitle, body: l.securitySimBody },
  ];
  // FAQ (Fase 4, 2026-11-23): respuestas directas y breves.
  const faqItems = [
    { q: l.faqQ1, a: l.faqA1 },
    { q: l.faqQ2, a: l.faqA2 },
    { q: l.faqQ3, a: l.faqA3 },
    { q: l.faqQ4, a: l.faqA4 },
  ];
  // Aviso de prueba caducada (?guest=expired, tras 15 min de invitado):
  // se lee de la URL en el cliente, sin useSearchParams (sin Suspense).
  const [guestExpired, setGuestExpired] = useState(false);
  useEffect(() => {
    try {
      setGuestExpired(new URLSearchParams(window.location.search).get("guest") === "expired");
    } catch {
      setGuestExpired(false);
    }
  }, []);
  // Mini-índice de las 5 herramientas de Clases (mini-panel Estudiar).
  const classTools = [
    { name: c.calcTitle, desc: l.pillarEstudiarTool1Desc },
    { name: c.convTitle, desc: l.pillarEstudiarTool2Desc },
    { name: c.chartTitle, desc: l.pillarEstudiarTool3Desc },
    { name: c.indTitle, desc: l.pillarEstudiarTool4Desc },
    { name: c.btcTitle, desc: l.pillarEstudiarTool5Desc },
  ];
  // Franja de confianza: SOLO números reales derivados del código.
  // 25 = módulos reales del menú; pilares y planes se derivan de sus
  // listas (si cambia una lista, la franja cambia sola); 14 días de
  // prueba gratis; 2 idiomas (ES/EN). Nada de usuarios, volumen ni
  // testimonios: no existen datos verificados para eso.
  const trustItems = [
    { value: String(moreModules.length), label: l.trustModulesLabel },
    { value: String(pillars.length), label: l.trustPillarsLabel },
    { value: String(stripPlans.length), label: l.trustPlansLabel },
    { value: "14", label: l.trustTrialLabel },
    { value: "2", label: l.trustLanguagesLabel },
  ];

  return (
    <div className="min-h-dvh bg-[#030712] text-slate-100">
      <PublicNav />
      <main id="contenido" tabIndex={-1} className="mx-auto max-w-6xl px-4 outline-none sm:px-6">
        <SkipLink label={t.shell.skipLink} />
        {/* Héroe: lo compone <Hero /> (Agente UX/UI) con doble CTA —
            primario sólido a registro, secundario "Probar sin registro"
            (Fase 1: reto matemático → sesión de invitado 15 min) — y la
            calculadora de interés compuesto existente como children. */}
        <section ref={heroRef}>
          {guestExpired && (
            <div role="status" className="mb-4 rounded-xl border border-amber-700/60 bg-amber-500/10 px-4 py-3.5 text-sm leading-relaxed text-amber-300">
              {t.guest.expired}{" "}
              <Link href="/login?mode=register" className="font-semibold text-amber-200 underline">
                {t.guest.bannerCta}
              </Link>
            </div>
          )}
          <Hero
            eyebrow={l.eyebrow}
            simBadge={l.heroSimBadge}
            simNote={l.simNote}
            title={l.title}
            subtitle={l.subtitle}
            primaryLabel={l.ctaStartFree}
            primaryHref="/login?mode=register"
            secondaryButton={<GuestTrialButton />}
          >
            <h2 className="text-lg font-bold text-slate-50">{c.calcTitle}</h2>
            <div className="mt-3">
              <CompoundCalculator idPrefix="hero-calc" compact />
            </div>
          </Hero>
        </section>

        {/* C5 (2026-11-14): atajo visible desde el héroe hacia los planes.
            <Hero /> (Agente UX/UI) no admite un tercer CTA, así que el
            atajo vive aquí, justo debajo de él: prueba gratis prominente
            + enlace al ancla #planes. Todo de t.planes / t.landing, sin
            cifras ni copy nuevos. */}
        <p className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center">
          <span className="rounded-full bg-emerald-500/15 px-3.5 py-1.5 text-sm font-bold text-emerald-300">
            {p.trialBadge}
          </span>
          <a
            href="#planes"
            className="inline-flex min-h-[44px] items-center rounded-lg px-3 py-2 text-base font-bold text-blue-300 transition-colors hover:text-blue-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
          >
            {l.priceStripCta}
          </a>
        </p>

        {/* Franja de confianza: solo números reales verificables. */}
        <TrustStrip items={trustItems} ariaLabel={l.trustStripAria} />

        {/* Franja compacta de precios: los 3 precios + 14 días gratis,
            visibles sin bajar ni pulsar. El detalle con beneficios está
            en la sección de planes, justo después de los módulos.
            C5 (2026-11-14): precios mucho más grandes (el precio manda)
            y píldora de prueba gratis más prominente. */}
        <section aria-label={p.title} className="mt-6 rounded-xl border border-blue-500/30 bg-blue-500/[0.07] px-4 py-6 backdrop-blur sm:px-6 sm:py-7">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-6">
            {stripPlans.map((plan) => (
              <div key={plan.name} className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 sm:flex-col sm:items-start sm:gap-y-2">
                <span className="text-sm font-semibold text-slate-200">{plan.name}</span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-extrabold tabular-nums tracking-tight text-slate-50 sm:text-5xl">{plan.price}</span>
                  <span className="text-base text-slate-400">{p.perMonth}</span>
                </span>
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-bold text-emerald-300">
                  {p.trialBadge}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-5 text-center sm:text-left">
            <a
              href="#planes"
              className="inline-flex min-h-[44px] items-center rounded-lg px-2 py-2.5 text-base font-bold text-blue-300 transition-colors hover:text-blue-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            >
              {l.priceStripCta}
            </a>
          </p>
        </section>

        {/* Módulos: 4 bloques verticales (uno por pilar) con mini-panel
            honesto y CTA propio; después, la lista de 25 módulos. Los
            mini-paneles son estáticos (sin fetch, sin token, sin datos
            falsos); el contenido de ejemplo va etiquetado "Ejemplo". */}
        <section aria-label={l.modulesTitle} className="border-t border-slate-800/80 py-10 sm:py-12">
          <h2 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">{l.modulesTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
            {l.modulesIntro}
          </p>
          <div className="mt-6 space-y-6">
            {pillars.map((pillar, i) => (
              <article key={pillar.id} id={pillar.id} aria-label={pillar.title} className="scroll-mt-20 rounded-xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur transition-colors duration-200 hover:border-emerald-500/30 sm:p-6">
                <h3 className="text-lg font-bold text-slate-50">{pillar.title}</h3>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{pillar.desc}</p>
                {/* Mini-panel Invertir: evaluador de estrategia (estático). */}
                {i === 0 && (
                  <div className="mt-4 rounded-lg border border-white/10 bg-[#0B0F19]/70 p-4">
                    <p className="text-sm font-semibold text-slate-100">{l.pillarInvertirPanelTitle}</p>
                    <p className="mt-1 text-sm leading-relaxed text-slate-400">{l.pillarInvertirPanelBody}</p>
                    <p className="mt-2 text-sm font-medium text-amber-400">{l.pillarInvertirSimNote}</p>
                  </div>
                )}
                {/* Mini-panel Estudiar: índice de las 5 herramientas de Clases. */}
                {i === 1 && (
                  <div className="mt-4 rounded-lg border border-white/10 bg-[#0B0F19]/70 p-4">
                    <p className="text-sm font-semibold text-slate-100">{l.pillarEstudiarPanelTitle}</p>
                    <ul className="mt-2 space-y-2">
                      {classTools.map((tool) => (
                        <li key={tool.name} className="text-sm leading-relaxed text-slate-400">
                          <span className="font-semibold text-slate-200">{tool.name}</span>
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
                  <div className="mt-4 rounded-lg border border-white/10 bg-[#0B0F19]/70 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-100">{l.pillarCrearPanelTitle}</p>
                      <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-bold text-slate-200">
                        {l.exampleLabel}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <svg viewBox="0 0 96 96" className="h-24 w-24 shrink-0 rounded-xl" role="img" aria-label={l.pillarCrearPanelTitle}>
                        <rect width="96" height="96" rx="16" fill="#2563eb" />
                        <path d="M48 22 L74 70 L22 70 Z" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinejoin="round" />
                        <circle cx="48" cy="58" r="7" fill="#ffffff" />
                      </svg>
                      <p className="max-w-sm text-sm leading-relaxed text-slate-400">{l.pillarCrearPanelBody}</p>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">{l.pillarCrearNote}</p>
                  </div>
                )}
                {/* Mini-panel Gestionar: contacto + plantilla de ejemplo. */}
                {i === 3 && (
                  <div className="mt-4 rounded-lg border border-white/10 bg-[#0B0F19]/70 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-100">{l.pillarGestionarPanelTitle}</p>
                      <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-bold text-slate-200">
                        {l.exampleLabel}
                      </span>
                    </div>
                    <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-sm font-semibold text-slate-100">{l.pillarGestionarContactName}</p>
                      <p className="mt-0.5 text-sm text-slate-400">{l.pillarGestionarContactEmail}</p>
                      <p className="text-sm text-slate-400">{l.pillarGestionarContactPhone}</p>
                    </div>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {l.pillarGestionarTemplateLabel}
                    </p>
                    <p className="mt-1 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm leading-relaxed text-slate-200">
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
          <h3 className="mt-8 text-lg font-bold text-slate-50">{l.moreModulesTitle}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">{l.moreModulesIntro}</p>
          <div className="mt-4 space-y-5">
            {moreModulesByCategory.map((group) => (
              <div key={group.category}>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-300">
                  {categoryTitle(group.category)}
                </h4>
                <ul className="flex flex-wrap gap-2">
                  {group.items.map(({ key, adminOnly }) => (
                    <li
                      key={key}
                      className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm font-medium text-slate-200 transition-colors duration-200 hover:border-emerald-500/40 hover:text-white"
                    >
                      {t.nav[key].label}
                      {adminOnly && <span className="text-slate-400"> ({l.adminOnlyTag})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Seguridad y Transparencia: solo hechos reales (Fase 2). */}
        <section aria-label={l.securityTitle} className="border-t border-slate-800/80 py-10 sm:py-12">
          <h2 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">{l.securityTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
            {l.securityIntro}
          </p>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {securityItems.map((item) => (
              <article key={item.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
                <h3 className="text-base font-bold text-slate-50">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Sección IA y Automatización (13 herramientas reales). */}
        <LandingAi />

        {/* Para cada etapa: Empieza / Crece / Escala → su plan. */}
        <section id="etapas" aria-label={l.stageTitle} className="scroll-mt-20 border-t border-slate-800/80 py-10 sm:py-12">
          <h2 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">{l.stageTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
            {l.stageIntro}
          </p>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {stages.map((s) => (
              <article key={s.stage} className="flex flex-col rounded-xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur transition-colors duration-200 hover:border-emerald-500/30">
                <h3 className="text-lg font-bold text-slate-50">{s.stage}</h3>
                <p className="mt-2 text-base font-semibold text-slate-100">{s.name}</p>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-slate-400">{s.tag}</p>
                <a
                  href={s.href}
                  className="mt-4 inline-flex min-h-[44px] items-center rounded-lg px-3 py-3 text-sm font-semibold text-blue-400 transition-colors hover:text-blue-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                >
                  {l.stageCta}: {s.name}
                </a>
              </article>
            ))}
          </div>
        </section>

        {/* Planes reales (una sola fuente: PlanesPanel / t.planes).
            C5 (2026-11-14): sección más grande y jerárquica — título
            mayor, más aire, y la prueba gratis como píldora prominente
            junto al título (todo de t.planes, sin cifras nuevas). */}
        <section id="planes" aria-label={l.plansTitle} className="scroll-mt-20 border-t border-slate-800/80 py-12 sm:py-16">
          <h2 className="text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl">{l.plansTitle}</h2>
          <p className="mt-3">
            <span className="inline-block rounded-full bg-emerald-500/15 px-3.5 py-1.5 text-sm font-bold text-emerald-300">
              {p.trialBadge}
            </span>
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
            {l.plansIntro}
          </p>
          <div className="mt-8">
            <PlanesPanel />
          </div>
          <PlanesCompare />
          <div className="mt-6">
            <StartFreeCta label={l.ctaStartFree} />
          </div>
          <p className="mt-6 text-sm leading-relaxed text-slate-400">{l.simNote}</p>
        </section>

        {/* Cómo empezar */}
        <section aria-label={l.howTitle} className="border-t border-slate-800/80 py-10 sm:py-12">
          <h2 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">{l.howTitle}</h2>
          <ol className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {steps.map((s) => (
              <li key={s.n} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur transition-colors duration-200 hover:border-emerald-500/30">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-base font-extrabold tabular-nums text-white shadow-lg shadow-blue-600/25">
                  {s.n}
                </span>
                <h3 className="mt-4 text-lg font-bold text-slate-50">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.desc}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Preguntas frecuentes: respuestas directas (Fase 4). */}
        <section aria-label={l.faqTitle} className="border-t border-slate-800/80 py-10 sm:py-12">
          <h2 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">{l.faqTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
            {l.faqIntro}
          </p>
          <dl className="mt-6 space-y-4">
            {faqItems.map((item) => (
              <div key={item.q} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
                <dt className="text-base font-bold text-slate-50">{item.q}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-slate-400">{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Cierre final: CTA + microcopy de activación por admin. */}
        <section aria-label={l.finalTitle} className="border-t border-slate-800/80 py-10 text-center sm:py-12">
          <h2 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">{l.finalTitle}</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
            {l.finalDesc}
          </p>
          <div className="mt-6 flex justify-center">
            <StartFreeCta label={l.ctaStartFree} />
          </div>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-slate-400">{l.howStep2Desc}</p>
        </section>
      </main>
      {/* M2: CTA sticky discreto solo en móvil, tras pasar el héroe. */}
      {showStickyCta && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800/80 bg-[#0B0F19]/95 backdrop-blur sm:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
            <p className="min-w-0 text-xs leading-snug text-slate-400">
              {p.trialBadge} · {p.nameEsencial} {p.priceEsencial}
              {p.perMonth}
            </p>
            <Link href="/login?mode=register" className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60">
              {l.ctaStartFree}
            </Link>
          </div>
        </div>
      )}
      <Footer />
    </div>
  );
}
