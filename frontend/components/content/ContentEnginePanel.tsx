// Sub-sección "Contenido" de Negocio > Marketing (NEST, 2026-11-17).
// Flujo propio: Ideas → Calendario → Copies (plantilla) → Creatividades.
// Reutiliza CopyGenerator/TrendsPanel de /crear y los generadores de
// logo/mockup tal cual; el flujo 1-2-3 de /crear no se toca.
"use client";

import { useState } from "react";
import type { MeResponse } from "../../lib/api";
import { useLanguage } from "../../lib/i18n";
import { Panel } from "../Panel";
import { CopyGenerator } from "../crear/CopyGenerator";
import { TrendsPanel } from "../crear/TrendsPanel";
import { LogoGenerator } from "../LogoGenerator";
import { ShirtMockupGenerator } from "../ShirtMockupGenerator";
import { IdeasBank } from "./IdeasBank";
import { ContentCalendar } from "./ContentCalendar";
import { CopyTemplatePicker } from "./CopyTemplatePicker";

type Tab = "ideas" | "calendario" | "plantillas" | "copies" | "tendencias" | "creatividades";

export function ContentEnginePanel({ me, isAdmin }: { me: MeResponse | null; isAdmin: boolean }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>("ideas");
  const tabs: { value: Tab; label: string }[] = [
    { value: "ideas", label: t.contenido.tabsIdeas },
    { value: "calendario", label: t.contenido.tabsCalendar },
    { value: "plantillas", label: t.contenido.tabsTemplates },
    { value: "copies", label: t.contenido.tabsCopies },
    { value: "tendencias", label: t.contenido.tabsTrends },
    { value: "creatividades", label: t.contenido.tabsCreatives },
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-zinc-400">{t.contenido.intro}</p>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t.contenido.panelTitle}>
        {tabs.map((tb) => (
          <button
            key={tb.value}
            role="tab"
            aria-selected={tab === tb.value}
            onClick={() => setTab(tb.value)}
            className={
              tab === tb.value
                ? "min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                : "min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            }
          >
            {tb.label}
          </button>
        ))}
      </div>
      {tab === "ideas" && <IdeasBank isAdmin={isAdmin} />}
      {tab === "calendario" && <ContentCalendar isAdmin={isAdmin} />}
      {tab === "plantillas" && <CopyTemplatePicker isAdmin={isAdmin} />}
      {tab === "copies" && <CopyGenerator isAdmin={isAdmin} />}
      {tab === "tendencias" && <TrendsPanel isAdmin={isAdmin} />}
      {tab === "creatividades" && (
        <Panel title={t.contenido.creativesTitle}>
          <div className="space-y-4">
            <LogoGenerator />
            <ShirtMockupGenerator />
          </div>
        </Panel>
      )}
      {!isAdmin && me && (
        <p className="text-xs text-zinc-400">{t.business.viewerNote}</p>
      )}
    </div>
  );
}
