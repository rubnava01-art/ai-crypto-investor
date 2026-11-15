"use client";

import dynamic from "next/dynamic";
import { AnalizadorPanel } from "../../components/AnalizadorPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { PanelLoading } from "../../components/ui";
import { useLanguage } from "../../lib/i18n";

// C4 (optimización 2026-11-14): SocialAnalyzerPanel (496 líneas, solo
// localStorage + heurística, sin peticiones) vive bajo el pliegue, tras
// el AnalizadorPanel; se descarga al renderizar, con skeleton. No
// comparte estado con AnalizadorPanel.
const SocialAnalyzerPanel = dynamic(
  () => import("../../components/SocialAnalyzerPanel").then((m) => m.SocialAnalyzerPanel),
  { ssr: false, loading: PanelLoading },
);

export default function AnalizadorPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.analizador.pageTitle} subtitle={t.analizador.pageSubtitle}>
      <AnalizadorPanel />
      <div className="mt-6">
        <SocialAnalyzerPanel />
      </div>
    </ModuleShell>
  );
}
