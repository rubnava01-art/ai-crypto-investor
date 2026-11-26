import { notFound } from "next/navigation";

/** Página por herramienta — SIN PÁGINAS PROPIAS (reconciliación
 * mejoras-todas, 2026-11-26).
 *
 * El catálogo `lib/herramientas.ts` YA existe en este árbol (llegó con
 * la base, contenido remoto sync #72), pero NO tiene título,
 * descripción ni texto por herramienta: solo id, categoría, featureKey,
 * href (la ruta real de la herramienta en la app) y free. Los títulos
 * viven en i18n dentro de HerramientasSection y cada herramienta se
 * abre en su página real (vía href). Inventar un texto por herramienta
 * para rellenar esta ruta violaría la regla de no inventar contenido,
 * así que todo slug sigue dando 404 honesto y no entra en el sitemap.
 * Si el catálogo gana texto propio por herramienta, entonces:
 *   1. generateStaticParams() debe devolver un { slug } por herramienta.
 *   2. Esta página debe buscar la herramienta por params.slug y
 *      renderizar su título, descripción y texto únicos (y 404 si el
 *      slug no existe).
 *   3. Añadir /herramientas y /herramientas/[slug] a app/sitemap.ts y
 *      el ItemList de herramientas al JSON-LD de app/layout.tsx. */
export function generateStaticParams(): { slug: string }[] {
  // El catálogo existe pero no tiene texto por herramienta (ver
  // comentario de arriba): no hay slugs que pre-renderizar.
  return [];
}

/** Corrección QA H1 (Fase 3 mejoras-v1, 2026-11-25): todo slug debe dar
 * un 404 REAL a nivel HTTP, no un soft 404.
 *
 * Dos intentos fallidos antes de esta forma final (documentados para no
 * repetirlos):
 * - SSG con generateStaticParams() vacío (estado original): Next
 *   servía la cáscara de not-found como HTML estático con HTTP 200 y
 *   `Cache-Control: s-maxage=31536000`.
 * - `dynamic = "force-dynamic"` (primer intento): quitó la caché larga
 *   (`private, no-cache`) pero el status siguió en 200: con
 *   app/loading.tsx la cáscara (skeleton) se emite en streaming con
 *   200 antes de que notFound() se evalúe, y el status ya no cambia.
 *
 * Forma que sí funciona: `dynamicParams = false`. Con la lista de
 * slugs vacía, Next responde 404 directamente a nivel de ruta para
 * cualquier slug, sin renderizar la página ni pasar por loading.tsx.
 * Si el catálogo gana texto propio por herramienta y hay slugs reales,
 * generateStaticParams() debe devolver un { slug } por herramienta
 * (entonces esos renderizan y los demás siguen dando 404) y
 * dynamicParams debe SEGUIR en false. */
export const dynamicParams = false;

export default function HerramientaPage() {
  // Sin datos no hay página que mostrar: 404 honesto, no contenido
  // inventado.
  notFound();
}
