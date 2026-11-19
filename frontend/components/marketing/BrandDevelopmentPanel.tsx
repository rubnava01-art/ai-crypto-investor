// Sub-pestaña "Desarrollo de marca" de Negocio > Marketing.
// Contenido central: el Test exprés para Brief de Marca (8 preguntas
// con sus ayudas "Qué buscamos") para analizar la marca de una empresa.
// Reutiliza BrandBriefTab (mismos datos y endpoints del brief:
// tabla brand_briefs; nada duplicado) y BriefContextCard (análisis:
// personalidad Q2, cliente ideal Q3, valores Q5). El formulario del
// brief ya trae su vista resumen con las 8 respuestas y el progreso X/8.
// El portal cliente no cambia: cada cliente solo ve su propio brief.
"use client";

import { useState } from "react";
import type { BrandBrief, MeResponse } from "../../lib/api";
import { useLanguage } from "../../lib/i18n";
import { BrandBriefTab } from "../content/BrandBriefTab";
import { BriefContextCard } from "../content/BriefContextCard";

export function BrandDevelopmentPanel({ me, isAdmin }: { me: MeResponse | null; isAdmin: boolean }) {
  const { t } = useLanguage();
  // Estado del brief en vista (lo reporta BrandBriefTab): el chip de
  // estado y la tarjeta de análisis lo leen sin entrar. null = sin brief.
  const [briefStatus, setBriefStatus] = useState<{ answered: number } | null>(null);
  const [brief, setBrief] = useState<BrandBrief | null>(null);
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-zinc-400">{t.business.brandDevIntro}</p>
      <p className="text-sm">
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
      </p>
      {brief && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-100">{t.business.brandDevAnalysisTitle}</h3>
          <p className="text-sm leading-relaxed text-zinc-400">{t.business.brandDevAnalysisIntro}</p>
          <BriefContextCard brief={brief} />
        </div>
      )}
      <BrandBriefTab
        isAdmin={isAdmin}
        surface="engine"
        onBriefStatus={setBriefStatus}
        onBrief={setBrief}
      />
      {!isAdmin && me && (
        <p className="text-xs text-zinc-400">{t.business.viewerNote}</p>
      )}
    </div>
  );
}
