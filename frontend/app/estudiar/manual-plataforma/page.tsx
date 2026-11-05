"use client";

import { useRouter } from "next/navigation";
import { ManualSections } from "../../../components/ManualSections";
import { ManualPager } from "../../../components/ManualPager";
import { ModuleShell } from "../../../components/ModuleShell";
import { useLanguage } from "../../../lib/i18n";
import { useSwipeNav } from "../../../lib/useSwipeNav";

export default function ManualPlataformaPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const m = t.manuales;
  const sections = [
    { title: m.p1s1Title, body: m.p1s1Body },
    { title: m.p1s2Title, body: m.p1s2Body },
    { title: m.p1s3Title, body: m.p1s3Body },
    { title: m.p1s4Title, body: m.p1s4Body },
    { title: m.p1s5Title, body: m.p1s5Body },
    { title: m.p1s6Title, body: m.p1s6Body },
  ];
  // Swipe izquierda → Manual 2. Swipe derecha: sin destino en el
  // Manual 1 (no hay anterior); el pager tampoco muestra ese botón.
  const swipeHandlers = useSwipeNav({ onSwipeLeft: () => router.push("/estudiar/manual-invertir") });
  return (
    <ModuleShell moduleTitle={m.p1Title} subtitle={m.p1Subtitle}>
      <div data-estudiar {...swipeHandlers}>
        <ManualSections sections={sections} />
        <ManualPager nextHref="/estudiar/manual-invertir" />
      </div>
    </ModuleShell>
  );
}
