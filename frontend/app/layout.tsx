import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "../lib/i18n";
import { Analytics } from "../lib/analytics";
import { AsistenteChatLazy } from "../components/AsistenteChatLazy";

// Gestión SEO 2026-11-03 (reel Peter Lead: servicios + nombre del
// negocio en los títulos; contenido con términos que la gente busca).
// Sin promesas de rentabilidad: la inversión es en simulación.
// Fase 3 mejoras-v1, tarea 3: título de la raíz acortado a 49 caracteres
// (antes 87; el límite para que no se corte en resultados es 60) y
// datos estructurados JSON-LD (Organization + WebSite; sin ItemList de
// herramientas: lib/herramientas.ts no existe en este worktree — ver
// frontend/app/herramientas/PENDIENTE.md).
// Mensaje unificado (Fase 3 mejoras-v1, tarea 4): la descripción de
// aquí y el subtítulo de la landing dicen lo mismo — los cuatro
// pilares, incluido NEST Forge AI:
//   - Meta description: este metadata (+ OG/Twitter) y app/page.tsx.
//   - Subtítulo visible: lib/i18n/es.ts y en.ts, clave landing.subtitle
//     (lo renderiza components/Hero.tsx vía components/Landing.tsx).
// Si cambia uno, cambia el otro. README.md es documentación de
// desarrollo (historia del repo), no texto de presentación: no se toca.
// lib/novedades.ts son noticias del sistema, no el resumen.
const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;

// JSON-LD (Fase 3 mejoras-v1, tarea 3): solo datos reales — nombre, URL
// y logo de la plataforma. Sin ItemList: las herramientas viven en
// lib/herramientas.ts, ausente en este worktree.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Grow Business Platform",
      url: "https://crypto-investor-web.onrender.com",
      logo: "https://crypto-investor-web.onrender.com/icon.svg",
    },
    {
      "@type": "WebSite",
      name: "Grow Business Platform",
      url: "https://crypto-investor-web.onrender.com",
      inLanguage: "es-MX",
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL("https://crypto-investor-web.onrender.com"),
  title: "Grow Business Platform — Invierte, estudia y crea",
  description:
    "Grow Business Platform: inversión en cripto en simulación (BTC/ETH), academia, NEST Forge AI (logos, mockups, copies y tendencias), CRM, facturas e inventario.",
  alternates: { canonical: "https://crypto-investor-web.onrender.com/" },
  // Favicon derivado del logo del proyecto (Fase 4, 2026-11-23):
  // icon.svg es el propio nest-logo.svg; favicon.png es su raster 180×180.
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: "/favicon.svg",
    apple: [{ url: "/favicon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "Grow Business Platform — Invierte, estudia y crea",
    description:
      "Grow Business Platform: inversión en cripto en simulación (BTC/ETH), academia, NEST Forge AI (logos, mockups, copies y tendencias), CRM, facturas e inventario.",
    url: "https://crypto-investor-web.onrender.com",
    siteName: "Grow Business Platform",
    locale: "es_MX",
    type: "website",
    // og.png 1200×630 generada desde el logo (Fase 4): título + "Simulación",
    // sin métricas inventadas.
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Grow Business Platform — Simulación, sin dinero real",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Grow Business Platform — Invierte, estudia y crea",
    description:
      "Grow Business Platform: inversión en cripto en simulación (BTC/ETH), academia, NEST Forge AI (logos, mockups, copies y tendencias), CRM, facturas e inventario.",
    images: ["/og.png"],
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
    <html lang="es-MX" className={`dark ${inter.variable} ${jakarta.variable}`}>
      <body className="min-h-dvh bg-[#030712] text-zinc-100 antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <Analytics />
        <LanguageProvider>
          {children}
          <AsistenteChatLazy />
        </LanguageProvider>
      </body>
    </html>
  );
}
