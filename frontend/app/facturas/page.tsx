"use client";

import { FacturasPanel } from "../../components/FacturasPanel";
import { ModuleShell } from "../../components/ModuleShell";

export default function FacturasPage() {
  return (
    <ModuleShell moduleTitle="Facturas" subtitle="Facturas · calculadora de materiales">
      <FacturasPanel />
    </ModuleShell>
  );
}
