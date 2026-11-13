"use client";

// Tabla comparativa de planes (2026-11-12): solo presencia de funciones
// (✓/—), sin límites — t.planes no declara ningún límite. DERIVADA por
// código de PLAN_FEATURE_KEYS (PlanesPanel, fuente única): cada nivel
// acumula el anterior, así que la tabla nunca se desincroniza de las
// tarjetas. <table> real con <th scope> y etiquetas accesibles.
import { useLanguage } from "../lib/i18n";
import { Check, PLAN_CARD_IDS, PLAN_FEATURE_KEYS } from "./PlanesPanel";

export function PlanesCompare() {
  const { t } = useLanguage();
  const l = t.landing;
  const p = t.planes;

  const planNames = [p.nameEsencial, p.nameCrecimiento, p.nameTotal];
  // Unión de las 14 funciones, en el orden Esencial → Crecimiento → Total.
  const allKeys = PLAN_FEATURE_KEYS.flat();
  // Por plan: conjunto acumulado de claves (Esencial; Esencial+Crecimiento; todo).
  const includedByPlan: Set<string>[] = PLAN_FEATURE_KEYS.map((_, i) =>
    new Set(PLAN_FEATURE_KEYS.slice(0, i + 1).flat()),
  );

  return (
    <div className="mt-8">
      <h3 className="text-lg font-bold text-zinc-50">{l.compareTitle}</h3>
      <p className="mt-1 text-sm leading-relaxed text-zinc-400">{l.compareIntro}</p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <caption className="sr-only">{l.compareTitle}</caption>
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/60">
              <th scope="col" className="px-4 py-3 text-left font-semibold text-zinc-200">
                {l.compareFeatureCol}
              </th>
              {planNames.map((name, i) => (
                <th key={name} scope="col" className="px-4 py-3 text-center font-semibold text-zinc-200">
                  <a
                    href={`#${PLAN_CARD_IDS[i]}`}
                    className="inline-flex min-h-[44px] items-center justify-center rounded px-1 py-1 text-zinc-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                  >
                    {name}
                  </a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allKeys.map((key) => (
              <tr key={key} className="border-b border-zinc-800/60 last:border-b-0">
                <th scope="row" className="px-4 py-3 text-left font-medium text-zinc-200">
                  {p[key]}
                </th>
                {includedByPlan.map((included, i) => (
                  <td key={planNames[i]} className="px-4 py-3 text-center">
                    {included.has(key) ? (
                      <span className="inline-flex items-center justify-center gap-1.5 text-zinc-100">
                        <Check />
                        <span className="sr-only">{l.compareYes}</span>
                        <span aria-hidden="true" className="text-xs font-semibold text-zinc-400">
                          {l.compareYes}
                        </span>
                      </span>
                    ) : (
                      <span>
                        <span aria-hidden="true" className="text-zinc-500">—</span>
                        <span className="sr-only">{l.compareNo}</span>
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
