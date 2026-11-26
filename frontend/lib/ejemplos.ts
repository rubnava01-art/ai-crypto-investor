// Datos de ejemplo (Fase 4 mejoras-v1, tarea 3): el panel "Hoy" nunca
// está vacío — si el usuario no tiene nada urgente, muestra estos
// ejemplos en vez de una pantalla vacía. Son los MISMOS datos de
// ejemplo que la landing (cliente@ejemplo.com, +1 (555) 010-0000):
// ficticios a propósito, nunca clientes, cifras ni citas reales.
// Cada ejemplo lleva la etiqueta "Ejemplo" visible y se descarta de un
// clic (localStorage por usuario); al descartarlos, "Hoy" muestra el
// mensaje honesto "Nada urgente hoy". No se crea ninguna fila en la BD:
// los datos compartidos (CRM, facturas, inventario) son globales y
// sembrar filas falsas contaminaría los datos reales de todos.
export type HoyKind = "tarea" | "factura" | "stock" | "cita";

export interface HoyItem {
  kind: HoyKind;
  titulo: string;
  detalle: string;
  href: string;
}

export function ejemplosKey(username: string): string {
  return `gpb_hoy_ejemplos_v1:${username}`;
}

export function ejemplosDescartados(username: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ejemplosKey(username)) === "descartado";
  } catch {
    return false;
  }
}

export function descartarEjemplos(username: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ejemplosKey(username), "descartado");
  } catch {
    // Sin almacenamiento, los ejemplos se muestran de nuevo; nada se rompe.
  }
}

/** Los 4 ejemplos de "Hoy", uno por tipo. Los textos llegan del
 * diccionario (t.hoy, paridad ES/EN verificada): este módulo no inventa
 * cadenas fuera de él. */
export function ejemplosHoy(t: Record<string, string>): HoyItem[] {
  return [
    { kind: "tarea", titulo: t.ejemploTareaTitulo, detalle: t.ejemploTareaDetalle, href: "/business" },
    { kind: "factura", titulo: t.ejemploFacturaTitulo, detalle: t.ejemploFacturaDetalle, href: "/facturas" },
    { kind: "stock", titulo: t.ejemploStockTitulo, detalle: t.ejemploStockDetalle, href: "/inventario" },
    { kind: "cita", titulo: t.ejemploCitaTitulo, detalle: t.ejemploCitaDetalle, href: "/business" },
  ];
}
