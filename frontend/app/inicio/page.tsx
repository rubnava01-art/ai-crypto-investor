"use client";

import { InicioPanel } from "../../components/InicioPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function InicioPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.inicio.title} subtitle={t.inicio.subtitle}>
      <InicioPanel />
    </ModuleShell>
  );
}
