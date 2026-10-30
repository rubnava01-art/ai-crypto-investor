"use client";

import { AuditorPanel } from "../../components/AuditorPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function AuditorPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.auditor.pageTitle} subtitle={t.auditor.pageSubtitle}>
      <AuditorPanel />
    </ModuleShell>
  );
}
