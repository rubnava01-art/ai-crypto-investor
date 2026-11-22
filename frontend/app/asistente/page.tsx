"use client";

import { AsistentePanel } from "../../components/AsistenteChat";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function AsistentePage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.asistente.title} subtitle={t.asistente.subtitle}>
      <AsistentePanel />
    </ModuleShell>
  );
}
