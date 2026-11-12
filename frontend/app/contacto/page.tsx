"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getToken } from "../../lib/api";
import { useLanguage } from "../../lib/i18n";
import { PublicNav } from "../../components/PublicNav";
import { Footer } from "../../components/Footer";

/** Página de contacto (2026-11-12).
 * PENDIENTE (dato del dueño): todavía no hay email, teléfono ni
 * dirección registrados para la plataforma — por eso esta página NO
 * publica ningún dato de contacto. Si Rubén quiere ponerlos, se añaden
 * aquí (y sus textos a contacto.* en i18n).
 * Visitantes: nota neutra + enlaces a Entrar/Registrarse. Con sesión:
 * apunta al módulo Correos (/correos). Página pública: no dispara
 * llamadas autenticadas; solo lee si hay token guardado. */
export default function ContactoPage() {
  const { t } = useLanguage();
  const c = t.contacto;
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    setHasSession(!!getToken());
  }, []);

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <PublicNav />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{c.title}</h1>
        <p className="mt-3 text-base leading-relaxed text-zinc-400">{c.subtitle}</p>

        <section aria-label={c.visitorTitle} className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
          <h2 className="text-lg font-bold text-zinc-50">{c.visitorTitle}</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">{c.visitorBody}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            >
              {c.visitorLogin}
            </Link>
            <Link
              href="/login?mode=register"
              className="inline-flex min-h-[44px] items-center rounded-lg border border-zinc-700 px-5 py-3 text-sm font-bold text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            >
              {c.visitorRegister}
            </Link>
          </div>
        </section>

        {hasSession && (
          <section aria-label={c.memberTitle} className="mt-4 rounded-xl border border-blue-800/60 bg-blue-500/10 p-5 sm:p-6">
            <h2 className="text-lg font-bold text-zinc-50">{c.memberTitle}</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">{c.memberBody}</p>
            <Link
              href="/correos"
              className="mt-5 inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            >
              {c.memberCta}
            </Link>
          </section>
        )}

        <p className="mt-8">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center rounded-lg px-2 py-2.5 text-sm font-semibold text-blue-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
          >
            {c.backHome}
          </Link>
        </p>
      </main>
      <Footer />
    </div>
  );
}
