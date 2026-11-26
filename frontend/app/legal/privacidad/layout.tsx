import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de privacidad — Grow Business Platform",
  description:
    "Política de privacidad (borrador) de Grow Business Platform: qué datos se recogen, para qué se usan, y cómo exportarlos o borrarlos.",
  alternates: { canonical: "https://crypto-investor-web.onrender.com/legal/privacidad" },
  openGraph: {
    title: "Política de privacidad — Grow Business Platform",
    description:
      "Borrador de la política de privacidad de Grow Business Platform: tus datos, tus derechos.",
    url: "https://crypto-investor-web.onrender.com/legal/privacidad",
    locale: "es_MX",
    type: "website",
  },
};

export default function PrivacidadLegalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
