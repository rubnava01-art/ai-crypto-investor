"use client";

import { CorreosPanel } from "../../components/CorreosPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function CorreosPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.correos.title} subtitle={t.correos.subtitle}>
      <CorreosPanel />
    </ModuleShell>
  );
}
