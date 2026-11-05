"use client";

import { PerfilPanel } from "../../components/PerfilPanel";
import { AnalisisPersonalPanel } from "../../components/AnalisisPersonalPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function PerfilPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.nav.perfil.label} subtitle={t.nav.perfil.hint}>
      <div className="space-y-5">
        <PerfilPanel />
        <AnalisisPersonalPanel />
      </div>
    </ModuleShell>
  );
}
