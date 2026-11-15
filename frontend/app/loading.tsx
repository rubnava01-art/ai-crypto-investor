"use client";

import { useLanguage } from "../lib/i18n";
import { HeroSkeleton, MetricCardSkeleton, Skeleton } from "../components/Skeleton";

// Esqueleto de ruta (rediseño fintech 2026-11-14): reproduce la forma
// real de la página — héroe, franja de métricas y secciones — en vez de
// bloques genéricos, con animate-pulse y respeto a reduced-motion
// (los skeletons del Agente UX/UI usan motion-safe).
export default function Loading() {
  const { t } = useLanguage();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6 sm:py-8" role="status" aria-label={t.misc.loadingAria}>
      <HeroSkeleton ariaLabel={t.misc.loadingAria} />
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <MetricCardSkeleton key={i} ariaLabel={t.misc.loadingAria} />
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-xl" ariaLabel={t.misc.loadingAria} />
      <Skeleton className="h-40 w-full rounded-xl" ariaLabel={t.misc.loadingAria} />
    </div>
  );
}
