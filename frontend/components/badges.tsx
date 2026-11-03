"use client";

import { useLanguage } from "../lib/i18n";

/** Badge DEMO/simulación (F8, decisión de Rubén 2026-11-02): NUNCA se
 * quita. La variante prominente (ámbar) vive en la cabecera y en cada
 * vista de trading hay al menos una etiqueta visible; la variante
 * `quiet` (gris, más pequeña, mismo texto DEMO) es para los badges por
 * panel, contra la fatiga de 7+ señales en una pantalla. */
export function DemoBadge({ quiet = false }: { quiet?: boolean } = {}) {
  return (
    <span
      className={
        quiet
          ? "inline-flex shrink-0 select-none items-center whitespace-nowrap rounded-md bg-zinc-500/10 px-2 py-1 text-[10px] font-semibold leading-none tracking-widest text-zinc-400 ring-1 ring-inset ring-zinc-500/30"
          : "inline-flex shrink-0 select-none items-center whitespace-nowrap rounded-md bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold leading-none tracking-widest text-amber-400 ring-1 ring-inset ring-amber-500/40"
      }
    >
      DEMO
    </span>
  );
}

/** Punto de estado: antes solo color (aria-hidden). Fase 5 (F2): palabra
 * de estado oculta visualmente, pasada por el llamador porque el mismo
 * punto significa cosas distintas según el panel (conectado, en marcha…). */
export function StatusDot({
  on,
  red = false,
  srText,
}: {
  on: boolean;
  red?: boolean;
  srText?: string;
}) {
  const { t } = useLanguage();
  const color = red && on ? "bg-red-500" : on ? "bg-emerald-500" : "bg-zinc-600";
  const text = srText ?? (on ? t.reliability.statusConnected : t.reliability.statusDisconnected);
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-white/10 ${color}`} aria-hidden />
      <span className="sr-only">{text}</span>
    </span>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-sm leading-relaxed text-zinc-500">{text}</p>;
}
