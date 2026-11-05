"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";
import { RiesgosPanel } from "../../components/RiesgosPanel";

export default function RiesgosPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.riesgos.title} subtitle={t.riesgos.subtitle}>
      <RiesgosPanel />
    </ModuleShell>
  );
}
