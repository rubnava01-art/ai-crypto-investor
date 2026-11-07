"use client";

import ErrorPage from "../error";

/** Límite de error propio de la ruta (optimización 2026-11-06): un fallo
 * en este módulo muestra el error de la app sin tumbar el resto de la
 * navegación; reutiliza la página de error raíz, sin textos nuevos. */
export default function RouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorPage reset={reset} />;
}
