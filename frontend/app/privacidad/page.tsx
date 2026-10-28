"use client";

import { PrivacidadPanel } from "../../components/PrivacidadPanel";
import { ModuleShell } from "../../components/ModuleShell";

export default function PrivacidadPage() {
  return (
    <ModuleShell moduleTitle="Privacidad y cumplimiento" subtitle="Políticas, datos, accesibilidad y cumplimiento">
      <PrivacidadPanel />
    </ModuleShell>
  );
}
