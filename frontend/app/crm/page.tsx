"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { CrmPanel } from "../../components/CrmPanel";

export default function CrmPage() {
  return (
    <ModuleShell moduleTitle="CRM" subtitle="Contactos y clientes de todos tus negocios">
      <CrmPanel />
    </ModuleShell>
  );
}
