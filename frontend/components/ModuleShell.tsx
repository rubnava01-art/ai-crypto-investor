"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getToken, setToken } from "../lib/api";
import { ModuleNav } from "./ModuleNav";
import { ProfileMenu } from "./ProfileMenu";
import { Footer } from "./Footer";

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

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  function logout() {
    setToken(null);
    router.replace("/login");
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Plataforma unificada
          </p>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{moduleTitle}</h1>
          <p className="text-sm text-zinc-400">{subtitle}</p>
        </div>
        <ProfileMenu onLogout={logout} />
      </header>

      <div className="mb-6">
        <ModuleNav />
      </div>

      {children}

      <Footer />
    </main>
  );
}
