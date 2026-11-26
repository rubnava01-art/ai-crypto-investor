import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de cookies — Grow Business Platform",
  description:
    "Política de cookies (borrador) de Grow Business Platform: qué guarda la plataforma en tu navegador y qué no usa.",
  alternates: { canonical: "https://crypto-investor-web.onrender.com/legal/cookies" },
  openGraph: {
    title: "Política de cookies — Grow Business Platform",
    description:
      "Borrador de la política de cookies de Grow Business Platform: sesión e idioma en almacenamiento local, sin terceros.",
    url: "https://crypto-investor-web.onrender.com/legal/cookies",
    locale: "es_MX",
    type: "website",
  },
};

export default function CookiesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
