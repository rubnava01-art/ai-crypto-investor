"use client";

import { AcademyPanel } from "../../components/AcademyPanel";
import { ClasesPanel } from "../../components/ClasesPanel";
import { ModuleShell } from "../../components/ModuleShell";

export default function EstudiarPage() {
  return (
    <ModuleShell moduleTitle="Estudiar" subtitle="Academia · clases grabadas · clases en vivo">
      <div className="space-y-4">
        <AcademyPanel />
        <ClasesPanel />
      </div>
    </ModuleShell>
  );
}
