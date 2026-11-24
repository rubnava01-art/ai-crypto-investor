import type { Metadata } from "next";

// Metas propias de /login (Fase 4, 2026-11-23): la página es "use
// client", así que el metadata vive en este layout de servidor.
export const metadata: Metadata = {
  title: "Entrar o crear cuenta — Grow Business Platform",
  description:
    "Entra a Grow Business Platform o crea tu cuenta gratis: simulador de inversión cripto, calculadora de interés compuesto y academia para aprender trading sin riesgo.",
  alternates: { canonical: "https://crypto-investor-web.onrender.com/login" },
  openGraph: {
    title: "Entrar o crear cuenta — Grow Business Platform",
    description:
      "Crea tu cuenta gratis y entra a practicar inversión en simulación, estudiar y gestionar tu negocio.",
    url: "https://crypto-investor-web.onrender.com/login",
    locale: "es_MX",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Grow Business Platform — Simulación, sin dinero real" }],
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
