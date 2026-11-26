"use client";

import { useLanguage } from "../lib/i18n";

/** Aviso de simulación (Fase 2 mejoras-v1, tarea 2): «Simulación, no es
 * asesoría financiera», visible sin hacer scroll en cada pantalla que lo
 * lleva. Se renderiza como primer hijo de cada panel: señales, panel
 * Invertir, gráficos de precios (MarketPanel y la gráfica de Clases) y
 * la tarjeta informativa de Invertir para cuentas Prueba. El backtest no
 * tiene pantalla propia en el frontend (solo API de backend), así que no
 * hay dónde ponerlo: queda registrado como pendiente en el informe de
 * la fase. */
export function SimulacionAviso() {
  const { t } = useLanguage();
  return (
    <p
      role="note"
      className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-sm leading-relaxed text-amber-200"
    >
      <span className="font-bold">{t.simulacion.aviso}. </span>
      {t.simulacion.detalle}
    </p>
  );
}
