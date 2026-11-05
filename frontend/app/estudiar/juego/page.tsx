"use client";

import { JuegoQuiz } from "../../../components/JuegoQuiz";
import { ManualSections } from "../../../components/ManualSections";
import { ModuleShell } from "../../../components/ModuleShell";
import { useLanguage } from "../../../lib/i18n";

/** Juego: playful guide to the platform — explainer cards (basics,
 * structure, management) plus the interactive quiz. Client-side only;
 * the simulation note stays visible at the top. */
export default function JuegoPage() {
  const { t } = useLanguage();
  const j = t.juego;
  const sections = [
    { title: j.card1Title, body: j.card1Body },
    { title: j.card2Title, body: j.card2Body },
    { title: j.card3Title, body: j.card3Body },
  ];
  return (
    <ModuleShell moduleTitle={j.pageTitle} subtitle={j.pageSubtitle}>
      <div className="space-y-4">
        <p role="note" className="rounded-xl border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-sm font-semibold leading-relaxed text-amber-200">
          {j.simNote}
        </p>
        <ManualSections sections={sections} />
        <JuegoQuiz />
      </div>
    </ModuleShell>
  );
}
