// Plantillas por reglas + generación desde plantilla (NEST, 2026-11-17).
// Las plantillas NO llaman al modelo de IA: el servidor rellena las
// variables {{tema}} {{negocio}} {{llamada}} por reglas y devuelve
// source "plantilla". Etiqueta obligatoria: "Plantilla (reglas), no IA".
"use client";

import { useState } from "react";
import {
  api, ApiError,
  type BrandBrief, type BrandBriefSummary, type ContentPlatform, type ContentTemplate, type TemplateGeneration,
} from "../../lib/api";
import { Panel } from "../Panel";
import { EmptyState } from "../badges";
import { ApiErrorBanner, Field, copyTextWithFallback, isAdminOnlyForbidden, useConfirm } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";
import { BriefContextCard } from "./BriefContextCard";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

const PLATFORMS: ContentPlatform[] = ["instagram", "threads", "facebook"];
const TONES = ["directo", "educativo", "divertido", "profesional"];

export function CopyTemplatePicker({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useLanguage();
  const { confirm, dialog } = useConfirm(t);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ContentTemplate | null>(null);
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<ContentPlatform>("instagram");
  const [tone, setTone] = useState("directo");
  const [body, setBody] = useState("");
  const [maxChars, setMaxChars] = useState("500");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Generación
  const [selectedId, setSelectedId] = useState<string>("");
  const [tema, setTema] = useState("");
  const [negocio, setNegocio] = useState("");
  const [llamada, setLlamada] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<TemplateGeneration | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useAsyncLoad<ContentTemplate[]>(
    (signal) => api.listTemplates({ signal }),
    [],
  );
  const templates = load.data ?? [];
  // H1 (2026-11-17): cliente vinculado → 403 (S1): estado amable en vez
  // del banner rojo, sin reintento.
  const forbidden = isAdminOnlyForbidden(load.error, isAdmin);

  // Brief de marca como contexto visible para generar: el admin elige
  // el cliente; el cliente vinculado ve su propio brief. Sin vínculo
  // (403) o sin brief, el bloque no estorba: no se muestra.
  const briefListLoad = useAsyncLoad<BrandBriefSummary[]>(
    (signal) => (isAdmin ? api.listBriefs({ signal }) : Promise.resolve([])),
    [isAdmin],
  );
  const briefSummaries = briefListLoad.data ?? [];
  const [briefContactId, setBriefContactId] = useState("");
  const briefLoad = useAsyncLoad<BrandBrief | null>(
    async (signal) => {
      if (isAdmin) {
        if (!briefContactId) return null;
        return api.getBrief(Number(briefContactId), { signal });
      }
      try {
        return await api.getPortalBrief(undefined, { signal });
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) return null;
        throw err;
      }
    },
    [isAdmin, briefContactId],
  );
  const brief = briefLoad.data ?? null;

  const platformLabel = (p: ContentPlatform) =>
    p === "instagram" ? t.contenido.platformInstagram
    : p === "threads" ? t.contenido.platformThreads
    : t.contenido.platformFacebook;

  const toneLabel = (v: string) =>
    v === "directo" ? t.contenido.toneDirecto
    : v === "educativo" ? t.contenido.toneEducativo
    : v === "divertido" ? t.contenido.toneDivertido
    : t.contenido.toneProfesional;

  const openForm = (tpl?: ContentTemplate) => {
    setMsg(null);
    setFormError(null);
    setEditing(tpl ?? null);
    setName(tpl?.name ?? "");
    setPlatform(tpl?.platform ?? "instagram");
    setTone(tpl?.tone ?? "directo");
    setBody(tpl?.body ?? "");
    setMaxChars(String(tpl?.max_chars ?? 500));
    setShowForm(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const max = Number(maxChars);
    if (!name.trim() || !body.trim() || !Number.isFinite(max) || max < 1) {
      setFormError(t.contenido.errSaveTemplate);
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await api.updateTemplate(editing.id, { name: name.trim(), platform, tone, body, max_chars: max });
        setMsg(t.contenido.msgTemplateUpdated);
      } else {
        await api.createTemplate({ name: name.trim(), platform, tone, body, max_chars: max });
        setMsg(t.contenido.msgTemplateCreated);
      }
      setShowForm(false);
      setEditing(null);
      load.reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.contenido.errSaveTemplate);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tpl: ContentTemplate) => {
    if (!(await confirm(t.contenido.confirmDeleteTemplate.replace("{nombre}", tpl.name)))) return;
    setActionError(null);
    setMsg(null);
    try {
      await api.deleteTemplate(tpl.id);
      setMsg(t.contenido.msgTemplateDeleted);
      load.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t.contenido.errDeleteTemplate);
    }
  };

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenError(null);
    setResult(null);
    if (!selectedId || !tema.trim()) {
      setGenError(t.contenido.errGenerate);
      return;
    }
    setGenerating(true);
    try {
      const out = await api.generateFromTemplate({
        template_id: Number(selectedId),
        variables: { tema: tema.trim(), negocio: negocio.trim() || undefined, llamada: llamada.trim() || undefined },
      });
      setResult(out);
    } catch (err) {
      setGenError(err instanceof ApiError ? err.message : t.contenido.errGenerate);
    } finally {
      setGenerating(false);
    }
  };

  const copyResult = async () => {
    if (result && (await copyTextWithFallback(result.text))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      {dialog}
      <Panel
        title={t.contenido.templatesTitle}
        badge={
          <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-300">
            {t.contenido.templateRulesLabel}
          </span>
        }
      >
        <p className="mb-3 text-xs leading-relaxed text-zinc-400">{t.contenido.templatesIntro}</p>

        {load.loading ? (
          <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.contenido.loadingTemplates}</p>
        ) : load.error ? (
          forbidden ? (
            <EmptyState text={t.reliability.adminOnlySection} />
          ) : (
            <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
          )
        ) : templates.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-center">
            <p className="text-sm text-zinc-400">{t.contenido.emptyTemplates}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {templates.map((tpl) => (
              <li key={tpl.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{tpl.name}</p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {platformLabel(tpl.platform)} · {toneLabel(tpl.tone)} · {tpl.max_chars} max
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{tpl.body}</p>
                    <p className="mt-1 text-xs text-zinc-500">{t.contenido.templateVars}</p>
                  </div>
                </div>
                {isAdmin && (
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => openForm(tpl)} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200">{t.contenido.editTemplate}</button>
                    <button type="button" onClick={() => remove(tpl)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-2 text-xs text-red-400">{t.contenido.delete}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {msg && <p className="mt-3 text-sm text-emerald-400">{msg}</p>}
        {actionError && <p role="alert" className="mt-3 text-sm text-red-400">{actionError}</p>}

        {isAdmin && (
          <div className="mt-4">
            {!showForm ? (
              <button
                type="button"
                onClick={() => openForm()}
                className="min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                {t.contenido.newTemplate}
              </button>
            ) : (
              <form onSubmit={submit} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <p className="text-sm font-semibold text-zinc-200">{editing ? t.contenido.editTemplate : t.contenido.newTemplate}</p>
                <Field label={t.contenido.templateNameAria}>
                  <input aria-label={t.contenido.templateNameAria} className={inputCls} placeholder={t.contenido.templateNamePlaceholder} value={name} onChange={(e) => setName(e.target.value)} required maxLength={128} autoComplete="off" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t.contenido.platformAria}>
                    <select aria-label={t.contenido.platformAria} className={inputCls} value={platform} onChange={(e) => setPlatform(e.target.value as ContentPlatform)}>
                      {PLATFORMS.map((p) => (
                        <option key={p} value={p}>{platformLabel(p)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t.contenido.templateToneAria}>
                    <select aria-label={t.contenido.templateToneAria} className={inputCls} value={tone} onChange={(e) => setTone(e.target.value)}>
                      {TONES.map((tn) => (
                        <option key={tn} value={tn}>{toneLabel(tn)}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label={t.contenido.templateBodyAria}>
                  <textarea aria-label={t.contenido.templateBodyAria} className={inputCls} rows={3} placeholder={t.contenido.templateBodyPlaceholder} value={body} onChange={(e) => setBody(e.target.value)} required />
                </Field>
                <Field label={t.contenido.maxCharsAria}>
                  <input aria-label={t.contenido.maxCharsAria} type="number" min={1} className={inputCls} value={maxChars} onChange={(e) => setMaxChars(e.target.value)} required />
                </Field>
                <p className="text-xs text-zinc-500">{t.contenido.templateVars}</p>
                {formError && <p role="alert" className="text-sm text-red-400">{formError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={busy} className="min-h-[44px] flex-1 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50">
                    {busy ? t.contenido.saving : t.contenido.saveTemplate}
                  </button>
                  <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
                    {t.contenido.cancel}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {templates.length > 0 && (
          <div className="mt-5 space-y-3 border-t border-zinc-800 pt-5">
            <p className="text-sm font-semibold text-zinc-200">{t.brief.contextTitle}</p>
            {isAdmin && briefSummaries.length > 0 && (
              <Field label={t.brief.pickClient}>
                <select
                  aria-label={t.brief.pickClient}
                  className={inputCls}
                  value={briefContactId}
                  onChange={(e) => setBriefContactId(e.target.value)}
                >
                  <option value="">{t.brief.pickClientOption}</option>
                  {briefSummaries.map((s) => (
                    <option key={s.contact_id} value={s.contact_id}>
                      {s.contact_name} ({s.answered}/8)
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {briefLoad.loading ? (
              <p role="status" className="text-sm text-zinc-400">{t.brief.loading}</p>
            ) : brief ? (
              <BriefContextCard brief={brief} onUseAsTema={(text) => setTema(text)} />
            ) : null}
          </div>
        )}

        {templates.length > 0 && (
          <form onSubmit={generate} className="mt-5 space-y-3 border-t border-zinc-800 pt-5">
            <p className="text-sm font-semibold text-zinc-200">{t.contenido.generateTitle}</p>
            <Field label={t.contenido.templatesTitle}>
              <select aria-label={t.contenido.templatesTitle} className={inputCls} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                <option value="">{t.contenido.templatesTitle}…</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>{tpl.name} ({platformLabel(tpl.platform)})</option>
                ))}
              </select>
            </Field>
            <Field label={t.contenido.varTemaAria}>
              <input aria-label={t.contenido.varTemaAria} className={inputCls} placeholder={t.contenido.varTemaPlaceholder} value={tema} onChange={(e) => setTema(e.target.value)} required maxLength={200} autoComplete="off" />
            </Field>
            <Field label={t.contenido.varNegocioAria}>
              <input aria-label={t.contenido.varNegocioAria} className={inputCls} placeholder={t.contenido.varNegocioPlaceholder} value={negocio} onChange={(e) => setNegocio(e.target.value)} maxLength={120} autoComplete="off" />
            </Field>
            <Field label={t.contenido.varLlamadaAria}>
              <input aria-label={t.contenido.varLlamadaAria} className={inputCls} placeholder={t.contenido.varLlamadaPlaceholder} value={llamada} onChange={(e) => setLlamada(e.target.value)} maxLength={200} autoComplete="off" />
            </Field>
            <button type="submit" disabled={generating || !selectedId || !tema.trim()} className="w-full min-h-[44px] rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50">
              {generating ? t.contenido.generating : t.contenido.generate}
            </button>
            {genError && <p role="alert" className="text-sm text-red-400">{genError}</p>}
            {result && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  {t.contenido.generatedResult} · <span className="text-sky-300">{t.contenido.templateRulesLabel}</span>
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{result.text}</p>
                {result.truncated && <p className="mt-2 text-xs text-amber-300">{t.contenido.truncatedNote}</p>}
                <button
                  type="button"
                  onClick={copyResult}
                  className="mt-3 min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                >
                  {copied ? t.contenido.copied : t.contenido.copyGenerated}
                </button>
              </div>
            )}
          </form>
        )}
      </Panel>
    </>
  );
}
