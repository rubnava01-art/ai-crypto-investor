"use client";

import { FacturasPanel } from "../../components/FacturasPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function FacturasPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.facturas.title} subtitle={t.facturas.subtitle}>
      <FacturasPanel />
    </ModuleShell>
  );
}
