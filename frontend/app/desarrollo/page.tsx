"use client";

import { DesarrolloPanel } from "../../components/DesarrolloPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function DesarrolloPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.desarrollo.pageTitle} subtitle={t.desarrollo.pageSubtitle}>
      <DesarrolloPanel />
    </ModuleShell>
  );
}
