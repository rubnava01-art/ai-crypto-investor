import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
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

export const viewport: Viewport = {
  // Color de la barra del navegador móvil: mismo #030712 del fondo,
  // para que la app no parpadee en blanco al abrirla (optimización
  // 2026-11-06; sin cambios de UI ni textos nuevos).
  themeColor: "#030712",
};

// F-1 (2026-11-14, Agente 2): Inter + Plus Jakarta Sans autoalojadas
// con next/font/google (parte de Next, sin dependencias nuevas): los
// woff2 se sirven desde /_next/static, sin peticiones a Google en
// runtime. Antes la pila solo se declaraba en globals.css y el 100 %
// de los usuarios veía el fallback del sistema (0 @font-face).
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-inter",
});
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
  variable: "--font-jakarta",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`dark ${inter.variable} ${jakarta.variable}`}>
      <body className="min-h-dvh bg-[#030712] text-zinc-100 antialiased">
        <Analytics />
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
