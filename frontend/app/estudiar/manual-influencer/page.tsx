"use client";

import { useRouter } from "next/navigation";
import { ManualSections } from "../../../components/ManualSections";
import { ManualPager } from "../../../components/ManualPager";
import { ModuleShell } from "../../../components/ModuleShell";
import { useLanguage } from "../../../lib/i18n";
import { useSwipeNav } from "../../../lib/useSwipeNav";

export default function ManualInfluencerPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const m = t.manuales;
  const sections = [
    { title: m.p4s1Title, body: m.p4s1Body },
    { title: m.p4s2Title, body: m.p4s2Body },
    { title: m.p4s3Title, body: m.p4s3Body },
    { title: m.p4s4Title, body: m.p4s4Body },
    { title: m.p4s5Title, body: m.p4s5Body },
  ];
  // Swipe derecha → Manual 3. Swipe izquierda: sin destino en el
  // Manual 4 (no hay siguiente); el pager tampoco muestra ese botón.
  const swipeHandlers = useSwipeNav({ onSwipeRight: () => router.push("/estudiar/manual-negocio") });
  return (
    <ModuleShell moduleTitle={m.p4Title} subtitle={m.p4Subtitle}>
      <div data-estudiar {...swipeHandlers}>
        <ManualSections sections={sections} />
        <ManualPager prevHref="/estudiar/manual-negocio" />
      </div>
    </ModuleShell>
  );
}
