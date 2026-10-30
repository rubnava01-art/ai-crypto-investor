/** Página 404 propia (corrida 3 agentes 2026-10-29): antes caía en la página
 * genérica de Next.js, en inglés y fuera del tema oscuro. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 text-center">
      <h1 className="text-xl font-bold text-zinc-100">Página no encontrada</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-400">
        La ruta que buscas no existe o cambió de lugar.
      </p>
      <a
        href="/"
        className="mt-6 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
      >
        Volver al inicio
      </a>
    </main>
  );
}
