"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";
import { TalentoPanel } from "../../components/TalentoPanel";

export default function TalentoPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.talento.title} subtitle={t.talento.subtitle}>
      <TalentoPanel />
    </ModuleShell>
  );
}
