// Dashboard del CRM (Fase 3, rediseño estilo Vivero — estructura, no contenido).
// Referencia SOLO visual: la captura de "Vivero" muestra barra superior con
// buscador + doble reloj + botón verde, "El día, paso a paso" (4 tarjetas
// numeradas con mini-gráfica de 7 días + leyenda) y "Los números de la
// empresa" (métricas + ventas de la semana). Aquí todo es dato real de la
// plataforma (contactos, citas, facturas) sobre el tema oscuro emerald
// #10b981 / azul #3b82f6. Lo que no tiene fuente real (telefonía, envíos,
// pasarela, agentes en línea) NO aparece: se omite, no se inventa.
// Aislamiento por perfil: el resumen hereda el gate require_modulo("crm")
// del backend — prueba y cliente vinculado reciben 403 y este dashboard
// no se renderiza (queda el estado amable de CrmPanel).
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, logout as logoutSession,
  type CrmResumen, type MeResponse,
} from "../lib/api";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { crmMoney, sparklinePoints, weeklyBarHeight } from "../lib/crmResumen";
import { MetricCard } from "./MetricCard";
import { MetricCardSkeleton, Skeleton } from "./Skeleton";
import { ChartCard } from "./bi/DashboardCard";
import { ApiErrorBanner, isAdminOnlyForbidden } from "./ui";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

const statusDot: Record<string, string> = {
  nuevo: "bg-sky-400",
  contactado: "bg-amber-400",
  interesado: "bg-violet-400",
  cliente: "bg-emerald-400",
  inactivo: "bg-zinc-500",
};

const stepTitleKey: Record<string, string> = {
  nuevos: "resumenPasoNuevos",
  gestion: "resumenPasoGestion",
  seguimiento: "resumenPasoSeguimiento",
  citas: "resumenPasoCitas",
};

function initialsOf(me: MeResponse): string {
  const name = (me.display_name || me.username || me.email || "?").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts[1][0] : "";
  return (first + second).toUpperCase();
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(...values, 1);
  const w = 120;
  const h = 32;
  const points = sparklinePoints(values, w, h);
  return (
    <svg
      className="h-8 w-full"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polyline
        points={points}
        fill="none"
        stroke="#10b981"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={w}
        cy={h - 4 - ((values[values.length - 1] ?? 0) / max) * (h - 8)}
        r="3"
        fill="#10b981"
      />
    </svg>
  );
}

export function CrmDashboard({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (q: string) => void;
}) {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const isCancelled = useCancelled();
  const [resumen, setResumen] = useState<CrmResumen | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [now, setNow] = useState(() => new Date());
  const isAdmin = !!me?.is_admin;

  const load = useCallback(async () => {
    try {
      const data = await api.getCrmResumen();
      if (isCancelled()) return;
      setResumen(data);
      setLoadError(null);
    } catch (e) {
      if (isCancelled()) return;
      setLoadError(e);
    }
  }, [isCancelled]);

  useEffect(() => {
    load();
    api.me().then((m) => { if (!isCancelled()) setMe(m); }).catch(() => {});
    const onChanged = () => load();
    window.addEventListener("crm:changed", onChanged);
    return () => window.removeEventListener("crm:changed", onChanged);
  }, [load, isCancelled]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(id);
  }, []);

  if (isAdminOnlyForbidden(loadError, isAdmin)) return null;
  if (loadError && resumen === null) {
    return <ApiErrorBanner error={loadError} t={t} onRetry={load} />;
  }
  if (resumen === null) {
    // Skeleton con la forma del resumen (2026-11-25): antes un texto
    // plano "Cargando resumen…"; ahora barra superior + 4 tarjetas de
    // pasos + 6 métricas, misma forma que el contenido real.
    return (
      <div className="mb-6 space-y-6" role="status" aria-label={t.misc.loadingAria}>
        <div className="fintech-card p-4">
          <Skeleton className="h-11 w-full max-w-md" />
        </div>
        <section>
          <Skeleton className="mb-3 h-6 w-56" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <MetricCardSkeleton key={i} />
            ))}
          </div>
        </section>
        <section>
          <Skeleton className="mb-3 h-6 w-64" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <MetricCardSkeleton key={i} />
            ))}
          </div>
        </section>
      </div>
    );
  }

  const money = (v: number) => crmMoney(v);
  const fmtTime = (tz: string) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-MX", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    }).format(now);

  const goToNewContact = () => {
    document.getElementById("crm-nuevo-contacto")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("crm-nuevo-nombre")?.focus({ preventScroll: true });
  };

  const logout = () => {
    logoutSession();
    router.replace("/login");
  };

  const maxVenta = Math.max(...resumen.ventas_semana_dias.map((d) => d.total), 0);
  const hayVentas = resumen.ventas_semana_dias.some((d) => d.cantidad > 0);
  const m = resumen.metricas;

  return (
    <div className="mb-6 space-y-6">
      {/* Barra superior estilo Vivero: buscador, doble reloj, agregar, avatar, salir. */}
      <div className="fintech-card flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-[220px] flex-1">
          <input
            className={inputCls}
            placeholder={t.crm.resumenBuscarPlaceholder}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label={t.crm.resumenBuscarAria}
            autoComplete="off"
          />
        </div>
        <p className="whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm tabular-nums text-zinc-200" aria-label={`${t.crm.resumenRelojLA} ${fmtTime("America/Los_Angeles")}`}>
          <span className="text-zinc-400">{t.crm.resumenRelojLA} </span>
          <strong>{fmtTime("America/Los_Angeles")}</strong>
          <span className="mx-2 text-zinc-600">·</span>
          <span className="text-zinc-400">UTC </span>
          <strong>{fmtTime("UTC")}</strong>
        </p>
        {isAdmin && (
          <button
            type="button"
            onClick={goToNewContact}
            className="min-h-[44px] rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            + {t.crm.resumenAgregar}
          </button>
        )}
        {me && (
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white"
            title={me.display_name || me.username}
            aria-label={me.display_name || me.username}
          >
            {initialsOf(me)}
          </span>
        )}
        <button
          type="button"
          onClick={logout}
          className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          {t.crm.resumenSalir}
        </button>
      </div>

      {/* El día, paso a paso */}
      <section aria-labelledby="crm-dia">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="crm-dia" className="text-lg font-bold text-zinc-100">{t.crm.resumenDiaTitulo}</h2>
          <p className="text-sm text-zinc-400">{t.crm.resumenDiaSub}</p>
        </div>
        <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400" aria-label={t.crm.resumenDiaTitulo}>
          {resumen.leyenda.map((row) => (
            <span key={row.estado} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-sm ${statusDot[row.estado] ?? "bg-zinc-500"}`} />
              {t.crm[`status${row.estado[0].toUpperCase()}${row.estado.slice(1)}` as keyof typeof t.crm] ?? row.estado}
              <span className="tabular-nums text-zinc-300">{row.total}</span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="text-emerald-400">↗</span>
            {t.crm.resumenUltimos7} ({t.crm.resumenCreados} / {t.crm.resumenCitasSerie})
          </span>
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {resumen.pasos.map((paso) => (
            <article key={paso.clave} className="fintech-card fintech-lift p-5">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400 tabular-nums">
                  {String(paso.numero).padStart(2, "0")}
                </span>
                {t.crm[stepTitleKey[paso.clave] as keyof typeof t.crm] ?? paso.clave}
              </p>
              <p className="fintech-nums mt-3 text-4xl font-extrabold tracking-tight text-zinc-50 tabular-nums">
                {paso.total}
              </p>
              <p className="mt-1 text-sm text-zinc-400">{paso.sub}</p>
              <div className="mt-3">
                <Sparkline
                  values={paso.serie_7d}
                  label={`${t.crm.resumenUltimos7}: ${paso.clave === "citas" ? t.crm.resumenCitasSerie : t.crm.resumenCreados}`}
                />
              </div>
              <p className="mt-2 border-t border-zinc-800 pt-2 text-xs text-zinc-400">
                {paso.total === 0 ? paso.vacio : `${t.crm.resumenUltimos7}: ${paso.serie_7d.join(" · ")}`}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Los números del negocio */}
      <section aria-labelledby="crm-numeros">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="crm-numeros" className="text-lg font-bold text-zinc-100">{t.crm.resumenNumerosTitulo}</h2>
          <p className="text-sm text-zinc-400">{t.crm.resumenNumerosSub}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label={t.crm.resumenMetricaNuevosHoy} value={String(m.contactos_nuevos_hoy)} changeLabel={t.crm.resumenMetricaNuevosHoySub} />
          <MetricCard label={t.crm.resumenMetricaCitasHoy} value={String(m.citas_hoy)} changeLabel={t.crm.resumenMetricaCitasHoySub} />
          <MetricCard label={t.crm.resumenMetricaVentasHoy} value={money(m.ventas_hoy.total)} changeLabel={`${m.ventas_hoy.cantidad} · ${t.crm.resumenMetricaVentasHoySub}`} />
          <MetricCard label={t.crm.resumenMetricaVentasSemana} value={money(m.ventas_semana.total)} changeLabel={`${m.ventas_semana.cantidad} · ${t.crm.resumenMetricaVentasSemanaSub}`} />
          <MetricCard label={t.crm.resumenMetricaPorCobrar} value={money(m.por_cobrar.total)} changeLabel={`${m.por_cobrar.cantidad} · ${t.crm.resumenMetricaPorCobrarSub}`} />
          <MetricCard label={t.crm.resumenMetricaClientes} value={String(m.clientes)} changeLabel={t.crm.resumenMetricaClientesSub} />
        </div>
        <div className="mt-4">
          <ChartCard
            title={t.crm.resumenVentasSemana}
            context={t.crm.resumenVentasSemanaSub.replace("{n}", String(m.ventas_semana.cantidad))}
            empty={!hayVentas}
            emptyText={t.crm.resumenSinVentasSemana}
          >
            <div className="flex items-end gap-2" role="img" aria-label={t.crm.resumenVentasSemana}>
              {resumen.ventas_semana_dias.map((d) => {
                const height = weeklyBarHeight(d.total, maxVenta);
                const isToday = d.etiqueta === "Hoy";
                return (
                  <div key={d.fecha} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                    <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] tabular-nums text-zinc-300 sm:text-xs">{money(d.total)}</span>
                    <div
                      className={`w-full max-w-[48px] rounded-t-md ${isToday ? "bg-emerald-500" : "bg-blue-500/80"}`}
                      style={{ height: `${height}px` }}
                    />
                    <span className={`text-xs ${isToday ? "font-bold text-emerald-400" : "text-zinc-400"}`}>{d.etiqueta}</span>
                  </div>
                );
              })}
            </div>
          </ChartCard>
          <p className="mt-2 text-xs text-zinc-400">{t.crm.resumenNotaVentas}</p>
        </div>
      </section>
    </div>
  );
}
