"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { BusinessPanel } from "../../components/BusinessPanel";

export default function BusinessPage() {
  return (
    <ModuleShell moduleTitle="Business" subtitle="Marketing · Ventas · Legal · Administrativo — cada área con sus propias notas y tareas">
      <BusinessPanel />
    </ModuleShell>
  );
}
