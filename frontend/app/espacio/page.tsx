"use client";

import { EspacioPanel } from "../../components/EspacioPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function EspacioPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.espacio.title} subtitle={t.espacio.subtitle}>
      <EspacioPanel />
    </ModuleShell>
  );
}
