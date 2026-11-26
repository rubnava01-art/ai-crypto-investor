"use client";

import { useState } from "react";
import Link from "next/link";
import { api, type HoyResponse } from "../lib/api";
import { useLanguage } from "../lib/i18n";
import { useAsyncLoad } from "../lib/useLoad";
import { formatDateOnly } from "../lib/dates";
import { Panel } from "./Panel";
import { Skeleton } from "./Skeleton";
import { ApiErrorBanner } from "./ui";
import { descartarEjemplos, ejemplosDescartados, ejemplosHoy, type HoyItem } from "../lib/ejemplos";

/** Panel "Hoy" (Fase 4 mejoras-v1, tarea 7): lo urgente del día con
 * datos reales (GET /api/dashboard/hoy): tareas vencidas o de hoy,
 * facturas vencidas / por vencer / por cobrar, stock bajo y citas de
 * hoy. Sin nada urgente, el mensaje honesto "Nada urgente hoy" — o
 * los datos de ejemplo (etiquetados "Ejemplo", descartables de un
 * clic) si el usuario aún no los descartó. Una sección en null es un
 * fallo, no un vacío: se avisa qué no se pudo cargar. */
function fmtFechaCorta(iso: string | null, locale: string): string {
  return formatDateOnly(iso, locale);
}

function fmtHora(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function HoyPanel({ username }: { username: string }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const hoy = t.hoy;
  const load = useAsyncLoad<HoyResponse>((signal) => api.listHoy({ signal }), []);
  const data = load.data;
  const [ejemplosOff, setEjemplosOff] = useState(() => ejemplosDescartados(username));

  const secciones: { titulo: string; items: HoyItem[] }[] = [];
  let fallidas: string[] = [];
  if (data) {
    const areaLabel = (area: string) =>
      (t.business as Record<string, string>)[`area${area.charAt(0).toUpperCase()}${area.slice(1)}`] ?? area;
    if (data.tareas === null) fallidas.push(hoy.sectionTasks);
    else if (data.tareas.length > 0)
      secciones.push({
        titulo: hoy.sectionTasks,
        items: data.tareas.map((x) => ({
          kind: "tarea" as const,
          titulo: x.title,
          detalle: `${areaLabel(x.area)} · ${hoy.duePrefix.replace("{fecha}", fmtFechaCorta(x.due_date, locale))}`,
          href: x.href,
        })),
      });
    const facturas = (
      lista: typeof data.facturas_vencidas,
      titulo: string,
    ) => {
      if (lista === null) fallidas.push(titulo);
      else if (lista.length > 0)
        secciones.push({
          titulo,
          items: lista.map((f) => ({
            kind: "factura" as const,
            titulo: f.client_name,
            detalle: `${f.number} · ${money(f.total)}${f.due_date ? ` · ${hoy.duePrefix.replace("{fecha}", fmtFechaCorta(f.due_date, locale))}` : ""}`,
            href: f.href,
          })),
        });
    };
    facturas(data.facturas_vencidas, hoy.sectionInvoicesOverdue);
    facturas(data.facturas_por_vencer, hoy.sectionInvoicesSoon);
    facturas(data.facturas_por_cobrar, hoy.sectionInvoicesPending);
    if (data.stock_bajo === null) fallidas.push(hoy.sectionStock);
    else if (data.stock_bajo.length > 0)
      secciones.push({
        titulo: hoy.sectionStock,
        items: data.stock_bajo.map((s) => ({
          kind: "stock" as const,
          titulo: s.name,
          detalle: hoy.stockDetail
            .replace("{cantidad}", String(s.quantity))
            .replace("{minimo}", String(s.min_stock)),
          href: s.href,
        })),
      });
    if (data.citas === null) fallidas.push(hoy.sectionAppointments);
    else if (data.citas.length > 0)
      secciones.push({
        titulo: hoy.sectionAppointments,
        items: data.citas.map((c) => ({
          kind: "cita" as const,
          titulo: c.client_name,
          detalle: `${c.service_type} · ${fmtHora(c.starts_at, locale)}`,
          href: c.href,
        })),
      });
    // Recordatorios del CRM (Fase 5b, tarea 1): no hechos, fecha <= hoy.
    if (data.recordatorios === null) fallidas.push(hoy.sectionReminders);
    else if (data.recordatorios.length > 0)
      secciones.push({
        titulo: hoy.sectionReminders,
        items: data.recordatorios.map((r) => ({
          kind: "tarea" as const,
          titulo: r.contact_name,
          detalle: `${r.note ? `${r.note} · ` : ""}${hoy.duePrefix.replace("{fecha}", fmtFechaCorta(r.remind_date, locale))}`,
          href: r.href,
        })),
      });
  }
  const total = secciones.reduce((acc, s) => acc + s.items.length, 0);
  const sinNada = data != null && secciones.length === 0 && fallidas.length === 0;
  const mostrarEjemplos = sinNada && !ejemplosOff;
  const ejemplos = mostrarEjemplos ? ejemplosHoy(hoy) : [];

  return (
    <Panel
      title={hoy.title}
      badge={
        <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
          {data == null && !load.error ? hoy.loading : String(total)}
        </span>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">{hoy.subtitle}</p>

      {load.error ? (
        <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
      ) : data == null ? (
        <div className="space-y-3" aria-label={hoy.loading}>
          <Skeleton className="h-10 w-full" ariaLabel={hoy.loading} />
          <Skeleton className="h-10 w-full" ariaLabel={hoy.loading} />
        </div>
      ) : (
        <>
          {fallidas.length > 0 && (
            <p role="alert" className="mb-4 rounded-lg border border-amber-700/60 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-300">
              {hoy.partial.replace("{secciones}", fallidas.join(", "))}
            </p>
          )}

          {secciones.map((s) => (
            <section key={s.titulo} aria-label={s.titulo} className="mb-4 last:mb-0">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
                {s.titulo}
              </h3>
              <ul className="space-y-2">
                {s.items.map((item) => (
                  <li key={`${item.kind}-${item.titulo}-${item.detalle}`}>
                    <Link
                      href={item.href}
                      className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-zinc-100">
                          {item.titulo}
                        </span>
                        <span className="block truncate text-xs text-zinc-400">{item.detalle}</span>
                      </span>
                      <span aria-hidden="true" className="shrink-0 text-zinc-400">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {mostrarEjemplos && (
            <section aria-label={hoy.exampleBadge} className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-bold text-zinc-200">
                  {hoy.exampleBadge}
                </span>
                <p className="text-sm leading-relaxed text-zinc-400">{hoy.examplesNote}</p>
              </div>
              <ul className="mt-3 space-y-2">
                {ejemplos.map((item) => (
                  <li key={`${item.kind}-${item.titulo}`}>
                    <Link
                      href={item.href}
                      className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-zinc-100">
                          {item.titulo}
                        </span>
                        <span className="block truncate text-xs text-zinc-400">{item.detalle}</span>
                      </span>
                      <span aria-hidden="true" className="shrink-0 text-zinc-400">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  descartarEjemplos(username);
                  setEjemplosOff(true);
                }}
                className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                {hoy.dismissExamples}
              </button>
            </section>
          )}

          {!mostrarEjemplos && secciones.length === 0 && fallidas.length === 0 && (
            <p className="py-2 text-sm text-zinc-400">{hoy.empty}</p>
          )}
        </>
      )}
    </Panel>
  );
}
