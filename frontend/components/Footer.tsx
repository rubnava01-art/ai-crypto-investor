"use client";

import Link from "next/link";
import { useLanguage } from "../lib/i18n";

export function Footer() {
  const { t } = useLanguage();
  return (
    <footer className="mt-12 border-t border-slate-800/80 bg-[#0B0F19]/60 px-4 py-8 text-center">
      <p className="mx-auto max-w-2xl text-xs leading-relaxed text-slate-400 [text-wrap:balance]">
        {t.footer.disclaimer}
      </p>
      {/* Fase 2 mejoras-v1, tareas 1 y 3: textos legales públicos
          (borradores): términos, privacidad, cookies y reembolsos. */}
      <nav aria-label={t.footer.legalLabel} className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs">
        <Link href="/legal/terminos" className="font-semibold text-slate-300 underline-offset-2 hover:text-white hover:underline">
          {t.footer.terms}
        </Link>
        <Link href="/legal/privacidad" className="font-semibold text-slate-300 underline-offset-2 hover:text-white hover:underline">
          {t.footer.privacy}
        </Link>
        <Link href="/legal/cookies" className="font-semibold text-slate-300 underline-offset-2 hover:text-white hover:underline">
          {t.footer.cookies}
        </Link>
        {/* Fase 2 mejoras-v1, tarea 3: reembolsos y cancelación. */}
        <Link href="/legal/reembolsos" className="font-semibold text-slate-300 underline-offset-2 hover:text-white hover:underline">
          {t.footer.refunds}
        </Link>
      </nav>
      <p className="mt-3 text-xs font-semibold tracking-wide text-slate-300">{t.header.brand}</p>
    </footer>
  );
}
