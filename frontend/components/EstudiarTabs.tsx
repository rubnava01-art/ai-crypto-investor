"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../lib/i18n";

/** Barra de secciones sticky de /estudiar (2026-11-05): navegación por
 * anclas entre las 5 secciones apiladas — el contenido NO se oculta,
 * por eso los botones usan `aria-current` y NO `role="tab"`. Las
 * flechas ‹ › son la alternativa visible y de teclado del swipe.
 * La pista de swipe se muestra siempre: es la única manera de descubrir
 * el gesto. Una sola región `aria-live` anuncia el cambio de sección. */

export interface EstudiarSection {
  id: string;
  label: string;
}

interface EstudiarTabsProps {
  sections: EstudiarSection[];
  activeId: string;
  onSelect: (id: string) => void;
  onPrev: () => void;
  onNext: () => void;
}

const tabBtn = (active: boolean) =>
  active
    ? "min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold whitespace-nowrap text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    : "min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-zinc-800 px-4 py-2.5 text-sm font-semibold whitespace-nowrap text-zinc-300 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";

const arrowBtn =
  "flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-lg font-bold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40";

export function EstudiarTabs({ sections, activeId, onSelect, onPrev, onNext }: EstudiarTabsProps) {
  const { t } = useLanguage();
  const g = t.estudiarGestos;
  const activeIndex = Math.max(0, sections.findIndex((s) => s.id === activeId));

  // Anuncio vivo: se llena solo a partir del primer cambio de sección
  // (nunca en el montaje, para no anunciar al cargar la página).
  const [announce, setAnnounce] = useState("");
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    const sec = sections.find((s) => s.id === activeId);
    if (sec) setAnnounce(g.sectionAnnounce.replace("{nombre}", sec.label));
  }, [activeId, sections, g.sectionAnnounce]);

  return (
    <nav aria-label={g.navAria} className="sticky top-0 z-10 -mx-4 border-b border-zinc-800 bg-zinc-950/95 px-4 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex items-center gap-1 py-2">
        <button type="button" aria-label={g.prevSection} onClick={onPrev} disabled={activeIndex === 0} className={arrowBtn}>
          ‹
        </button>
        <div className="estudiar-tabs-scroll flex flex-1 gap-1 overflow-x-auto">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={s.id === activeId ? "true" : undefined}
              onClick={() => onSelect(s.id)}
              className={tabBtn(s.id === activeId)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" aria-label={g.nextSection} onClick={onNext} disabled={activeIndex === sections.length - 1} className={arrowBtn}>
          ›
        </button>
      </div>
      <p className="pb-2 text-xs text-zinc-400">
        <span aria-hidden="true">← → </span>
        {g.swipeHint}
      </p>
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
    </nav>
  );
}
