import type { Metadata } from "next";
import { PlanesPublic } from "../../components/PlanesPublic";

/** Módulo Planes (2026-11-06): sección de precios de suscripción de
 * Grow Business Platform — Esencial $19, Crecimiento $49, Negocio
 * Total $99 al mes, todos con 14 días de prueba gratis (precios
 * aprobados por Rubén). Solo muestra los planes; no hay cobro en
 * línea todavía.
 *
 * Fase 4 mejoras-v1, tarea 2: la página es PÚBLICA (componente de
 * servidor con metadata + <PlanesPublic />): ya no pasa por
 * ModuleShell, que redirige a /login sin sesión. El sitemap ya la
 * listaba como pública; ahora lo es de verdad. */
export const metadata: Metadata = {
  title: "Planes — Grow Business Platform",
  description:
    "Esencial $19, Crecimiento $49 y Negocio Total $99 al mes, todos con 14 días de prueba gratis.",
  alternates: { canonical: "https://crypto-investor-web.onrender.com/planes" },
  openGraph: {
    title: "Planes — Grow Business Platform",
    description:
      "Esencial $19, Crecimiento $49 y Negocio Total $99 al mes, todos con 14 días de prueba gratis.",
    url: "https://crypto-investor-web.onrender.com/planes",
    siteName: "Grow Business Platform",
    locale: "es_MX",
    type: "website",
  },
};

export default function PlanesPage() {
  return <PlanesPublic />;
}
