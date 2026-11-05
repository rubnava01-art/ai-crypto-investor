import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "../lib/i18n";
import { Analytics } from "../lib/analytics";

// Gestión SEO 2026-11-03 (reel Peter Lead: servicios + nombre del
// negocio en los títulos; contenido con términos que la gente busca).
// Sin promesas de rentabilidad: la inversión es en simulación.
const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;

export const metadata: Metadata = {
  metadataBase: new URL("https://crypto-investor-web.onrender.com"),
  title: "Grow Business Platform — Invierte, estudia, crea y gestiona tu negocio en un solo lugar",
  description:
    "Grow Business Platform: gestor de negocios — inversión en cripto en simulación (BTC/ETH), academia, creación de logos y mockups, CRM, facturas e inventario.",
  openGraph: {
    title: "Grow Business Platform — Invierte, estudia, crea y gestiona tu negocio en un solo lugar",
    description:
      "Grow Business Platform: gestor de negocios — inversión en cripto en simulación (BTC/ETH), academia, creación de logos y mockups, CRM, facturas e inventario.",
    url: "https://crypto-investor-web.onrender.com",
    siteName: "Grow Business Platform",
    locale: "es_ES",
    type: "website",
  },
  // Verificación de Search Console: solo se emite si el dueño define
  // NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION con el código de Google.
  ...(googleVerification ? { verification: { google: googleVerification } } : {}),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-dvh bg-zinc-950 text-zinc-100 antialiased">
        <Analytics />
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
