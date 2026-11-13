"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getToken, setToken } from "../lib/api";
import { loginUrl } from "../lib/session";
import { FAMILY_ACCENT, familyForHref, ModuleNav } from "./ModuleNav";
import { ProfileMenu } from "./ProfileMenu";
import { Footer } from "./Footer";
import { SkipLink } from "./ui";
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
  // Punto de familia (F13): el texto de marca queda emerald (marca), el
  // punto toma el acento de la familia de la ruta actual.
  const accent = FAMILY_ACCENT[familyForHref(pathname)] ?? FAMILY_ACCENT.invertir;

  useEffect(() => {
    // Fase 4 (FE7): preservar el destino (?next=) para volver tras el login,
    // igual que el 401 centralizado del cliente API. El token ya se leyó en
    // el inicializador de estado; aquí solo queda redirigir si no hay sesión.
    // La URL se construye en lib/session.ts (C2): conserva pathname + query.
    // Sin expired=1: no hay sesión, no es una expiración.
    if (!getToken()) {
      router.replace(loginUrl(window.location.pathname + window.location.search));
    }
  }, [router, pathname]);

  if (!checked) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div role="status" aria-label={t.shell.loading} className="space-y-4">
          <div aria-hidden="true" className="h-8 w-48 motion-safe:animate-pulse rounded-lg bg-zinc-800" />
          <div aria-hidden="true" className="h-40 motion-safe:animate-pulse rounded-xl bg-zinc-900/70" />
          <div aria-hidden="true" className="h-40 motion-safe:animate-pulse rounded-xl bg-zinc-900/70" />
        </div>
      </main>
    );
  }

  function logout() {
    setToken(null);
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
          <ProfileMenu onLogout={logout} />
        </div>
      </header>

      <div className="mb-6 sm:mb-8">
        <ModuleNav />
      </div>

      <div id="contenido" tabIndex={-1} className="outline-none">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-5 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          <span aria-hidden="true">←</span> {t.common.back}
        </button>
        {children}
      </div>

      <Footer />
    </main>
  );
}
