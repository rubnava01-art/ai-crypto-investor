"use client";

import { PerfilPanel } from "../../components/PerfilPanel";
import { ModuleShell } from "../../components/ModuleShell";

export default function PerfilPage() {
  return (
    <ModuleShell moduleTitle="Mi perfil" subtitle="Foto y datos del usuario">
      <PerfilPanel />
    </ModuleShell>
  );
}
