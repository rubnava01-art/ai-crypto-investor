"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { getToken, isGuest } from "../lib/api";
import { useLanguage } from "../lib/i18n";
import { MetricCardSkeleton, Skeleton } from "./Skeleton";

/** Puerta de la raíz (Fase 3 mejoras-v1, SEO; corrección QA H2
 * 2026-11-25): decide en el cliente si se ve la presentación pública
 * o el dashboard.
 *
 * - Sin sesión marcada (serverHasSession=false), el servidor ya sirvió
 *   <Landing /> y aquí no se toca nada: sin flash ni re-render.
 * - Con sesión marcada (serverHasSession=true), el servidor ya sirvió
 *   la cáscara del dashboard (el skeleton de DashboardPage, que es
 *   dynamic ssr:false) y el primer render del cliente es el mismo
 *   skeleton: sin destello de landing y sin hydration mismatch.
 * - Tras hidratar se reconcilia con el token real: si la cookie decía
 *   sesión pero el token no existe (o es de invitado), se cae a la
 *   landing (un solo swap, solo en ese caso límite); el invitado va a
 *   /inicio como antes. */
const DashboardPage = dynamic(() => import("./DashboardPage"), {
  ssr: false,
  loading: () => <DashboardSkeleton />,
});

function DashboardSkeleton() {
  const { t } = useLanguage();
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Fase 3 mejoras-v1, tarea 6: el esqueleto solo, sin texto, dejaba
          la espera sin explicar nada hasta que el ColdStartNotice
          aparecía a los 5 s. Texto visible y honesto desde el segundo 0
          (sin prometer tiempos). */}
      <div role="status" aria-label={t.misc.loadingAria} className="space-y-4">
        <p className="text-sm text-zinc-400">{t.common.loading}</p>
        <Skeleton className="h-8 w-48 rounded-lg" ariaLabel={t.misc.loadingAria} />
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <MetricCardSkeleton key={i} ariaLabel={t.misc.loadingAria} />
          ))}
        </div>
        <Skeleton className="h-40 w-full rounded-xl" ariaLabel={t.misc.loadingAria} />
        <Skeleton className="h-40 w-full rounded-xl" ariaLabel={t.misc.loadingAria} />
      </div>
    </main>
  );
}

export function RootGate({
  landing,
  serverHasSession,
}: {
  landing: ReactNode;
  serverHasSession: boolean;
}) {
  const router = useRouter();
  // El valor inicial es la decisión del servidor (misma en servidor y
  // cliente: sin mismatch). Solo se corrige tras hidratar, si el token
  // real no coincide con la cookie.
  const [showDashboard, setShowDashboard] = useState(serverHasSession);

  useEffect(() => {
    // Reconciliación única tras hidratar: la cookie puede estar
    // obsoleta (sesión cerrada en otra pestaña, cookie caducada). Si no
    // hay token de cuenta, se cae a la landing; el invitado va a
    // /inicio como antes.
    setShowDashboard(!!getToken() && !isGuest());
    if (getToken() && isGuest()) {
      router.replace("/inicio");
    }
  }, [router]);

  if (showDashboard) {
    return <DashboardPage />;
  }
  return <>{landing}</>;
}
