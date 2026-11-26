import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reembolsos y cancelación — Grow Business Platform",
  description:
    "Política de reembolsos y cancelación (borrador) de Grow Business Platform: planes $19/$49/$99 con 14 días gratis, sin cobro en línea todavía.",
  alternates: { canonical: "https://crypto-investor-web.onrender.com/legal/reembolsos" },
  openGraph: {
    title: "Reembolsos y cancelación — Grow Business Platform",
    description:
      "Borrador de la política de reembolsos y cancelación: sin cobro en línea todavía; la cancelación en un clic llegará con el cobro en línea.",
    url: "https://crypto-investor-web.onrender.com/legal/reembolsos",
    locale: "es_MX",
    type: "website",
  },
};

export default function ReembolsosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
