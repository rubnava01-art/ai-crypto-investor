import type { PlanKey } from "../components/PlanesPanel";

/** Punto de cableado de pagos (Onda C-2, Agente C5, 2026-11-14).
 *
 * Las URLs de pago de PayPal las pone EL DUEÑO cuando lleguen: este
 * archivo es solo el punto único donde viven. Mientras las tres sean
 * `null`, los CTAs de los planes siguen el flujo actual intacto
 * (registro con plan elegido: /login?mode=register&plan=<clave>, que
 * /login envía como `requested_plan` y muestra como chip "Plan
 * elegido"). Cuando una URL exista, el CTA de esa tarjeta irá directo
 * al pago de PayPal en vez de al registro.
 *
 * PROHIBIDO inventar URLs aquí: no existe todavía ninguna URL de pago
 * de PayPal para estos planes, y el link de la academia (otro producto)
 * NO se reutiliza. Solo el dueño (o el agente principal con sus URLs
 * reales) rellena estos valores.
 *
 * Cómo activar un plan cuando llegue su URL: poner la URL de PayPal
 * del plan en `PAYMENT_LINKS` y nada más — `paymentUrlForPlan` y los
 * CTAs de <PlanesPanel /> ya la usan. No hace falta tocar ningún otro
 * archivo. */
export const PAYMENT_LINKS: Record<PlanKey, string | null> = {
  esencial: null,
  crecimiento: null,
  total: null,
};

/** URL de pago del plan si existe, o `null` si todavía no hay pago en
 * línea para ese plan (entonces el CTA usa el flujo de registro). */
export function paymentUrlForPlan(plan: PlanKey): string | null {
  return PAYMENT_LINKS[plan] ?? null;
}
