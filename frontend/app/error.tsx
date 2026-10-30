"use client";

/** Página de error propia (corrida 3 agentes 2026-10-29): antes caía en la
 * página genérica de Next.js, en inglés y fuera del tema oscuro. */
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 text-center">
      <h1 className="text-xl font-bold text-zinc-100">Algo salió mal</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-400">
        La página no se pudo mostrar. Inténtalo de nuevo; si el problema continúa, vuelve al
        inicio.
      </p>
      <div className="mt-6 flex gap-2">
        <button
          onClick={reset}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          Reintentar
        </button>
        <a
          href="/"
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
        >
          Ir al inicio
        </a>
      </div>
    </main>
  );
}
