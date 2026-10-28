"use client";

import { RecomendacionesPanel } from "../../components/RecomendacionesPanel";
import { ModuleShell } from "../../components/ModuleShell";

export default function RecomendacionesPage() {
  return (
    <ModuleShell moduleTitle="Recomendaciones" subtitle="Cursos y herramientas recomendadas">
      <RecomendacionesPanel />
    </ModuleShell>
  );
}
