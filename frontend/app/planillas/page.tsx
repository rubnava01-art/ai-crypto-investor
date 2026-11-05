"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";
import { PlanillasPanel } from "../../components/PlanillasPanel";

export default function PlanillasPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.planillas.title} subtitle={t.planillas.subtitle}>
      <PlanillasPanel />
    </ModuleShell>
  );
}
