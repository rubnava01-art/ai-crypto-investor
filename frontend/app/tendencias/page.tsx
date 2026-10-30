"use client";

import { TendenciasPanel } from "../../components/TendenciasPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function TendenciasPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.tendencias.pageTitle} subtitle={t.tendencias.pageSubtitle}>
      <TendenciasPanel />
    </ModuleShell>
  );
}
