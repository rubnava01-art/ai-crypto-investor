// Sub-sección "Contenido" de Negocio > Marketing (NEST, 2026-11-17).
// Flujo propio: Ideas → Calendario → Copies (plantilla) → Creatividades.
// Reutiliza CopyGenerator/TrendsPanel de /crear y los generadores de
// logo/mockup tal cual; el flujo 1-2-3 de /crear no se toca.
"use client";

import { useEffect, useRef, useState } from "react";
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
import { BrandBriefTab } from "./BrandBriefTab";

type Tab = "brief" | "ideas" | "calendario" | "plantillas" | "copies" | "tendencias" | "creatividades";

export function ContentEnginePanel({ me, isAdmin }: { me: MeResponse | null; isAdmin: boolean }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>("brief");
  // Estado del brief que se está viendo (lo reporta BrandBriefTab): el
  // chip de la pestaña Brief lo lee sin entrar. null = sin brief en vista.
  const [briefStatus, setBriefStatus] = useState<{ answered: number } | null>(null);
  const tabsRowRef = useRef<HTMLDivElement | null>(null);
  const tabs: { value: Tab; label: string }[] = [
    { value: "brief", label: t.contenido.tabsBrief },
    { value: "ideas", label: t.contenido.tabsIdeas },
    { value: "calendario", label: t.contenido.tabsCalendar },
    { value: "plantillas", label: t.contenido.tabsTemplates },
    { value: "copies", label: t.contenido.tabsCopies },
    { value: "tendencias", label: t.contenido.tabsTrends },
    { value: "creatividades", label: t.contenido.tabsCreatives },
  ];
  // La pestaña activa siempre queda a la vista dentro del scroll
  // horizontal de una fila (en móvil las 7 no caben a la vez).
  useEffect(() => {
    tabsRowRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [tab]);
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-zinc-400">{t.contenido.intro}</p>
      <div ref={tabsRowRef} className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t.contenido.panelTitle}>
        {tabs.map((tb) => (
          <button
            key={tb.value}
            role="tab"
            aria-selected={tab === tb.value}
            onClick={() => setTab(tb.value)}
            className={
              tab === tb.value
                // Nivel 3 (regla en BusinessPanel.tsx): sky oscuro.
                ? "flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-sky-800 px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
                : "flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
            }
          >
            {tb.label}
            {tb.value === "brief" && (
              <span
                className={
                  briefStatus && briefStatus.answered > 0
                    ? "rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300"
                    : "rounded-full bg-zinc-500/20 px-2 py-0.5 text-xs font-semibold text-zinc-400"
                }
              >
                {!briefStatus || briefStatus.answered === 0
                  ? t.brief.noBrief
                  : briefStatus.answered >= 8
                    ? t.brief.complete
                    : t.brief.progressCount.replace("{n}", String(briefStatus.answered))}
              </span>
            )}
          </button>
        ))}
      </div>
      {tab === "brief" && <BrandBriefTab isAdmin={isAdmin} surface="engine" onBriefStatus={setBriefStatus} />}
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
