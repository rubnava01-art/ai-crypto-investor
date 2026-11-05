"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";
import { AnalisisPanel } from "../../components/AnalisisPanel";

export default function AnalisisPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.analisis.title} subtitle={t.analisis.subtitle}>
      <AnalisisPanel />
    </ModuleShell>
  );
}
