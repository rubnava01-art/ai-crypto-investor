"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { ReferidosPanel } from "../../components/ReferidosPanel";

export default function ReferidosPage() {
  return (
    <ModuleShell moduleTitle="Referidos" subtitle="Campañas de recomendación con recompensas para conseguir nuevos clientes">
      <ReferidosPanel />
    </ModuleShell>
  );
}
