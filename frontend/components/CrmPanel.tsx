"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  api, ApiError,
  type CrmContact, type CrmContactInput, type CrmReminder, type CrmSource, type CrmStage, type CrmStageHistory, type CrmStatus, type MeResponse,
} from "../lib/api";
import { Panel } from "./Panel";
import { EmptyState } from "./badges";
import { ListSkeleton } from "./Skeleton";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { ApiErrorBanner, isAdminOnlyForbidden, useConfirm, Field } from "./ui";

// Carga diferida (optimización): Historial y Asistente van debajo del panel
// principal del CRM, fuera de la vista inicial — se descargan solo cuando
// la página CRM se renderiza, con el mismo patrón dynamic de app/page.tsx.
// El panel CRM principal no cambia de comportamiento.
// Esqueleto de carga diferida con nombre accesible (corrección QA
// 2026-11-25): el `loading` de dynamic() corre fuera del componente,
// así que el propio esqueleto lee la traducción con useLanguage —
// nunca se hardcodea español aquí (mismo patrón que loading.tsx).
function CrmLazyLoading() {
  const { t } = useLanguage();
  return <ListSkeleton rows={2} ariaLabel={t.misc.loadingAria} />;
}

const CrmHistorial = dynamic(
  () => import("./CrmHistorial").then((m) => m.CrmHistorial),
  { loading: () => <CrmLazyLoading /> },
);
const CrmAsistente = dynamic(
  () => import("./CrmAsistente").then((m) => m.CrmAsistente),
  { loading: () => <CrmLazyLoading /> },
);

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

export const CRM_SOURCES: { value: CrmSource; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "academia", label: "Academia" },
  { value: "cohley", label: "Cohley" },
  { value: "rivgoods", label: "RIV Goods" },
  { value: "otro", label: "Otro" },
];

export const CRM_STATUSES: { value: CrmStatus; label: string }[] = [
  { value: "nuevo", label: "Nuevo" },
  { value: "contactado", label: "Contactado" },
  { value: "interesado", label: "Interesado" },
  { value: "cliente", label: "Cliente" },
  { value: "inactivo", label: "Inactivo" },
];

// Etapas de venta (Fase 5b mejoras-v1, tarea 1): embudo propio, distinto
// del estado general. "ganado"/"perdido" cierran el embudo.
export const CRM_STAGES: { value: CrmStage; label: string }[] = [
  { value: "nuevo", label: "Nuevo" },
  { value: "contactado", label: "Contactado" },
  { value: "propuesta", label: "Propuesta" },
  { value: "negociacion", label: "Negociación" },
  { value: "ganado", label: "Ganado" },
  { value: "perdido", label: "Perdido" },
];


const statusBadge: Record<string, string> = {
  nuevo: "bg-sky-500/15 text-sky-300",
  contactado: "bg-amber-500/15 text-amber-300",
  interesado: "bg-violet-500/15 text-violet-300",
  cliente: "bg-emerald-500/15 text-emerald-300",
  inactivo: "bg-zinc-500/15 text-zinc-400",
};

interface FormState {
  name: string;
  email: string;
  phone: string;
  source: CrmSource;
  status: CrmStatus;
  stage: CrmStage;
  tags: string; // comma-separated in the form
  notes: string;
}

const emptyForm: FormState = {
  name: "",
  email: "",
  phone: "",
  source: "manual",
  status: "nuevo",
  stage: "nuevo",
  tags: "",
  notes: "",
};

export function CrmPanel({
  query: controlledQuery,
  onQueryChange,
}: {
  /** Búsqueda controlada por el dashboard superior (CrmDashboard). Sin
   * estas props el panel usa su propio campo de búsqueda como antes. */
  query?: string;
  onQueryChange?: (q: string) => void;
} = {}) {
  const { t } = useLanguage();
  // Listas traducidas (los CRM_SOURCES/CRM_STATUSES exportados se conservan
  // en español solo por compatibilidad; el panel usa estas).
  const sources: { value: CrmSource; label: string }[] = [
    { value: "manual", label: t.crm.sourceManual },
    { value: "academia", label: t.crm.sourceAcademia },
    { value: "cohley", label: t.crm.sourceCohley },
    { value: "rivgoods", label: t.crm.sourceRivgoods },
    { value: "otro", label: t.crm.sourceOtro },
  ];
  const statuses: { value: CrmStatus; label: string }[] = [
    { value: "nuevo", label: t.crm.statusNuevo },
    { value: "contactado", label: t.crm.statusContactado },
    { value: "interesado", label: t.crm.statusInteresado },
    { value: "cliente", label: t.crm.statusCliente },
    { value: "inactivo", label: t.crm.statusInactivo },
  ];
  const sourceLabel = (s: string) => sources.find((x) => x.value === s)?.label ?? s;
  const statusLabel = (s: string) => statuses.find((x) => x.value === s)?.label ?? s;
  // Etapas de venta (Fase 5b mejoras-v1, tarea 1).
  const stages: { value: CrmStage; label: string }[] = [
    { value: "nuevo", label: t.crm.stageNuevo },
    { value: "contactado", label: t.crm.stageContactado },
    { value: "propuesta", label: t.crm.stagePropuesta },
    { value: "negociacion", label: t.crm.stageNegociacion },
    { value: "ganado", label: t.crm.stageGanado },
    { value: "perdido", label: t.crm.stagePerdido },
  ];
  const stageLabel = (s: string) => stages.find((x) => x.value === s)?.label ?? s;
  const stageBadge: Record<string, string> = {
    nuevo: "bg-sky-500/15 text-sky-300",
    contactado: "bg-amber-500/15 text-amber-300",
    propuesta: "bg-violet-500/15 text-violet-300",
    negociacion: "bg-orange-500/15 text-orange-300",
    ganado: "bg-emerald-500/15 text-emerald-300",
    perdido: "bg-zinc-500/15 text-zinc-400",
  };
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;

  const [contacts, setContacts] = useState<CrmContact[] | null>(null);
  const [queryInternal, setQueryInternal] = useState("");
  const query = controlledQuery ?? queryInternal;
  const setQuery = onQueryChange ?? setQueryInternal;
  const [statusFilter, setStatusFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  // Filtro por etiqueta (2026-11-20): en cliente sobre la página cargada
  // (la búsqueda y el estado ya filtran en el servidor); las etiquetas
  // disponibles salen de los contactos cargados.
  const allTags = Array.from(
    new Set((contacts ?? []).flatMap((c) => c.tags)),
  ).sort((a, b) => a.localeCompare(b));
  const visible = (contacts ?? []).filter(
    (c) => !tagFilter || c.tags.includes(tagFilter),
  );
  // Conteo filtrado (2026-11-23): con el filtro por etiqueta activo el
  // badge muestra "visibles / total", mismo patrón que Talento humano y
  // Planillas; sin filtro, solo el total como antes. La búsqueda y el
  // estado ya filtran en el servidor, así que el total cargado es el
  // de esa búsqueda/estado y solo la etiqueta recorta en cliente.
  const filteringByTag = tagFilter !== "";
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Tri-estado (Fase 4, FE3): un fallo de carga ya no se ve como "sin
  // contactos" — se conserva la lista anterior y se muestra el banner.
  const [loadError, setLoadError] = useState<unknown>(null);
  // H1 (2026-11-17): cliente vinculado → 403 (S1) en vez del banner rojo:
  // estado amable "solo para administradores", sin reintento.
  const forbidden = isAdminOnlyForbidden(loadError, isAdmin);
  const isCancelled = useCancelled();
  const { confirm, dialog } = useConfirm(t);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  // Recordatorios e historial de etapa del contacto en edición (Fase 5b,
  // tarea 1): solo se cargan al abrir la edición, no con la lista.
  const [reminders, setReminders] = useState<CrmReminder[] | null>(null);
  const [stageHistory, setStageHistory] = useState<CrmStageHistory[] | null>(null);
  const [reminderDate, setReminderDate] = useState("");
  const [reminderNote, setReminderNote] = useState("");
  // Importación CSV: resultado de la última importación (null = ninguna).
  const [csvResult, setCsvResult] = useState<{ creados: number; errores: { fila: number; error: string }[] } | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);

  useEffect(() => {
    api.me().then((m) => { if (!isCancelled()) setMe(m); }).catch(() => { if (!isCancelled()) setMe(null); });
  }, [isCancelled]);

  const load = useCallback(async () => {
    try {
      const rows = await api.listContacts(query.trim() || undefined, statusFilter || undefined, stageFilter || undefined);
      if (isCancelled()) return;
      setContacts(rows);
      setLoadError(null);
    } catch (e) {
      if (isCancelled()) return;
      // No mapear el error a []: la lista anterior se conserva y el banner
      // explica el fallo (antes un 403/timeout parecía "sin contactos").
      setLoadError(e);
    }
  }, [query, statusFilter, stageFilter, isCancelled]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const startEdit = (c: CrmContact) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      email: c.email,
      phone: c.phone,
      source: c.source,
      status: c.status,
      stage: c.stage ?? "nuevo",
      tags: c.tags.join(", "),
      notes: c.notes,
    });
    setMsg(null);
    setError(null);
    setReminders(null);
    setStageHistory(null);
    setReminderDate("");
    setReminderNote("");
    api.listReminders(c.id).then((r) => { if (!isCancelled()) setReminders(r); }).catch(() => { if (!isCancelled()) setReminders([]); });
    api.getStageHistory(c.id).then((r) => { if (!isCancelled()) setStageHistory(r); }).catch(() => { if (!isCancelled()) setStageHistory([]); });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
    setReminders(null);
    setStageHistory(null);
  };

  // Cambio rápido de etapa desde la fila (admin): el backend registra
  // el cambio en el historial solo si la etapa realmente cambia.
  const changeStage = async (c: CrmContact, stage: CrmStage) => {
    if (stage === c.stage) return;
    setError(null);
    try {
      await api.updateContactStage(c.id, stage);
      await load();
      window.dispatchEvent(new CustomEvent("crm:changed"));
    } catch (err) {
      setError(t.crm.errSave);
    }
  };

  const addReminder = async () => {
    if (editingId === null || !reminderDate) return;
    setError(null);
    try {
      await api.createReminder(editingId, { remind_date: reminderDate, note: reminderNote });
      setReminderDate("");
      setReminderNote("");
      setReminders(await api.listReminders(editingId));
    } catch (err) {
      setError(t.crm.reminderErr);
    }
  };

  const toggleReminder = async (r: CrmReminder) => {
    if (editingId === null) return;
    try {
      await api.updateReminder(r.id, { done: !r.done });
      setReminders(await api.listReminders(editingId));
    } catch (err) {
      setError(t.crm.reminderErr);
    }
  };

  const removeReminder = async (r: CrmReminder) => {
    if (editingId === null) return;
    try {
      await api.deleteReminder(r.id);
      setReminders(await api.listReminders(editingId));
    } catch (err) {
      setError(t.crm.reminderErr);
    }
  };

  // Importación CSV: el archivo se lee en el navegador y se envía su
  // texto (text/csv); el backend crea las filas válidas y reporta las
  // inválidas por número de fila, sin romper nada.
  const importCsv = async (file: File) => {
    setCsvBusy(true);
    setCsvResult(null);
    setError(null);
    try {
      const text = await file.text();
      const res = await api.importContacts(text);
      setCsvResult(res);
      await load();
      window.dispatchEvent(new CustomEvent("crm:changed"));
    } catch (err) {
      setError(t.crm.csvImportError);
    } finally {
      setCsvBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    const body: CrmContactInput = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      source: form.source,
      status: form.status,
      stage: form.stage,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      notes: form.notes,
    };
    try {
      if (editingId !== null) {
        await api.updateContact(editingId, body);
        setMsg(t.crm.msgUpdated.replace("{nombre}", body.name));
      } else {
        await api.createContact(body);
        setMsg(t.crm.msgCreated.replace("{nombre}", body.name));
      }
      cancelEdit();
      await load();
      // El dashboard superior (pasos/métricas) se actualiza con el cambio.
      window.dispatchEvent(new CustomEvent("crm:changed"));
    } catch (err) {
      setError(t.crm.errSave);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: CrmContact) => {
    if (!(await confirm(t.crm.confirmDelete.replace("{nombre}", c.name)))) return;
    setError(null);
    setMsg(null);
    try {
      await api.deleteContact(c.id);
      if (editingId === c.id) cancelEdit();
      setMsg(t.crm.msgDeleted.replace("{nombre}", c.name));
      await load();
      window.dispatchEvent(new CustomEvent("crm:changed"));
    } catch (err) {
      setError(t.crm.errDelete);
    }
  };

  return (
    <>
      {dialog}
    <Panel
      title={t.crm.panelTitle}
      badge={
        <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
          {contacts === null ? (forbidden ? "—" : t.crm.badgeLoading) : filteringByTag ? `${visible.length} / ${contacts.length} ${t.crm.contactPlural}` : `${visible.length} ${visible.length === 1 ? t.crm.contactSingular : t.crm.contactPlural}`}
        </span>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">
        {t.crm.intro1}<strong className="text-zinc-300">{t.crm.sourceAcademia}</strong>{t.crm.intro2}<strong className="text-zinc-300">Cohley</strong>{t.crm.intro3}<strong className="text-zinc-300">RIV Goods</strong>{t.crm.intro4}
        {isAdmin ? t.crm.introAdmin : t.crm.introViewer}
      </p>

      {/* Search + filter: sin datos no tienen sentido para el cliente
        vinculado (cada tecla re-dispararía el 403); se ocultan con el
        estado amable. */}
      {!forbidden && (
      <div className={`mb-4 grid grid-cols-1 gap-3 ${controlledQuery === undefined ? "sm:grid-cols-[1fr_200px_200px_200px]" : "sm:grid-cols-[200px_200px_200px]"}`}>
        {controlledQuery === undefined && (
        <Field label={t.crm.searchAria}><input
          className={inputCls}
          placeholder={t.crm.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t.crm.searchAria}
        /></Field>
        )}
        <Field label={t.crm.filterAria}><select
          className={inputCls}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label={t.crm.filterAria}
        >
          <option value="">{t.crm.allStatuses}</option>
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select></Field>
        <Field label={t.crm.filterStageAria}><select
          className={inputCls}
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          aria-label={t.crm.filterStageAria}
        >
          <option value="">{t.crm.allStages}</option>
          {stages.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select></Field>
        {allTags.length > 0 && (
        <Field label={t.crm.filterTagAria}><select
          className={inputCls}
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          aria-label={t.crm.filterTagAria}
        >
          <option value="">{t.crm.allTags}</option>
          {allTags.map((tg) => (
            <option key={tg} value={tg}>{tg}</option>
          ))}
        </select></Field>
        )}
      </div>
      )}

      {/* CSV (Fase 5b, tarea 1): exportar, plantilla e importar. Solo
        admin: la importación crea contactos. */}
      {isAdmin && !forbidden && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => api.exportContacts().catch(() => setError(t.crm.errSave))} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
            {t.crm.csvExport}
          </button>
          <button type="button" onClick={() => api.downloadTemplate().catch(() => setError(t.crm.errSave))} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
            {t.crm.csvTemplate}
          </button>
          <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
            {csvBusy ? t.crm.saving : t.crm.csvImport}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              aria-label={t.crm.csvImportAria}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ""; }}
            />
          </label>
        </div>
      )}
      {csvResult && (
        <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
          <p>{t.crm.csvImported.replace("{creados}", String(csvResult.creados)).replace("{errores}", String(csvResult.errores.length))}</p>
          {csvResult.errores.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-300">
              <li className="list-none pl-0 font-semibold text-zinc-200">{t.crm.csvErrorsTitle}</li>
              {csvResult.errores.map((e) => (
                <li key={e.fila}>Fila {e.fila}: {e.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* List */}
      {forbidden ? (
        <EmptyState text={t.reliability.adminOnlySection} />
      ) : loadError ? (
        <ApiErrorBanner error={loadError} t={t} onRetry={load} />
      ) : null}
      {contacts === null ? (
        loadError ? null : (
          <ListSkeleton ariaLabel={t.misc.loadingAria} />
        )
      ) : visible.length === 0 ? (
        <EmptyState
          text={`${t.crm.emptyContacts}${query || statusFilter || tagFilter ? t.crm.emptyForFilter : t.crm.emptyYet}.`}
          actionLabel={isAdmin ? t.crm.createContact : undefined}
          onAction={
            isAdmin
              ? () => {
                  document.getElementById("crm-nuevo-contacto")?.scrollIntoView({ behavior: "smooth" });
                  document.getElementById("crm-nuevo-nombre")?.focus({ preventScroll: true });
                }
              : undefined
          }
        />
      ) : (
        <>
        {/* Tarjetas apiladas en teléfono (F7): la tabla, con 6 columnas y
          scroll horizontal, dejaba nombre y acciones fuera de pantalla. */}
        <ul className="space-y-3 sm:hidden">
          {visible.map((c) => (
            <li key={c.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-100">{c.name}</p>
                <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge[c.status] ?? statusBadge.inactivo}`}>
                  {statusLabel(c.status)}
                </span>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${stageBadge[c.stage] ?? stageBadge.nuevo}`}>
                  {stageLabel(c.stage ?? "nuevo")}
                </span>
                {sourceLabel(c.source)}
              </p>
              {c.email && <p className="mt-1 break-all text-sm text-zinc-300">{c.email}</p>}
              {c.phone && <p className="text-xs text-zinc-400">{c.phone}</p>}
              {c.tags.length > 0 && (
                <p className="mt-1 flex flex-wrap gap-1">
                  {c.tags.map((tg) => (
                    <span key={tg} className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200">{tg}</span>
                  ))}
                </p>
              )}
              {c.notes && <p className="mt-1 text-xs text-zinc-400">{c.notes}</p>}
              {isAdmin && (
                <span className="mt-3 flex gap-1.5">
                  <button
                    onClick={() => startEdit(c)}
                    className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                  >
                    {t.crm.edit}
                  </button>
                  <button
                    onClick={() => remove(c)}
                    className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-2.5 text-xs text-red-400 hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
                  >
                    {t.crm.delete}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-400">
                <th className="py-3 pr-3 font-semibold">{t.crm.thName}</th>
                <th className="py-3 pr-3 font-semibold">{t.crm.thContact}</th>
                <th className="py-3 pr-3 font-semibold">{t.crm.thSource}</th>
                <th className="py-3 pr-3 font-semibold">{t.crm.thStatus}</th>
                <th className="py-3 pr-3 font-semibold">{t.crm.thStage}</th>
                <th className="py-3 pr-3 font-semibold">{t.crm.thTags}</th>
                {isAdmin && <th className="py-3 font-semibold">{t.crm.thActions}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {visible.map((c) => (
                <tr key={c.id} className="align-top hover:bg-zinc-900/40">
                  <td className="py-3 pr-3">
                    <span className="font-semibold text-zinc-100">{c.name}</span>
                    {c.notes && <p className="mt-0.5 max-w-[260px] text-xs text-zinc-400">{c.notes}</p>}
                  </td>
                  <td className="py-3 pr-3 text-zinc-300">
                    {c.email && <p className="break-all">{c.email}</p>}
                    {c.phone && <p className="text-xs text-zinc-400">{c.phone}</p>}
                    {!c.email && !c.phone && <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="py-3 pr-3 text-zinc-300">{sourceLabel(c.source)}</td>
                  <td className="py-3 pr-3">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge[c.status] ?? statusBadge.inactivo}`}>
                      {statusLabel(c.status)}
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    {isAdmin ? (
                      <Field label={t.crm.stageAria}><select
                        className="min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                        value={c.stage ?? "nuevo"}
                        onChange={(e) => void changeStage(c, e.target.value as CrmStage)}
                        aria-label={t.crm.stageAria}
                      >
                        {stages.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select></Field>
                    ) : (
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${stageBadge[c.stage] ?? stageBadge.nuevo}`}>
                        {stageLabel(c.stage ?? "nuevo")}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    <span className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200">{t}</span>
                      ))}
                      {c.tags.length === 0 && <span className="text-zinc-400">—</span>}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="py-3">
                      <span className="flex gap-1.5">
                        <button
                          onClick={() => startEdit(c)}
                          className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                        >
                          {t.crm.edit}
                        </button>
                        <button
                          onClick={() => remove(c)}
                          className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
                        >
                          {t.crm.delete}
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Create / edit form (admin only) */}
      {isAdmin && (
        <form id="crm-nuevo-contacto" onSubmit={submit} className="mt-5 space-y-3 border-t border-zinc-800 pt-5">
          <p className="text-sm font-semibold text-zinc-200">
            {editingId !== null ? t.crm.editTitle : t.crm.newTitle}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t.crm.nameAria}><input id="crm-nuevo-nombre" aria-label={t.crm.nameAria} className={inputCls} placeholder={t.crm.namePlaceholder} value={form.name} onChange={set("name")} required maxLength={128} autoComplete="off" /></Field>
            <Field label={t.crm.emailAria}><input aria-label={t.crm.emailAria} className={inputCls} placeholder={t.crm.emailPlaceholder} type="email" value={form.email} onChange={set("email")} autoComplete="off" /></Field>
            <Field label={t.crm.phoneAria}><input aria-label={t.crm.phoneAria} className={inputCls} placeholder={t.crm.phonePlaceholder} value={form.phone} onChange={set("phone")} autoComplete="off" /></Field>
            <Field label={t.crm.tagsAria}><input aria-label={t.crm.tagsAria} className={inputCls} placeholder={t.crm.tagsPlaceholder} value={form.tags} onChange={set("tags")} autoComplete="off" /></Field>
            <Field label={t.crm.sourceAria}><select className={inputCls} value={form.source} onChange={set("source")} aria-label={t.crm.sourceAria}>
              {sources.map((s) => (
                <option key={s.value} value={s.value}>{t.crm.originOption}{s.label}</option>
              ))}
            </select></Field>
            <Field label={t.crm.statusAria}><select className={inputCls} value={form.status} onChange={set("status")} aria-label={t.crm.statusAria}>
              {statuses.map((s) => (
                <option key={s.value} value={s.value}>{t.crm.statusOption}{s.label}</option>
              ))}
            </select></Field>
            <Field label={t.crm.stageAria}><select className={inputCls} value={form.stage} onChange={set("stage")} aria-label={t.crm.stageAria}>
              {stages.map((s) => (
                <option key={s.value} value={s.value}>{t.crm.stageOption}{s.label}</option>
              ))}
            </select></Field>
          </div>
          <Field label={t.crm.notesAria}><textarea aria-label={t.crm.notesAria}
            className={inputCls}
            placeholder={t.crm.notesPlaceholder}
            value={form.notes}
            onChange={set("notes")}
            rows={2}
          /></Field>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] flex-1 rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {busy ? t.crm.saving : editingId !== null ? t.crm.saveChanges : t.crm.createContact}
            </button>
            {editingId !== null && (
              <button
                type="button"
                onClick={cancelEdit}
                className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                {t.crm.cancel}
              </button>
            )}
          </div>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      {/* Recordatorios e historial de etapa del contacto en edición
        (Fase 5b, tarea 1). Los recordatorios con fecha <= hoy aparecen
        también en el panel "Hoy". */}
      {isAdmin && editingId !== null && (
        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-zinc-800 pt-5 sm:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-zinc-200">{t.crm.remindersTitle}</p>
            {reminders === null ? (
              <p className="py-2 text-sm text-zinc-400">{t.crm.loadingContacts}</p>
            ) : reminders.length === 0 ? (
              <p className="py-2 text-sm text-zinc-400">{t.crm.remindersEmpty}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {reminders.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void toggleReminder(r)}
                      aria-label={t.crm.reminderDone}
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${r.done ? "border-emerald-500 bg-emerald-500/20 text-emerald-300" : "border-zinc-600 text-zinc-400"}`}
                    >
                      {r.done ? "✓" : ""}
                    </button>
                    <span className={`min-w-0 flex-1 text-sm ${r.done ? "text-zinc-400 line-through" : "text-zinc-200"}`}>
                      {r.note || "—"}
                      <span className="block text-xs text-zinc-400">{r.remind_date}</span>
                    </span>
                    <button type="button" onClick={() => void removeReminder(r)} aria-label={t.crm.reminderDelete} className="min-h-[44px] rounded-lg px-2 text-xs text-red-400 hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60">×</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Field label={t.crm.reminderDateAria} className="shrink-0"><input aria-label={t.crm.reminderDateAria} type="date" className={inputCls} value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} /></Field>
              <Field label={t.crm.reminderNotePlaceholder} className="min-w-[180px] flex-1"><input aria-label={t.crm.reminderNotePlaceholder} className={inputCls} placeholder={t.crm.reminderNotePlaceholder} value={reminderNote} onChange={(e) => setReminderNote(e.target.value)} maxLength={200} /></Field>
              <button type="button" onClick={() => void addReminder()} disabled={!reminderDate} className="min-h-[44px] shrink-0 self-end rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
                {t.crm.reminderAdd}
              </button>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-200">{t.crm.stageHistoryTitle}</p>
            {stageHistory === null ? (
              <p className="py-2 text-sm text-zinc-400">{t.crm.loadingContacts}</p>
            ) : stageHistory.length === 0 ? (
              <p className="py-2 text-sm text-zinc-400">{t.crm.remindersEmpty}</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                {stageHistory.map((h) => (
                  <li key={h.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                    {h.from_stage === null
                      ? t.crm.stageHistoryInitial.replace("{etapa}", stageLabel(h.to_stage))
                      : t.crm.stageHistoryChange.replace("{de}", stageLabel(h.from_stage)).replace("{a}", stageLabel(h.to_stage))}
                    <span className="block text-xs text-zinc-400">{h.changed_at ? new Date(h.changed_at).toLocaleString() : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {!isAdmin && (msg || error) && (
        <div className="mt-3">
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </div>
      )}
    </Panel>
    {/* Nuevas secciones del CRM (sin tocar la lógica anterior): historial
      por cliente y asistente por reglas, debajo del panel principal. */}
    <div className="mt-6 space-y-6">
      <CrmHistorial />
      <CrmAsistente />
    </div>
    </>
  );
}
