"use client";

import Link from "next/link";
import { useLanguage } from "../lib/i18n";

/** Manuales section, FIRST in Study and visually highlighted (sky accent,
 * the Study family color). Links to the four manual pages; it adds no
 * top-level nav entry — the manuals live under /estudiar/. */
export function ManualesPanel() {
  const { t } = useLanguage();
  const m = t.manuales;
  const cards = [
    { href: "/estudiar/manual-plataforma", title: m.cardPlataformaTitle, desc: m.cardPlataformaDesc, aria: m.cardPlataformaAria },
    { href: "/estudiar/manual-invertir", title: m.cardInvertirTitle, desc: m.cardInvertirDesc, aria: m.cardInvertirAria },
    { href: "/estudiar/manual-negocio", title: m.cardNegocioTitle, desc: m.cardNegocioDesc, aria: m.cardNegocioAria },
    { href: "/estudiar/manual-influencer", title: m.cardInfluencerTitle, desc: m.cardInfluencerDesc, aria: m.cardInfluencerAria },
  ];
  return (
    <section aria-label={m.sectionTitle} className="rounded-2xl border-2 border-sky-500/60 bg-sky-500/10 px-4 py-4 sm:px-5">
      <h2 className="text-base font-bold text-zinc-100">{m.sectionTitle}</h2>
      <p className="mt-1 text-sm leading-relaxed text-zinc-300">{m.sectionIntro}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            aria-label={c.aria}
            className="flex min-h-[44px] flex-col justify-center gap-0.5 rounded-xl border border-zinc-700 bg-zinc-900/70 px-4 py-3 transition-colors hover:border-sky-500 hover:bg-zinc-800 active:bg-zinc-700 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
          >
            <span className="text-sm font-semibold text-zinc-100">{c.title}</span>
            <span className="text-xs leading-relaxed text-zinc-400">{c.desc}</span>
            <span aria-hidden="true" className="mt-1 text-xs font-semibold text-sky-400">→</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
