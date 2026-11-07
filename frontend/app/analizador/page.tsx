"use client";

import { AnalizadorPanel } from "../../components/AnalizadorPanel";
import { SocialAnalyzerPanel } from "../../components/SocialAnalyzerPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

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
