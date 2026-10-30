"use client";

import { InventarioPanel } from "../../components/InventarioPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function InventarioPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.inventario.title} subtitle={t.inventario.subtitle}>
      <InventarioPanel />
    </ModuleShell>
  );
}
