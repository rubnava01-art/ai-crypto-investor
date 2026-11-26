// Claves y nombres de plan (2.4, 2026-11-26): antes vivían en
// components/PlanesPanel.tsx y la página /login los importaba desde
// ahí, arrastrando todo el módulo de tarjetas de planes al chunk de
// login. Son funciones puras sin JSX: viven aquí, sin dependencias,
// y PlanesPanel las re-exporta para no romper a sus importadores
// (PlanesCompare, HerramientasSection, lib/pagos).
// Precios únicos aprobados: Esencial $19, Crecimiento $49,
// Negocio Total $99, 14 días gratis. Sin cambio de conducta.

/** Claves de plan para ?plan= (contrato A2, 2026-11-13): los valores
 * EXACTOS que viajan en /login?mode=register&plan=<clave> y en el
 * payload de registro; el admin los ve en la vista de pendientes.
 * Sufijos de las claves de t.planes (nameEsencial, priceEsencial…). */
export const PLAN_KEYS = ["esencial", "crecimiento", "total"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export function isPlanKey(value: string | null | undefined): value is PlanKey {
  return value === "esencial" || value === "crecimiento" || value === "total";
}

/** Nombre visible de un plan por su clave (para el aviso post-registro). */
export function planNameForKey(t: { planes: Record<string, string> }, key: PlanKey): string {
  const map: Record<PlanKey, string> = {
    esencial: t.planes.nameEsencial,
    crecimiento: t.planes.nameCrecimiento,
    total: t.planes.nameTotal,
  };
  return map[key];
}
