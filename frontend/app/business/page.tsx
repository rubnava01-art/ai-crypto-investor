"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";
import { BusinessPanel } from "../../components/BusinessPanel";

export default function BusinessPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.business.title} subtitle={t.business.subtitle}>
      <BusinessPanel />
    </ModuleShell>
  );
}
