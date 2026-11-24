// Helpers puros del dashboard del CRM (Fase 3, rediseño estilo Vivero).
// Sin llamadas de red ni fechas: testeables sin mocks.

/** Dinero en USD con el formato de la foto ($0.00): prefijo $ explícito,
 * porque `es-MX` formatea USD como "USD 0.00" en este Node. */
export function crmMoney(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Puntos "x,y x,y…" de la mini-gráfica de 7 días (SVG polyline). */
export function sparklinePoints(values: number[], width = 120, height = 32): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  return values
    .map(
      (v, i) =>
        `${((i * width) / Math.max(values.length - 1, 1)).toFixed(1)},${(
          height -
          4 -
          (v / max) * (height - 8)
        ).toFixed(1)}`,
    )
    .join(" ");
}

/** Altura en px de una barra de ventas semanales (mín. 12 si hay venta,
 * 4 si es cero: la barra vacía se sigue viendo como línea base). */
export function weeklyBarHeight(total: number, max: number): number {
  if (total > 0 && max > 0) return Math.max(12, Math.round((total / max) * 100));
  return 4;
}
