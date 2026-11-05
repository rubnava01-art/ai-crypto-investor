"use client";

import Link from "next/link";
import { useLanguage } from "../lib/i18n";

/** Pager anterior/siguiente entre los 3 manuales de Estudiar
 * (2026-11-05): es la alternativa visible y de teclado del swipe
 * entre manuales. En los extremos el botón sin destino NO se renderiza
 * (mejor que `disabled`: evita un botón muerto al final de una lectura
 * larga). Orden: plataforma → invertir → negocio. */

interface ManualPagerProps {
  prevHref?: string;
  nextHref?: string;
}

const pagerBtn =
  "flex min-h-[44px] items-center rounded-xl border border-zinc-700 bg-zinc-900/70 px-4 py-2.5 text-sm font-semibold text-zinc-100 transition-colors hover:border-sky-500 hover:bg-zinc-800 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60";

export function ManualPager({ prevHref, nextHref }: ManualPagerProps) {
  const { t } = useLanguage();
  const g = t.estudiarGestos;
  if (!prevHref && !nextHref) return null;
  return (
    <nav className="mt-6 flex items-center justify-between gap-2">
      {prevHref ? (
        <Link href={prevHref} className={pagerBtn}>
          ← {g.prevManual}
        </Link>
      ) : (
        <span />
      )}
      {nextHref ? (
        <Link href={nextHref} className={pagerBtn}>
          {g.nextManual} →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
