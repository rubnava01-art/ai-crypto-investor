// Matemática pura de la «Calculadora de rentabilidad» (2026-11-25,
// plan servicios-calc §2.B.2). Módulo PURO (sin React, sin red, sin
// persistencia): lo consume RentabilidadCalculator.tsx y lo testea
// lib/rentabilidad.test.ts.
//
// Definiciones (decisión D-1 del plan: rentabilidad ≡ retorno sobre
// costos, NO margen neto % — ese ya es MN% y repetirlo no aportaría
// nada nuevo; tampoco es ROI sobre capital, porque no se pide capital
// invertido). Todas las cifras en USD del mismo periodo (mes):
//   CT  = CV + CF            (costos totales)
//   MB  = I − CV             (margen bruto $)
//   MB% = MB / I × 100       (solo si I > 0)
//   MN  = I − CT = MB − CF   (margen neto $)
//   MN% = MN / I × 100       (solo si I > 0)
//   PE  = CF × I / (I − CV)  (punto de equilibrio en ingresos; solo si
//                              I > CV; si CV ≥ I no existe equilibrio)
//   R   = MN / CT × 100      (rentabilidad: beneficio neto / costos
//                              totales; solo si CT > 0)
//
// Indefinidos → null, nunca NaN / Infinity. Entradas inválidas
// (negativas, no finitas, no numéricas o > 1e12) → null (sin resultado).

/** Tope por campo, el mismo que MAX_PRINCIPAL de CompoundCalculator. */
export const MAX_RENT_AMOUNT = 1e12;

export interface RentabilidadResult {
  /** Costos totales CV + CF (siempre definido con entradas válidas). */
  costosTotales: number;
  /** Margen bruto en $ (siempre definido con entradas válidas). */
  margenBruto: number;
  /** Margen bruto %; null si I = 0 (división por cero). */
  margenBrutoPct: number | null;
  /** Margen neto en $ (siempre definido con entradas válidas). */
  margenNeto: number;
  /** Margen neto %; null si I = 0. */
  margenNetoPct: number | null;
  /** Ingresos necesarios para MN = 0; null si no existe equilibrio
   * (I = 0, o CV ≥ I) — nunca Infinity ni negativo. 0 si CF = 0. */
  puntoEquilibrio: number | null;
  /** true cuando I > 0 y CV ≥ I: cada venta pierde dinero y no hay
   * punto de equilibrio (distingue el null de PE por falta de ingresos). */
  sinEquilibrio: boolean;
  /** Rentabilidad (beneficio neto / costos totales) en %; null si
   * CT = 0 (división por cero). Definida aunque I = 0 si CT > 0. */
  rentabilidad: number | null;
}

/** Normaliza -0 a 0 (E-9): un «−$0.00» no debe aparecer nunca. */
const normZero = (n: number): number => (n === 0 ? 0 : n);

/** Entrada válida ⇔ número finito, ≥ 0 y ≤ 1e12. */
export function isValidRentInput(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= MAX_RENT_AMOUNT;
}

/**
 * Calcula rentabilidad a partir de ingresos (I), costos variables (CV)
 * y costos fijos (CF). Devuelve null si alguna entrada es inválida
 * (negativa, NaN, infinita o > 1e12); en cualquier otro caso devuelve
 * el resultado con los indefinidos en null.
 */
export function calcRentabilidad(
  ingresos: number,
  costosVariables: number,
  costosFijos: number,
): RentabilidadResult | null {
  if (
    !isValidRentInput(ingresos) ||
    !isValidRentInput(costosVariables) ||
    !isValidRentInput(costosFijos)
  ) {
    return null;
  }
  const I = ingresos;
  const CV = costosVariables;
  const CF = costosFijos;

  const CT = normZero(CV + CF);
  const MB = normZero(I - CV);
  const MN = normZero(I - CT);
  // Coherencia interna (E-12): MN = MB − CF por construcción.
  const margenBrutoPct = I > 0 ? normZero((MB / I) * 100) : null;
  const margenNetoPct = I > 0 ? normZero((MN / I) * 100) : null;
  // PE = CF × I / (I − CV): solo si I > 0 y CV < I. Con CF = 0 → 0.
  const sinEquilibrio = I > 0 && CV >= I;
  const puntoEquilibrio =
    I > 0 && CV < I ? normZero((CF * I) / (I - CV)) : null;
  // R = MN / CT × 100: solo si CT > 0 (D-1).
  const rentabilidad = CT > 0 ? normZero((MN / CT) * 100) : null;

  // Defensa en profundidad (E-8/E-11): con el tope 1e12 ningún
  // intermedio puede desbordar, pero si alguno no fuera finito el
  // resultado se anula en vez de mostrar $∞ o Infinity%.
  const out: RentabilidadResult = {
    costosTotales: CT,
    margenBruto: MB,
    margenBrutoPct,
    margenNeto: MN,
    margenNetoPct,
    puntoEquilibrio,
    sinEquilibrio,
    rentabilidad,
  };
  for (const v of Object.values(out)) {
    if (typeof v === "number" && !Number.isFinite(v)) return null;
  }
  return out;
}
