"use client";

import { useLanguage } from "../lib/i18n";

export function Footer() {
  const { t } = useLanguage();
  return (
    <footer className="mt-10 border-t border-zinc-800 px-4 py-6 text-center">
      <p className="mx-auto max-w-2xl text-xs leading-relaxed text-zinc-500">
        {t.footer.disclaimer}
      </p>
      <p className="mt-2 text-[11px] text-zinc-600">{t.header.brand}</p>
    </footer>
  );
}
