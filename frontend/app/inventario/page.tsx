"use client";

import { InventarioPanel } from "../../components/InventarioPanel";
import { ModuleShell } from "../../components/ModuleShell";

export default function InventarioPage() {
  return (
    <ModuleShell moduleTitle="Inventario" subtitle="Control de stock">
      <InventarioPanel />
    </ModuleShell>
  );
}
