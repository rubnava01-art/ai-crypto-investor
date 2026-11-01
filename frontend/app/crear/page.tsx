"use client";

import { CrearPanel } from "../../components/CrearPanel";
import { useLanguage } from "../../lib/i18n";
import { ModuleShell } from "../../components/ModuleShell";
import { Panel } from "../../components/Panel";

const FORGE_URL = "https://rubnava01-art.github.io/New/";

export default function CrearPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.crear.title} subtitle={t.crear.subtitle}>
      <div className="space-y-4">
        <Panel
          title={t.crear.forgeTitle}
          badge={
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
              {t.crear.forgeBadge}
            </span>
          }
        >
          <p className="text-sm leading-relaxed text-zinc-300">
            {t.crear.forgeDesc}
          </p>
          <a
            href={FORGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block rounded-lg bg-emerald-600 min-h-[44px] px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            {t.crear.forgeOpen}
          </a>
          <p className="mt-2 font-mono text-xs text-zinc-400">{FORGE_URL}</p>
        </Panel>

        <CrearPanel />
      </div>
    </ModuleShell>
  );
}
