"use client";

import { useRouter } from "next/navigation";
import { ManualSections } from "../../../components/ManualSections";
import { ManualPager } from "../../../components/ManualPager";
import { ModuleShell } from "../../../components/ModuleShell";
import { useLanguage } from "../../../lib/i18n";
import { useSwipeNav } from "../../../lib/useSwipeNav";

export default function ManualNegocioPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const m = t.manuales;
  const sections = [
    { title: m.p3s1Title, body: m.p3s1Body },
    { title: m.p3s2Title, body: m.p3s2Body },
    { title: m.p3s3Title, body: m.p3s3Body },
    { title: m.p3s4Title, body: m.p3s4Body },
    { title: m.p3s5Title, body: m.p3s5Body },
    { title: m.p3s6Title, body: m.p3s6Body },
    { title: m.p3s7Title, body: m.p3s7Body },
    { title: m.p3s8Title, body: m.p3s8Body },
  ];
  // Swipe derecha → Manual 2. Swipe izquierda: sin destino en el
  // Manual 3 (no hay siguiente); el pager tampoco muestra ese botón.
  const swipeHandlers = useSwipeNav({ onSwipeRight: () => router.push("/estudiar/manual-invertir") });
  return (
    <ModuleShell moduleTitle={m.p3Title} subtitle={m.p3Subtitle}>
      <div data-estudiar {...swipeHandlers}>
        <ManualSections sections={sections} />
        <ManualPager prevHref="/estudiar/manual-invertir" />
      </div>
    </ModuleShell>
  );
}
