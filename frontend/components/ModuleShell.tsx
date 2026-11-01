"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getToken, setToken } from "../lib/api";
import { ModuleNav } from "./ModuleNav";
import { ProfileMenu } from "./ProfileMenu";
import { Footer } from "./Footer";
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
  // No renderizar el contenido protegido hasta confirmar sesión: antes, los
  // paneles se montaban y disparaban llamadas sin token (flash de UI privada).
  const [checked, setChecked] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    if (!getToken()) router.replace("/login");
    else setChecked(true);
  }, [router]);

  if (!checked) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <p role="status" className="text-sm text-zinc-400">{t.shell.loading}</p>
      </main>
    );
  }

  function logout() {
    setToken(null);
    router.replace("/login");
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 sm:mb-8">
        <div className="min-w-0">
          <p className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
            <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            {t.header.brand}
          </p>
          <h1 className="text-xl font-bold leading-tight tracking-tight sm:text-2xl">{moduleTitle}</h1>
          <p className="mt-0.5 text-sm leading-relaxed text-zinc-400">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <ProfileMenu onLogout={logout} />
        </div>
      </header>

      <div className="mb-6 sm:mb-8">
        <ModuleNav />
      </div>

      {children}

      <Footer />
    </main>
  );
}
