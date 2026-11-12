"use client";

import Link from "next/link";
import { useLanguage } from "../lib/i18n";
import type { NavKey } from "../lib/i18n";
import { PublicNav } from "./PublicNav";
import { PlanesPanel } from "./PlanesPanel";
import { Footer } from "./Footer";

/** Presentación pública de Grow Business Platform (2026-11-12): lo que
 * ve un visitante sin sesión en la raíz, en vez de acabar en /login.
 * Contenido estático: no lee el token ni dispara llamadas autenticadas.
 * Precios y beneficios a la vista, sin clic: franja compacta de precios
 * justo bajo el héroe + la sección completa de planes justo después de
 * los módulos. Los precios y beneficios vienen de t.planes a través de
 * <PlanesPanel /> (una sola fuente: Esencial $19, Crecimiento $49,
 * Negocio Total $99, 14 días gratis). Los módulos extra son los reales
 * del menú (t.nav, mismos nombres que ModuleNav): nada inventado.
 * Sin emojis; fondo casi negro y azul fuerte, como la casa. */
export function Landing() {
  const { t } = useLanguage();
  const l = t.landing;
  const p = t.planes;
  const modules = [
    { title: l.modInvertirTitle, desc: l.modInvertirDesc },
    { title: l.modEstudiarTitle, desc: l.modEstudiarDesc },
    { title: l.modCrearTitle, desc: l.modCrearDesc },
    { title: l.modGestionarTitle, desc: l.modGestionarDesc },
  ];
  // Resto de módulos reales (ModuleNav / t.nav), fuera de los 4 pilares
  // (Invertir, Estudiar, Crear ya son tarjetas) y de Inicio (la propia
  // portada). Solo nombres: la lista completa vive en el menú al entrar.
  const moreModules: NavKey[] = [
    "analizador", "crm", "referidos", "business", "espacio", "facturas",
    "correos", "chat", "recomendaciones", "desarrollo", "talento",
    "riesgos", "planillas", "analisis", "tendencias", "auditor",
    "privacidad", "inventario", "perfil", "usuarios", "ajustador",
    "terminal", "flujos", "planes",
  ];
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

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <PublicNav />
      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Héroe */}
        <section className="py-12 sm:py-16">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-400">
            {l.eyebrow}
          </p>
          <h1 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {l.title}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
            {l.subtitle}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            >
              {l.ctaLogin}
            </Link>
            <Link
              href="/login?mode=register"
              className="inline-flex min-h-[44px] items-center rounded-lg border border-zinc-700 px-5 py-3 text-sm font-bold text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            >
              {l.ctaRegister}
            </Link>
            <a
              href="#planes"
              className="inline-flex min-h-[44px] items-center rounded-lg px-3 py-3 text-sm font-semibold text-blue-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            >
              {l.ctaPlans}
            </a>
          </div>
        </section>

        {/* Franja compacta de precios: los 3 precios + 14 días gratis,
            visibles sin bajar ni pulsar. El detalle con beneficios está
            en la sección de planes, justo después de los módulos. */}
        <section aria-label={p.title} className="rounded-xl border border-blue-800/60 bg-blue-500/10 px-4 py-5 sm:px-6">
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

        {/* Módulos: 4 pilares + el resto de módulos reales */}
        <section aria-label={l.modulesTitle} className="border-t border-zinc-800 py-10 sm:py-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{l.modulesTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            {l.modulesIntro}
          </p>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {modules.map((m) => (
              <article key={m.title} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                <h3 className="text-lg font-bold text-zinc-50">{m.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{m.desc}</p>
              </article>
            ))}
          </div>
          <h3 className="mt-8 text-lg font-bold text-zinc-50">{l.moreModulesTitle}</h3>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">{l.moreModulesIntro}</p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {moreModules.map((key) => (
              <li
                key={key}
                className="rounded-full border border-zinc-700 bg-zinc-900/60 px-3.5 py-2 text-sm font-medium text-zinc-200"
              >
                {t.nav[key].label}
              </li>
            ))}
          </ul>
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
      </main>
      <Footer />
    </div>
  );
}
