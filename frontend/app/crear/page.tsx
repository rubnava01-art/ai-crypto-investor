"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { Panel } from "../../components/Panel";

const FORGE_URL = "https://rubnava01-art.github.io/New/";

export default function CrearPage() {
  return (
    <ModuleShell moduleTitle="Crear" subtitle="Forge · copies · tendencias">
      <div className="space-y-4">
        <Panel
          title="NEST Forge AI"
          badge={
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
              En vivo
            </span>
          }
        >
          <p className="text-sm leading-relaxed text-zinc-300">
            Tu constructor de aplicaciones con IA ya está en vivo como producto aparte.
            Desde aquí lo abres en una pestaña nueva; sigue siendo local-first (tus
            proyectos se guardan en tu navegador).
          </p>
          <a
            href={FORGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Abrir NEST Forge AI ↗
          </a>
          <p className="mt-2 font-mono text-xs text-zinc-500">{FORGE_URL}</p>
        </Panel>

        <Panel
          title="Generador de copies e investigación de tendencias"
          badge={
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
              Próximamente
            </span>
          }
        >
          <p className="text-sm leading-relaxed text-zinc-500">
            En la Fase 3 vivirán aquí el generador de copies con la capa de IA y el panel
            de investigación de tendencias: la tendencia alimenta el copy, el copy trae
            leads y los leads caen directo en el CRM. Este módulo todavía no está
            construido.
          </p>
        </Panel>
      </div>
    </ModuleShell>
  );
}
