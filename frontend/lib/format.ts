// Formato de dinero y fechas, centralizado (Fase 4, FE6).
// Antes cada panel tenía su propio formateador (dashboard, InvestorPanel,
// FacturasPanel, InventarioPanel) con la misma lógica y derivas visibles
// (Inventario en MXN, Facturas en USD). El dinero sigue siendo string en el
// API; aquí solo se formatea para mostrar, nunca se redondea para guardar.

/** Dinero para mostrar. null/"" → "—" (mismo marcador que ya usaba el dashboard). */
export function formatMoney(
  value: string | number | null | undefined,
  currency: string = "USD",
  locale: string = "en-US",
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(locale, { style: "currency", currency, maximumFractionDigits: 2 });
}

/** Fecha sola (día + mes corto + año) en hora local, o null si no hay fecha. */
export function formatDate(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/** Fecha y hora locales (día + mes corto + hora:minuto), o "" si no hay fecha. */
export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Fecha y hora en UTC con sufijo " UTC" (formato que ya usaba el dashboard). */
export function formatDateTimeUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { timeZone: "UTC", hour12: false }) + " UTC";
}
