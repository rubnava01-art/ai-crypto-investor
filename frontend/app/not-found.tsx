/** Página 404 propia (corrida 3 agentes 2026-10-29): antes caía en la página
 * genérica de Next.js, en inglés y fuera del tema oscuro.
 *
 * Corrección QA H3 (Fase 3 mejoras-v1, 2026-11-25): componente de
 * SERVIDOR con texto estático en español. Antes era "use client" con
 * useLanguage y el texto solo existía tras hidratar, así que sin
 * JavaScript la página no mostraba nada. Ahora "Página no encontrada"
 * y "Volver al inicio" viajan en el HTML inicial. Los textos son los
 * mismos del diccionario español (misc.notFoundTitle/notFoundBody/
 * backHome); la marca es el nombre público de la plataforma. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-zinc-950 px-4 py-10 text-center">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-400">
        Grow Business Platform
      </p>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Página no encontrada</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-400 [text-wrap:balance]">
        La ruta que buscas no existe o cambió de lugar.
      </p>
      <a
        href="/"
        className="mt-6 inline-flex min-h-[2.75rem] items-center rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
      >
        Volver al inicio
      </a>
    </main>
  );
}
