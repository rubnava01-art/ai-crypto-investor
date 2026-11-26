import type { Metadata } from "next";

// Metas propias de /planes (Fase 4, 2026-11-23): la página es "use
// client", así que el metadata vive en este layout de servidor.
export const metadata: Metadata = {
  title: "Planes desde $19/mes — Grow Business Platform",
  description:
    "Planes de Grow Business Platform: Esencial $19, Crecimiento $49 y Negocio Total $99 al mes, con 14 días de prueba gratis. Simulador de inversión cripto, calculadora de interés compuesto y academia para aprender trading sin riesgo.",
  alternates: { canonical: "https://crypto-investor-web.onrender.com/planes" },
  openGraph: {
    title: "Planes — Grow Business Platform",
    description:
      "Esencial $19, Crecimiento $49 y Negocio Total $99 al mes, con 14 días de prueba gratis. Simulador de inversión cripto para aprender trading sin riesgo.",
    url: "https://crypto-investor-web.onrender.com/planes",
    locale: "es_MX",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Grow Business Platform — Simulación, sin dinero real" }],
  },
};

export default function PlanesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
