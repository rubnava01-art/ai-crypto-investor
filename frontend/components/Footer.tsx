"use client";

import { useLanguage } from "../lib/i18n";

export function Footer() {
  const { t } = useLanguage();
  return (
    <footer className="mt-12 border-t border-slate-800/80 bg-[#0B0F19]/60 px-4 py-8 text-center">
      <p className="mx-auto max-w-2xl text-xs leading-relaxed text-slate-400 [text-wrap:balance]">
        {t.footer.disclaimer}
      </p>
      <p className="mt-3 text-xs font-semibold tracking-wide text-slate-300">{t.header.brand}</p>
    </footer>
  );
}
