// Selector de cliente para la vista previa del admin (NEST, 2026-11-17).
// Solo admin. Usa SOLO el endpoint de portal /portal/vinculos (que lista
// los contactos con su estado de vínculo); nunca listContacts general.
"use client";

import { api, type PortalVinculo } from "../../lib/api";
import { ApiErrorBanner, Field } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

export function PortalClientPicker({
  selectedId,
  onSelect,
}: {
  selectedId?: number;
  onSelect: (contactId: number | null) => void;
}) {
  const { t } = useLanguage();
  const load = useAsyncLoad<PortalVinculo[]>(
    (signal) => api.listVinculos({ signal }),
    [],
  );
  const vinculos = load.data ?? [];

  if (load.loading) {
    return <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.portal.loading}</p>;
  }
  if (load.error) {
    return <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />;
  }
  return (
    <Field label={t.portal.pickClientAria}>
      <select
        aria-label={t.portal.pickClientAria}
        className={inputCls}
        value={selectedId ? String(selectedId) : ""}
        onChange={(e) => onSelect(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{t.portal.pickClientOption}</option>
        {vinculos.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} — {v.user_id ? t.portal.linked : t.portal.notLinked}
          </option>
        ))}
      </select>
    </Field>
  );
}
