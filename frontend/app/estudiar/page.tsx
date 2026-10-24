"use client";

import { AcademyPanel } from "../../components/AcademyPanel";
import { ModuleShell } from "../../components/ModuleShell";

export default function EstudiarPage() {
  return (
    <ModuleShell moduleTitle="Estudiar" subtitle="Academia">
      <AcademyPanel />
    </ModuleShell>
  );
}
