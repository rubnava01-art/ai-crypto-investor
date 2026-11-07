"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { FlujosPanel } from "../../components/FlujosPanel";
import { useLanguage } from "../../lib/i18n";

/** Módulo Flujos (2026-11-06): constructor visual de automatizaciones.
 * Todo en el navegador (localStorage `grow-flows`): sin backend y con
 * ejecución solo en simulación — nada real se envía ni se ejecuta. */
export default function FlujosPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.flujos.title} subtitle={t.flujos.subtitle}>
      <FlujosPanel />
    </ModuleShell>
  );
}
