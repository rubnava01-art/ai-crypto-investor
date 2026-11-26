"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { PublicNav } from "./PublicNav";
import { Footer } from "./Footer";
import { useLanguage } from "../lib/i18n";

/** Shell de las páginas legales públicas (Fase 2 mejoras-v1, tarea 1).
 * Páginas públicas sin sesión: PublicNav + artículo centrado + Footer.
 * Todas llevan el sello de borrador y la fecha: los textos son
 * borradores en español pendientes de revisión del dueño, no textos
 * legales definitivos. El cuerpo de cada página vive en su ruta
 * (/legal/terminos, /legal/privacidad, /legal/cookies, /legal/reembolsos);
 * aquí solo el cromo común. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <PublicNav />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="inline-block rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-300">
          {t.legal.draftBadge}
        </p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-zinc-400">{t.legal.updatedOn}</p>
        <div className="mt-8 space-y-8">{children}</div>
        <p className="mt-10 border-t border-zinc-800 pt-6 text-sm leading-relaxed text-zinc-400">
          <Link href="/contacto" className="font-semibold text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            {t.legal.contactCta}
          </Link>
        </p>
      </main>
      <Footer />
    </div>
  );
}

/** Una sección del texto legal: título + párrafos. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-bold text-zinc-50">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-zinc-400">{children}</div>
    </section>
  );
}

/** Dato que falta y solo el dueño puede decidir: se muestra como
 * PENDIENTE en vez de inventar una razón social, una dirección o un
 * plazo. El texto que lo rodea sigue siendo válido como borrador. */
export function LegalPending({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-sm leading-relaxed text-amber-200">
      <span className="font-bold">PENDIENTE: requiere al dueño. </span>
      {children}
    </p>
  );
}
