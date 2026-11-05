"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { TerminalPanel } from "../../components/TerminalPanel";

/** Módulo Terminal (2026-11-05): consola de pruebas dentro de la web.
 * Terminal SIMULADA con comandos integrados seguros (help, status,
 * health, modules, about, date, echo, clear): no ejecuta nada en el
 * servidor y no hay endpoint de ejecución. Solo administradores
 * (entrada adminOnly en el menú). El título y el subtítulo van en
 * texto fijo porque no hay clave de diccionario para terminal. */
export default function TerminalPage() {
  return (
    <ModuleShell moduleTitle="Terminal" subtitle="Consola de pruebas con comandos seguros.">
      <TerminalPanel />
    </ModuleShell>
  );
}
