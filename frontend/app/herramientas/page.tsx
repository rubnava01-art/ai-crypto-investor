import type { Metadata } from "next";
import { PublicNav } from "../../components/PublicNav";
import { HerramientasSection } from "../../components/HerramientasSection";
import { Footer } from "../../components/Footer";

/** Página pública /herramientas (TBT-Herramientas, FASE 2, C-1, 2026-11-24).
 * SIN ModuleShell: esa envoltura redirige a /login sin token y mataría la
 * página para visitantes y buscadores. Como la landing y /contacto:
 * PublicNav + Footer, contenido SSR (el componente es de cliente solo
 * por el filtro y el buscador, pero la lista de herramientas se
 * renderiza en el servidor). El título es h1 (SEO); en la landing el
 * mismo componente usa h2. En móvil, el cierre y el footer quedan
 * por encima del CTA sticky de la landing: esta página no monta ese
 * sticky (vive en <Landing />), y el FAB del Asistente queda en
 * bottom-20 en móvil, sin tapar el contenido. */

export async function generateMetadata(): Promise<Metadata> {
  // generateMetadata corre en el servidor: el idioma se resuelve en el
  // cliente, así que el título/descripción usan el español por defecto
  // (mismo criterio que el resto de páginas públicas, sin metadata i18n).
  const { dictEs } = await import("../../lib/i18n/es");
  const h = dictEs.herramientas;
  return {
    title: h.pageMetaTitle,
    description: h.pageMetaDesc,
  };
}

export default function HerramientasPage() {
  return (
    <div className="min-h-dvh bg-[#030712] text-slate-100">
      <PublicNav />
      <main id="contenido" tabIndex={-1} className="mx-auto max-w-6xl px-4 pb-4 outline-none sm:px-6">
        <HerramientasSection headingLevel="h1" />
      </main>
      <Footer />
    </div>
  );
}
