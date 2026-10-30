"use client";

import { useLanguage } from "../lib/i18n";

export default function Loading() {
  const { t } = useLanguage();
  return (
    <div className="space-y-4" aria-label={t.misc.loadingAria}>
      <div className="h-8 w-48 motion-safe:animate-pulse rounded-lg bg-zinc-800" />
      <div className="h-40 motion-safe:animate-pulse rounded-xl bg-zinc-900/70" />
      <div className="h-40 motion-safe:animate-pulse rounded-xl bg-zinc-900/70" />
    </div>
  );
}
