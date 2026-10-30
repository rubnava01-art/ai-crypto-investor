"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";
import { ReferidosPanel } from "../../components/ReferidosPanel";

export default function ReferidosPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.referidos.title} subtitle={t.referidos.subtitle}>
      <ReferidosPanel />
    </ModuleShell>
  );
}
