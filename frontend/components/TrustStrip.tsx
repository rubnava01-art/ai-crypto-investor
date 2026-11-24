// Franja de confianza / prueba social — rediseño fintech (2026-11-14,
// Agente 1). REGLA DE HONESTIDAD: todos los valores llegan por props
// como strings; este componente NO inventa ni hardcodea ninguna cifra.
// El llamador pasa solo números reales verificados (p. ej. 25 módulos,
// 4 pilares, 3 planes, 14 días gratis, 2 idiomas). Sin items no
// renderiza nada. El backtest −9,29 % neto NO va aquí: solo con su
// aviso de resultados pasados, en el sitio que lo muestre.
export type TrustStripItem = {
  value: string;
  label: string;
};

export function TrustStrip({
  items,
  ariaLabel,
}: {
  items: TrustStripItem[];
  /** Etiqueta accesible de la sección, traducida por el llamador
   * (p. ej. una clave t.landing.*). Sin ella no se emite aria-label:
   * nunca se hardcodea español aquí (corrección M-2, QA 2026-11-14). */
  ariaLabel?: string;
}) {
  if (!items || items.length === 0) return null;
  return (
    <section aria-label={ariaLabel}>
      <dl className="fintech-card grid grid-cols-2 gap-6 px-6 py-6 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => (
          <div key={item.label} className="flex min-w-0 flex-col text-center">
            <dt className="order-2 mt-2 block break-words text-xs font-medium leading-relaxed text-slate-400 sm:text-sm">
              {item.label}
            </dt>
            <dd className="fintech-nums order-1 break-words text-2xl font-extrabold tracking-tight text-slate-50 sm:text-3xl">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
