// Sub-sección "Marketing y citas" de Negocio > Marketing (NEST, 2026-11-17).
// Pestañas internas: Citas · Campañas.
"use client";

import { useState } from "react";
import type { MeResponse } from "../../lib/api";
import { useLanguage } from "../../lib/i18n";
import { AppointmentsPanel } from "./AppointmentsPanel";
import { CampaignsList } from "./CampaignsList";

export function MarketingPanel({ me, isAdmin }: { me: MeResponse | null; isAdmin: boolean }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<"citas" | "campanas">("citas");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t.citas.panelTitle}>
        {(["citas", "campanas"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={tab === v}
            onClick={() => setTab(v)}
            className={
              tab === v
                ? "min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                : "min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            }
          >
            {v === "citas" ? t.citas.tabsAppointments : t.citas.tabsCampaigns}
          </button>
        ))}
      </div>
      {tab === "citas" ? (
        <AppointmentsPanel me={me} isAdmin={isAdmin} />
      ) : (
        <CampaignsList isAdmin={isAdmin} />
      )}
    </div>
  );
}
