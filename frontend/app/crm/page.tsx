"use client";

import { useState } from "react";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";
import { CrmPanel } from "../../components/CrmPanel";
import { CrmDashboard } from "../../components/CrmDashboard";

export default function CrmPage() {
  const { t } = useLanguage();
  // La búsqueda vive en la barra superior del dashboard (estilo Vivero) y
  // filtra la misma lista del panel: un solo estado, dos vistas.
  const [query, setQuery] = useState("");
  return (
    <ModuleShell moduleTitle={t.crm.title} subtitle={t.crm.subtitle}>
      <CrmDashboard query={query} onQueryChange={setQuery} />
      <CrmPanel query={query} onQueryChange={setQuery} />
    </ModuleShell>
  );
}
