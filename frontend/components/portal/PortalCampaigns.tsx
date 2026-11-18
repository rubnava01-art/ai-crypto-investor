// Campañas del portal (NEST, 2026-11-17): solo lectura, solo lo propio.
// Solo endpoints /api/business/marketing/portal/* — nunca crmApi,
// facturasApi ni referidosApi. El backend devuelve formas reducidas
// (ver PortalCampaignsResponse en lib/api/types.ts).
"use client";

import { api, type PortalCampaignsResponse } from "../../lib/api";
import { Panel } from "../Panel";
import { ApiErrorBanner } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";
import { formatDate, formatMoney } from "../../lib/format";

export function PortalCampaigns({ contactId }: { contactId?: number }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const load = useAsyncLoad<PortalCampaignsResponse>(
    (signal) => api.listPortalCampaigns(contactId, { signal }),
    [contactId],
  );
  const data = load.data;
  const total = (data?.referidos.length ?? 0) + (data?.campanas.length ?? 0);

  return (
    <Panel title={t.portal.tabsCampaigns} badge={<span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">{total}</span>}>
      {load.loading ? (
        <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.portal.loading}</p>
      ) : load.error ? (
        <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
      ) : !data || total === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-center">
          <p className="text-sm text-zinc-400">{t.portal.emptyCampaigns}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {data.referidos.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.portal.referralsTitle}</h3>
              <ul className="space-y-2">
                {data.referidos.map((c) => (
                  <li key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                    <p className="text-sm font-semibold text-zinc-100">{c.name}</p>
                    <p className="text-xs text-zinc-400">
                      {c.status} · {c.share_code} · {c.reward_type} {formatMoney(c.reward_value, "USD", locale)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.campanas.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.portal.marketingTitle}</h3>
              <ul className="space-y-2">
                {data.campanas.map((c) => (
                  <li key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                    <p className="text-sm font-semibold text-zinc-100">{c.name}</p>
                    <p className="text-xs text-zinc-400">
                      {c.channel} · {c.status} · {t.citas.spendLabel}: {formatMoney(c.spend, "USD", locale)}
                      {c.starts_on ? ` · ${formatDate(c.starts_on, locale) ?? ""}` : ""}
                      {c.ends_on ? ` → ${formatDate(c.ends_on, locale) ?? ""}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
