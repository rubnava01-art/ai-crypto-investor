"use client";

import { AcademyPanel } from "../../components/AcademyPanel";
import { ClasesPanel } from "../../components/ClasesPanel";
import { JuegoPanel } from "../../components/JuegoPanel";
import { VideosPanel } from "../../components/VideosPanel";
import { ManualesPanel } from "../../components/ManualesPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function EstudiarPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.academy.pageTitle} subtitle={t.academy.pageSubtitle}>
      <div className="space-y-4">
        <ManualesPanel />
        <JuegoPanel />
      <VideosPanel />
        <AcademyPanel />
        <ClasesPanel />
      </div>
    </ModuleShell>
  );
}
