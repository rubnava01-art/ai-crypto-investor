"use client";

import { TendenciasPanel } from "../../components/TendenciasPanel";
import { ModuleShell } from "../../components/ModuleShell";

export default function TendenciasPage() {
  return (
    <ModuleShell moduleTitle="Tendencias" subtitle="Investiga palabras para tendencias y campañas">
      <TendenciasPanel />
    </ModuleShell>
  );
}
