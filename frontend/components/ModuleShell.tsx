"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { getToken, isGuest, logout as logoutSession } from "../lib/api";
import { loginUrl } from "../lib/session";
import { FAMILY_ACCENT, familyForHref, KEY_BY_HREF, ModuleNav } from "./ModuleNav";
import { GUEST_MODULES } from "../lib/api/guest";
import { ProfileMenu } from "./ProfileMenu";
import { CommandPalette } from "./CommandPalette";
import { Footer } from "./Footer";
import { SkipLink } from "./ui";
import { Skeleton } from "./Skeleton";
import { ColdStartNotice } from "./ColdStartNotice";
import { LanguageToggle, useLanguage } from "../lib/i18n";

/** Shared shell for the unified platform's module pages (Estudiar, Crear, CRM).
 * The Invertir module is the home dashboard (app/page.tsx), which renders the
 * same header + ModuleNav. */
export function ModuleShell({
  moduleTitle,
  subtitle,
  children,
}: {
  moduleTitle: string;
  subtitle: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // No renderizar el contenido protegido hasta confirmar sesión: antes, los
  // paneles se montaban y disparaban llamadas sin token (flash de UI privada).
  // El token se lee de forma síncrona en el inicializador de estado (no en
  // useEffect) para no mostrar el skeleton en cada navegación: si ya hay
  // sesión, el shell arranca directamente con el contenido.
  // Nota: en SSR getToken() devuelve null (sin window), así que el primer
  // render del servidor sigue siendo el skeleton y el cliente lo sustituye
  // al hidratar; es el coste aceptado de esta versión ligera de C-1.
  const [checked, setChecked] = useState(() => !!getToken());
  const { t } = useLanguage();
  // Cold start (Fase 5, 2026-11-23): si a los 5 s de montar el módulo el
  // shell sigue sin confirmar sesión o quedan skeletons/paneles cargando
  // (.fintech-skeleton o [data-panel-loading] dentro de <main>), se
  // muestra el aviso con el tiempo real transcurrido y reintento manual
  // (recarga la página). Los banners por perfil (role="status") no
  // cuentan como carga: solo los skeletons.
  const [slowLoad, setSlowLoad] = useState(false);
  const [slowElapsed, setSlowElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const secs = Math.floor((Date.now() - start) / 1000);
      setSlowElapsed(secs);
      const stillLoading = !!document.querySelector(
        "main .fintech-skeleton, main [data-panel-loading]",
      );
      const slow = secs >= 5 && (!checked || stillLoading);
      setSlowLoad(slow);
      // Una vez cargado (o pasados 120 s), dejar de sondear: no tiene
      // sentido re-renderizar el shell cada segundo para siempre.
      if ((secs >= 5 && checked && !stillLoading) || secs > 120) {
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [pathname, checked]);
  // Invitado (Fase 1): solo inicio, estudiar (y sus manuales), planes y
  // asistente. Cualquier otra ruta muestra la invitación a registrarse
  // en vez del contenido — el backend además deniega cada endpoint.
  const guestBlocked = (() => {
    if (!isGuest()) return false;
    if (pathname === "/inicio" || pathname === "/planes" || pathname === "/asistente") return false;
    if (pathname === "/estudiar" || pathname.startsWith("/estudiar/")) return false;
    const key = KEY_BY_HREF[pathname];
    return !key || !GUEST_MODULES.includes(key);
  })();
  // Punto de familia (F13): el texto de marca queda emerald (marca), el
  // punto toma el acento de la familia de la ruta actual.
  const accent = FAMILY_ACCENT[familyForHref(pathname)] ?? FAMILY_ACCENT.invertir;

  useEffect(() => {
    // Fase 4 (FE7): preservar el destino (?next=) para volver tras el login,
    // igual que el 401 centralizado del cliente API. El token ya se leyó en
    // el inicializador de estado; aquí solo queda redirigir si no hay sesión.
    // La URL se construye en lib/session.ts (C2): conserva pathname + query
    // + fragmento (#ancla) — H-01 (QA TBT-Herramientas): sin el hash, el
    // gancho libre «Pruébala sin cuenta» moría en /login y el invitado
    // aterrizaba en /estudiar arriba, no en la herramienta.
    // Sin expired=1: no hay sesión, no es una expiración.
    if (!getToken()) {
      router.replace(loginUrl(window.location.pathname + window.location.search + window.location.hash));
    }
  }, [router, pathname]);

  if (!checked) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Mismo Skeleton compartido que el resto de la app (antes eran
            divs sueltos con animate-pulse y bg-slate-800). */}
        <div role="status" aria-label={t.shell.loading} className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </main>
    );
  }

  function logout() {
    logoutSession();
    router.replace("/login");
  }

  return (
    <main className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <SkipLink label={t.shell.skipLink} />
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 sm:mb-8">
        <div className="min-w-0">
          <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
            <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${accent.dot}`} />
            {t.header.brand}
          </p>
          <h1 className="text-xl font-bold leading-tight tracking-tight sm:text-2xl">{moduleTitle}</h1>
          <p className="mt-0.5 text-sm leading-relaxed text-zinc-400">{subtitle}</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{t.header.tagline}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          {/* Fase 4 mejoras-v1, tarea 4: buscador global Ctrl+K. */}
          <CommandPalette />
          <ProfileMenu onLogout={logout} />
        </div>
      </header>

      <div className="mb-6 sm:mb-8">
        <ModuleNav />
      </div>

      <ColdStartNotice
        loading={slowLoad}
        elapsedSeconds={slowElapsed}
        onRetry={() => window.location.reload()}
      />

      <div id="contenido" tabIndex={-1} className="outline-none">
        {guestBlocked ? (
          <div
            role="status"
            className="rounded-xl border border-emerald-700/60 bg-emerald-500/10 px-5 py-6 text-center"
          >
            <p className="text-base font-semibold leading-relaxed text-emerald-200">
              {t.guest.inviteBlocked}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-emerald-300/90">
              {t.guest.inviteSave}
            </p>
            <Link
              href="/login?mode=register"
              className="mt-5 inline-flex min-h-[44px] items-center rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {t.guest.bannerCta}
            </Link>
          </div>
        ) : (
          children
        )}
      </div>

      <Footer />
    </main>
  );
}
