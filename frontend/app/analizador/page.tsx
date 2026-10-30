"use client";

import { AnalizadorPanel } from "../../components/AnalizadorPanel";
import { ModuleShell } from "../../components/ModuleShell";

export default function AnalizadorPage() {
  return (
    <ModuleShell moduleTitle="Analizador IA" subtitle="Revisa con un link si un contenido parece creado con IA">
      <AnalizadorPanel />
    </ModuleShell>
  );
}
