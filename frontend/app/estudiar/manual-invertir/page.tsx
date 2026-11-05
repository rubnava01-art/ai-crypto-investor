"use client";

import { ManualSections } from "../../../components/ManualSections";
import { ModuleShell } from "../../../components/ModuleShell";
import { useLanguage } from "../../../lib/i18n";

export default function ManualInvertirPage() {
  const { t } = useLanguage();
  const m = t.manuales;
  const sections = [
    { title: m.p2s1Title, body: m.p2s1Body },
    { title: m.p2s2Title, body: m.p2s2Body },
    { title: m.p2s3Title, body: m.p2s3Body },
    { title: m.p2s4Title, body: m.p2s4Body },
    { title: m.p2s5Title, body: m.p2s5Body },
    { title: m.p2s6Title, body: m.p2s6Body },
  ];
  return (
    <ModuleShell moduleTitle={m.p2Title} subtitle={m.p2Subtitle}>
      <ManualSections sections={sections} warning={m.p2Warning} />
    </ModuleShell>
  );
}
