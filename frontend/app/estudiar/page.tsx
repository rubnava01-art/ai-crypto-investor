"use client";

import { useCallback, useEffect, useState } from "react";
import { AcademyPanel } from "../../components/AcademyPanel";
import { ClasesPanel } from "../../components/ClasesPanel";
import { JuegoPanel } from "../../components/JuegoPanel";
import { VideosPanel } from "../../components/VideosPanel";
import { ManualesPanel } from "../../components/ManualesPanel";
import { EstudiarTabs, type EstudiarSection } from "../../components/EstudiarTabs";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";
import { usePrefersReducedMotion, useSwipeNav } from "../../lib/useSwipeNav";

/** Estudiar con gestos (2026-11-05): las 5 secciones siguen apiladas
 * verticalmente y todo el contenido sigue visible con scroll — el swipe
 * es solo un atajo. La barra sticky + las flechas ‹ › son la
 * alternativa visible y de teclado; la sección activa se sigue con
 * IntersectionObserver (fallback: la primera sección). */

const SECTION_IDS = [
  "estudiar-manuales",
  "estudiar-juego",
  "estudiar-videos",
  "estudiar-academia",
  "estudiar-clases",
] as const;

export default function EstudiarPage() {
  const { t } = useLanguage();
  const g = t.estudiarGestos;
  const reducedMotion = usePrefersReducedMotion();
  const sections: EstudiarSection[] = [
    { id: "estudiar-manuales", label: g.tabManuales },
    { id: "estudiar-juego", label: g.tabJuego },
    { id: "estudiar-videos", label: g.tabVideos },
    { id: "estudiar-academia", label: g.tabAcademia },
    { id: "estudiar-clases", label: g.tabClases },
  ];
  const [activeId, setActiveId] = useState<string>(sections[0].id);

  const scrollToSection = useCallback(
    (id: string) => {
      document.getElementById(id)?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
      setActiveId(id);
    },
    [reducedMotion]
  );

  useEffect(() => {
    const els = SECTION_IDS.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null
    );
    if (els.length === 0 || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: "-30% 0px -60% 0px" }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const activeIndex = Math.max(0, sections.findIndex((s) => s.id === activeId));

  const goNextSection = useCallback(() => {
    const next = sections[activeIndex + 1];
    if (next) scrollToSection(next.id);
  }, [activeIndex, sections, scrollToSection]);

  const goPrevSection = useCallback(() => {
    const prev = sections[activeIndex - 1];
    if (prev) scrollToSection(prev.id);
  }, [activeIndex, sections, scrollToSection]);

  const swipeHandlers = useSwipeNav({ onSwipeLeft: goNextSection, onSwipeRight: goPrevSection });

  return (
    <ModuleShell moduleTitle={t.academy.pageTitle} subtitle={t.academy.pageSubtitle}>
      <div data-estudiar {...swipeHandlers} className="space-y-4">
        <EstudiarTabs
          sections={sections}
          activeId={activeId}
          onSelect={scrollToSection}
          onPrev={goPrevSection}
          onNext={goNextSection}
        />
        <section id="estudiar-manuales" className="scroll-mt-20">
          <ManualesPanel />
        </section>
        <section id="estudiar-juego" className="scroll-mt-20">
          <JuegoPanel />
        </section>
        <section id="estudiar-videos" className="scroll-mt-20">
          <VideosPanel />
        </section>
        <section id="estudiar-academia" className="scroll-mt-20">
          <AcademyPanel />
        </section>
        <section id="estudiar-clases" className="scroll-mt-20">
          <ClasesPanel />
        </section>
      </div>
    </ModuleShell>
  );
}
