// Facturas del portal (NEST, 2026-11-17): solo lectura, solo lo propio.
// Solo endpoints /api/business/marketing/portal/* — nunca crmApi,
// facturasApi ni referidosApi. El total lo calcula el servidor y viene
// en la respuesta (PortalInvoice.total); el frontend no suma conceptos.
"use client";

import { api, type PortalInvoice } from "../../lib/api";
import { Panel } from "../Panel";
import { ApiErrorBanner } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";
import { formatDate, formatMoney } from "../../lib/format";

export function PortalInvoices({ contactId }: { contactId?: number }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const load = useAsyncLoad<PortalInvoice[]>(
    (signal) => api.listPortalInvoices(contactId, { signal }),
    [contactId],
  );
  const invoices = load.data ?? [];

  const statusLabel = (s: PortalInvoice["status"]) =>
    s === "borrador" ? t.portal.statusDraft
    : s === "enviada" ? t.portal.statusSent
    : t.portal.statusPaid;

  return (
    <Panel title={t.portal.tabsInvoices} badge={<span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">{invoices.length}</span>}>
      {load.loading ? (
        <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.portal.loading}</p>
      ) : load.error ? (
        <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
      ) : invoices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-center">
          <p className="text-sm text-zinc-400">{t.portal.emptyInvoices}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {invoices.map((inv) => (
            <li key={inv.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{t.portal.invoiceNumber} {inv.number}</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {formatDate(inv.created_at, locale) ?? ""} · {t.portal.invoiceStatus}: {statusLabel(inv.status)}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold text-zinc-100">{formatMoney(inv.total, "USD", locale)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
