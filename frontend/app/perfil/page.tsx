"use client";

import dynamic from "next/dynamic";
import { PerfilPanel } from "../../components/PerfilPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { PanelLoading } from "../../components/ui";
import { useLanguage } from "../../lib/i18n";

// C4 (optimización 2026-11-14): AnalisisPersonalPanel (267 líneas + los
// 22,7 KB de textos de encuesta en analisis-personal-texts.ts, que solo
// él importa) vive bajo el pliegue, tras el PerfilPanel; se descarga al
// renderizar, con skeleton. Es UI local sin peticiones propias.
const AnalisisPersonalPanel = dynamic(
  () => import("../../components/AnalisisPersonalPanel").then((m) => m.AnalisisPersonalPanel),
  { ssr: false, loading: PanelLoading },
);

export default function PerfilPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.nav.perfil.label} subtitle={t.nav.perfil.hint}>
      <div className="space-y-5 pb-28">
        <PerfilPanel />
        <AnalisisPersonalPanel />
      </div>
    </ModuleShell>
  );
}
