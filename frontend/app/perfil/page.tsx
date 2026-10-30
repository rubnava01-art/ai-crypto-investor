"use client";

import { PerfilPanel } from "../../components/PerfilPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function PerfilPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.nav.perfil.label} subtitle={t.nav.perfil.hint}>
      <PerfilPanel />
    </ModuleShell>
  );
}
