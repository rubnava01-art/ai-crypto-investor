"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";
import { CrmPanel } from "../../components/CrmPanel";

export default function CrmPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.crm.title} subtitle={t.crm.subtitle}>
      <CrmPanel />
    </ModuleShell>
  );
}
