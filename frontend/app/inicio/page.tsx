"use client";

import { InicioPanel } from "../../components/InicioPanel";
import { ModuleShell } from "../../components/ModuleShell";

export default function InicioPage() {
  return (
    <ModuleShell moduleTitle="Inicio" subtitle="Noticias y actualizaciones de la plataforma">
      <InicioPanel />
    </ModuleShell>
  );
}
