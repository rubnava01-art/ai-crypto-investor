"use client";

import { PrivacidadPanel } from "../../components/PrivacidadPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function PrivacidadPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.privacidad.title} subtitle={t.privacidad.subtitle}>
      <PrivacidadPanel />
    </ModuleShell>
  );
}
