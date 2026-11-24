import type { Metadata } from "next";

// Metas propias de /contacto (Fase 4, 2026-11-23): la página es "use
// client", así que el metadata vive en este layout de servidor. Sin
// datos de contacto inventados: la página no publica email ni teléfono.
export const metadata: Metadata = {
  title: "Contacto — Grow Business Platform",
  description:
    "Cómo ponerte en contacto con Grow Business Platform: simulador de inversión cripto, calculadora de interés compuesto y gestión de negocio en un solo lugar.",
  alternates: { canonical: "https://crypto-investor-web.onrender.com/contacto" },
  openGraph: {
    title: "Contacto — Grow Business Platform",
    description:
      "Cómo ponerte en contacto con Grow Business Platform.",
    url: "https://crypto-investor-web.onrender.com/contacto",
    locale: "es_MX",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Grow Business Platform — Simulación, sin dinero real" }],
  },
};

export default function ContactoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
