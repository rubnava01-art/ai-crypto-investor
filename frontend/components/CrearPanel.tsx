// Crear — shell (2026-11-17): CopyGenerator y TrendsPanel viven ahora en
// components/crear/ para reutilizarlos en el Content Engine; este archivo
// solo conserva el flujo 1-2-3 y el montaje, sin cambio de comportamiento.
"use client";

import { useEffect, useState } from "react";
import { api, type MeResponse } from "../lib/api";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { LogoGenerator } from "./LogoGenerator";
import { ShirtMockupGenerator } from "./ShirtMockupGenerator";
import { CopyGenerator } from "./crear/CopyGenerator";
import { TrendsPanel } from "./crear/TrendsPanel";

export function CrearPanel() {
  const isCancelled = useCancelled();
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;
  const { t } = useLanguage();
  const flowSteps = [
    { n: "1", label: t.crear.trendsTitle },
    { n: "2", label: t.crear.copyTitle },
    { n: "3", label: t.nav.crm.label },
  ];

  useEffect(() => {
    api.me().then((v) => { if (!isCancelled()) setMe(v); }).catch(() => { if (!isCancelled()) setMe(null); });
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          {t.crear.flowLabel}
        </p>
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {flowSteps.map((s) => (
            <li key={s.n} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3.5 py-3">
              <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">{s.n}</span>
              <span className="text-sm font-semibold text-zinc-100">{s.label}</span>
            </li>
          ))}
        </ol>
      </div>
      <CopyGenerator isAdmin={isAdmin} />
      <LogoGenerator />
      <ShirtMockupGenerator />
      <TrendsPanel isAdmin={isAdmin} />
    </div>
  );
}
