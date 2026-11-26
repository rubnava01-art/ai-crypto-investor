import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Términos y condiciones — Grow Business Platform",
  description:
    "Términos y condiciones (borrador) de Grow Business Platform: simulación de inversión sin dinero real ni asesoría financiera, cuentas, planes y uso aceptable.",
  alternates: { canonical: "https://crypto-investor-web.onrender.com/legal/terminos" },
  openGraph: {
    title: "Términos y condiciones — Grow Business Platform",
    description:
      "Borrador de los términos de Grow Business Platform: simulación sin dinero real ni asesoría financiera.",
    url: "https://crypto-investor-web.onrender.com/legal/terminos",
    locale: "es_MX",
    type: "website",
  },
};

export default function TerminosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
