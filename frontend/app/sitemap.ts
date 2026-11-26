import type { MetadataRoute } from "next";

/** Sitemap (gestión SEO 2026-11-03, reel Peter Lead).
 * Solo las entradas públicas con contenido real sin sesión: la raíz,
 * /login, /planes, /contacto, /herramientas (TBT-Herramientas, FASE 2,
 * C-1, 2026-11-24: pública de verdad, sin ModuleShell, con contenido
 * SSR), /verificar-correo (pública: verifica el enlace del correo sin
 * sesión) y las 4 /legal/* de la Fase 2 mejoras-v1. El resto de rutas
 * vive tras login (token en localStorage) y no se lista, porque un bot
 * no vería contenido real en ellas. /planes se añadió en Fase 4
 * (2026-11-23) y se hizo pública de verdad en Fase 4 mejoras-v1
 * (2026-11-25, tarea 2) y en el arreglo rápido del 25 nov (ambas
 * soluciones coincidían: PublicNav + PlanesPanel, sin ModuleShell). */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://crypto-investor-web.onrender.com";
  return [
    {
      url: `${base}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/login`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${base}/planes`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${base}/herramientas`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${base}/contacto`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    // Fase 3 mejoras-v1, tarea 3: /verificar-correo es pública (sin
    // sesión) y tiene contenido real (verificación + reenvío).
    {
      url: `${base}/verificar-correo`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    // Fase 2 mejoras-v1, tarea 1: textos legales públicos (borradores).
    {
      url: `${base}/legal/terminos`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${base}/legal/privacidad`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${base}/legal/cookies`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    // Fase 2 mejoras-v1, tarea 3: reembolsos y cancelación.
    {
      url: `${base}/legal/reembolsos`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
