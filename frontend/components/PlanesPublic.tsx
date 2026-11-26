"use client";

import { useLanguage } from "../lib/i18n";
import { PublicNav } from "./PublicNav";
import { Footer } from "./Footer";
import { SkipLink } from "./ui";
import { PlanesPanel } from "./PlanesPanel";
import { PlanesCompare } from "./PlanesCompare";

/** Página pública de precios (Fase 4 mejoras-v1, tarea 2): /planes ya
 * no pasa por ModuleShell (que redirige a /login sin token) sino por
 * este shell público — PublicNav + contenido + Footer, igual que la
 * landing. Sin llamadas autenticadas: PlanesPanel y PlanesCompare solo
 * leen t.planes (una sola fuente: Esencial $19, Crecimiento $49,
 * Negocio Total $99, 14 días gratis). Cada tarjeta enlaza a registro
 * con el plan elegido (/login?mode=register&plan=<clave>). Importación
 * directa (sin lazy): aquí los planes SON el contenido, no están bajo
 * el pliegue como en la landing. */
export function PlanesPublic() {
  const { t } = useLanguage();
  const p = t.planes;
  return (
    <div className="min-h-dvh bg-[#030712] text-slate-100">
      <PublicNav />
      <main id="contenido" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 outline-none sm:px-6 sm:py-10">
        <SkipLink label={t.shell.skipLink} />
        <header className="mb-6 sm:mb-8">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
            {t.header.brand}
          </p>
          <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{p.title}</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
            {p.subtitle}
          </p>
        </header>
        <PlanesPanel />
        <PlanesCompare />
      </main>
      <Footer />
    </div>
  );
}
