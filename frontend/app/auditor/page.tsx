"use client";

import { AuditorPanel } from "../../components/AuditorPanel";
import { ModuleShell } from "../../components/ModuleShell";

export default function AuditorPage() {
  return (
    <ModuleShell moduleTitle="Auditor web" subtitle="Velocidad medida + revisión SEO de una página">
      <AuditorPanel />
    </ModuleShell>
  );
}
