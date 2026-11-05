"use client";

import { useRouter } from "next/navigation";
import { ManualSections } from "../../../components/ManualSections";
import { ManualPager } from "../../../components/ManualPager";
import { ModuleShell } from "../../../components/ModuleShell";
import { useLanguage } from "../../../lib/i18n";
import { useSwipeNav } from "../../../lib/useSwipeNav";

export default function ManualInvertirPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const m = t.manuales;
  const sections = [
    { title: m.p2s1Title, body: m.p2s1Body },
    { title: m.p2s2Title, body: m.p2s2Body },
    { title: m.p2s3Title, body: m.p2s3Body },
    { title: m.p2s4Title, body: m.p2s4Body },
    { title: m.p2s5Title, body: m.p2s5Body },
    { title: m.p2s6Title, body: m.p2s6Body },
  ];
  // Swipe izquierda → Manual 3; swipe derecha → Manual 1.
  const swipeHandlers = useSwipeNav({
    onSwipeLeft: () => router.push("/estudiar/manual-negocio"),
    onSwipeRight: () => router.push("/estudiar/manual-plataforma"),
  });
  return (
    <ModuleShell moduleTitle={m.p2Title} subtitle={m.p2Subtitle}>
      <div data-estudiar {...swipeHandlers}>
        <ManualSections sections={sections} warning={m.p2Warning} />
        <ManualPager prevHref="/estudiar/manual-plataforma" nextHref="/estudiar/manual-negocio" />
      </div>
    </ModuleShell>
  );
}
