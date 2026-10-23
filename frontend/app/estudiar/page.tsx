"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { Panel } from "../../components/Panel";

export default function EstudiarPage() {
  return (
    <ModuleShell moduleTitle="Estudiar" subtitle="Academia">
      <Panel
        title="Academia"
        badge={
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
            Próximamente
          </span>
        }
      >
        <p className="text-sm leading-relaxed text-zinc-300">
          Academia — próximamente: aquí vivirán los cursos y PDFs.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
          En la Fase 2 este módulo será la casa de la Academia dentro de la plataforma:
          los cursos y los PDFs que hoy se entregan tras el pago se podrán consultar y
          entregar desde aquí, conectados con el CRM para saber qué compró cada alumno.
          Todavía no hay contenido cargado en este módulo.
        </p>
      </Panel>
    </ModuleShell>
  );
}
