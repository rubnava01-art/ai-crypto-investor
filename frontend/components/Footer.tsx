"use client";

import { useLanguage } from "../lib/i18n";

export function Footer() {
  const { t } = useLanguage();
  return (
    <footer className="mt-12 border-t border-zinc-800 px-4 py-8 text-center">
      <p className="mx-auto max-w-2xl text-xs leading-relaxed text-zinc-500 [text-wrap:balance]">
        {t.footer.disclaimer}
      </p>
      <p className="mt-3 text-[11px] font-medium tracking-wide text-zinc-500">{t.header.brand}</p>
    </footer>
  );
}
