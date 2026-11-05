"use client";

import { ManualSections } from "../../../components/ManualSections";
import { ModuleShell } from "../../../components/ModuleShell";
import { useLanguage } from "../../../lib/i18n";

export default function ManualPlataformaPage() {
  const { t } = useLanguage();
  const m = t.manuales;
  const sections = [
    { title: m.p1s1Title, body: m.p1s1Body },
    { title: m.p1s2Title, body: m.p1s2Body },
    { title: m.p1s3Title, body: m.p1s3Body },
    { title: m.p1s4Title, body: m.p1s4Body },
    { title: m.p1s5Title, body: m.p1s5Body },
    { title: m.p1s6Title, body: m.p1s6Body },
  ];
  return (
    <ModuleShell moduleTitle={m.p1Title} subtitle={m.p1Subtitle}>
      <ManualSections sections={sections} />
    </ModuleShell>
  );
}
