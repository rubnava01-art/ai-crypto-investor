"use client";

import Link from "next/link";
import { useLanguage } from "../lib/i18n";

/** Juego link section on /estudiar, right after Manuales and with the same
 * sky accent (the Study family color). It adds no top-level nav entry —
 * the game lives under /estudiar/. */
export function JuegoPanel() {
  const { t } = useLanguage();
  const j = t.juego;
  return (
    <section aria-label={j.sectionTitle} className="rounded-2xl border-2 border-sky-500/60 bg-sky-500/10 px-4 py-4 sm:px-5">
      <h2 className="text-base font-bold text-zinc-100">{j.sectionTitle}</h2>
      <p className="mt-1 text-sm leading-relaxed text-zinc-300">{j.sectionIntro}</p>
      <div className="mt-4">
        <Link
          href="/estudiar/juego"
          aria-label={j.sectionLinkAria}
          className="flex min-h-[44px] flex-col justify-center gap-0.5 rounded-xl border border-zinc-700 bg-zinc-900/70 px-4 py-3 transition-colors hover:border-sky-500 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
        >
          <span className="text-sm font-semibold text-zinc-100">{j.sectionLinkTitle}</span>
          <span className="text-xs leading-relaxed text-zinc-400">{j.sectionLinkDesc}</span>
          <span aria-hidden="true" className="mt-1 text-xs font-semibold text-sky-400">→</span>
        </Link>
      </div>
    </section>
  );
}
