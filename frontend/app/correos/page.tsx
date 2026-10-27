"use client";

import { CorreosPanel } from "../../components/CorreosPanel";
import { ModuleShell } from "../../components/ModuleShell";

export default function CorreosPage() {
  return (
    <ModuleShell moduleTitle="Correos" subtitle="Plantillas · redacción con datos del CRM · registro">
      <CorreosPanel />
    </ModuleShell>
  );
}
