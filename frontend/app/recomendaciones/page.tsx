"use client";

import { RecomendacionesPanel } from "../../components/RecomendacionesPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function RecomendacionesPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.recomendaciones.pageTitle} subtitle={t.recomendaciones.pageSubtitle}>
      <RecomendacionesPanel />
    </ModuleShell>
  );
}
