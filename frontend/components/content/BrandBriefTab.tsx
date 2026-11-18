// Pestaña "Brief" del Test exprés para Brief de Marca (NEST, 2026-11-17).
// Un solo componente para las dos superficies:
// - Content Engine (admin): selector de cliente (GET /contenido/briefs,
//   progreso por cliente) + edición por /contenido/briefs/{id}.
// - Content Engine (cliente vinculado): su propio brief por el portal.
// - Client Portal: su propio brief por el portal; admin en vista previa
//   con ?contact_id= (contactId prop).
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, ApiError,
  type BrandBrief, type BrandBriefInput, type BrandBriefSummary,
} from "../../lib/api";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";
import { ApiErrorBanner, Field } from "../ui";
import { Panel } from "../Panel";
import { EmptyState } from "../badges";
import { BrandBriefForm } from "./BrandBriefForm";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

export function BrandBriefTab({
  isAdmin,
  surface,
  previewContactId,
  onBriefStatus,
}: {
  isAdmin: boolean;
  /** "engine": selector admin propio; "portal": el contacto viene del portal. */
  surface: "engine" | "portal";
  previewContactId?: number;
  /** Informa al padre (Content Engine) del brief que se está viendo,
   * para el chip de estado de la pestaña Brief. */
  onBriefStatus?: (status: { answered: number } | null) => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>("");
  const [brief, setBrief] = useState<BrandBrief | null>(null);

  // Al cambiar de cliente, el brief guardado en estado local ya no vale.
  useEffect(() => {
    setBrief(null);
  }, [selectedId, previewContactId, surface]);

  // Admin en Content Engine: lista de clientes con progreso del brief.
  const listLoad = useAsyncLoad<BrandBriefSummary[]>(
    (signal) =>
      isAdmin && surface === "engine"
        ? api.listBriefs({ signal })
        : Promise.resolve([]),
    [isAdmin, surface],
  );
  const summaries = listLoad.data ?? [];
  const selectedSummary = summaries.find((s) => s.contact_id === Number(selectedId));

  // Carga del brief: admin/engine por /contenido/briefs/{id}; resto por
  // el portal (cliente propio, o admin en vista previa ?contact_id=).
  const briefLoad = useAsyncLoad<BrandBrief | null>(
    async (signal) => {
      if (isAdmin && surface === "engine") {
        if (!selectedId) return null;
        return api.getBrief(Number(selectedId), { signal });
      }
      if (surface === "portal" && isAdmin && previewContactId === undefined) {
        return null;
      }
      return api.getPortalBrief(
        surface === "portal" ? previewContactId : undefined,
        { signal },
      );
    },
    [isAdmin, surface, selectedId, previewContactId],
  );

  // El formulario reacciona al brief cargado (useEffect interno).
  const formBrief = briefLoad.data ?? brief;
  const contactName =
    formBrief?.contact_name ?? selectedSummary?.contact_name ?? "";

  // Chip de estado (M6): el padre muestra "Sin brief" / "X de 8" /
  // "Brief completo" según el brief en vista; sin brief, null.
  useEffect(() => {
    if (!onBriefStatus) return;
    onBriefStatus(formBrief ? { answered: formBrief.answered } : null);
  }, [formBrief, onBriefStatus]);

  const save = async (answers: BrandBriefInput): Promise<BrandBrief> => {
    let saved: BrandBrief;
    if (isAdmin && surface === "engine" && selectedId) {
      saved = await api.saveBrief(Number(selectedId), answers);
    } else if (surface === "portal" && isAdmin) {
      saved = await api.savePortalBrief(answers, previewContactId);
    } else {
      saved = await api.savePortalBrief(answers);
    }
    setBrief(saved);
    return saved;
  };

  if (isAdmin && surface === "engine") {
    if (listLoad.loading) {
      return <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.brief.loadingBriefs}</p>;
    }
    if (listLoad.error) {
      return <ApiErrorBanner error={listLoad.error} t={t} onRetry={listLoad.reload} />;
    }
    if (summaries.length === 0) {
      // Sin clientes no hay brief que crear: la acción lleva al CRM,
      // donde se da de alta el primer cliente.
      return (
        <EmptyState
          text={t.brief.emptyBriefs}
          actionLabel={t.brief.createBrief}
          onAction={() => router.push("/crm")}
        />
      );
    }
    if (!selectedId) {
      return (
        <Panel title={t.brief.panelTitle}>
          <p className="mb-3 text-sm leading-relaxed text-zinc-400">{t.brief.intro}</p>
          <Field label={t.brief.pickClient}>
            <select
              aria-label={t.brief.pickClient}
              className={inputCls}
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">{t.brief.pickClientOption}</option>
              {summaries.map((s) => (
                <option key={s.contact_id} value={s.contact_id}>
                  {s.contact_name} ({s.answered}/8)
                </option>
              ))}
            </select>
          </Field>
        </Panel>
      );
    }
  }

  if (briefLoad.loading) {
    return <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.brief.loading}</p>;
  }
  if (briefLoad.error) {
    return <ApiErrorBanner error={briefLoad.error} t={t} onRetry={briefLoad.reload} />;
  }
  if (!formBrief) {
    return <EmptyState text={t.brief.noClientSelected} />;
  }
  return (
    <>
      {isAdmin && surface === "engine" && (
        <div className="mb-4">
          <Field label={t.brief.pickClient}>
            <select
              aria-label={t.brief.pickClient}
              className={inputCls}
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {summaries.map((s) => (
                <option key={s.contact_id} value={s.contact_id}>
                  {s.contact_name} ({s.answered}/8)
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <BrandBriefForm brief={formBrief} contactName={contactName} onSave={save} />
    </>
  );
}
