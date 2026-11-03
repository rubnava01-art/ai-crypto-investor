import type { MetadataRoute } from "next";

/** Sitemap (gestión SEO 2026-11-03, reel Peter Lead).
 * Solo las entradas públicas: la raíz y /login. El resto de rutas vive
 * tras login (token en localStorage) y no se lista, porque un bot no
 * vería contenido real en ellas. */
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
  ];
}
