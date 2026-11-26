// Buscador global (Fase 4 mejoras-v1, tarea 4): lógica pura de la
// paleta de comandos (Ctrl+K). Sin React ni fetch: se prueba con
// node --test (lib/buscador.test.ts). La búsqueda ignora acentos y
// mayúsculas (mismo patrón que el buscador de módulos de ModuleNav) y
// exige que TODOS los tokens de la consulta aparezcan en título o
// descripción; ordena por relevancia (título que empieza por la
// consulta, luego título que la contiene, luego descripción).
export type BuscadorKind = "modulo" | "accion" | "cliente";

export interface BuscadorItem {
  id: string;
  kind: BuscadorKind;
  titulo: string;
  descripcion: string;
  href: string;
}

export function normalizarBuscador(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function relevancia(item: BuscadorItem, queryNorm: string): number {
  const titulo = normalizarBuscador(item.titulo);
  const desc = normalizarBuscador(item.descripcion);
  if (titulo.startsWith(queryNorm)) return 0;
  if (titulo.includes(queryNorm)) return 1;
  if (desc.includes(queryNorm)) return 2;
  return 3;
}

export function filtrarBuscador(items: BuscadorItem[], query: string): BuscadorItem[] {
  const tokens = normalizarBuscador(query)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [...items];
  const texto = (item: BuscadorItem) =>
    normalizarBuscador(`${item.titulo} ${item.descripcion}`);
  const queryNorm = tokens.join(" ");
  return items
    .filter((item) => {
      const hay = texto(item);
      return tokens.every((tok) => hay.includes(tok));
    })
    .sort((a, b) => {
      const ra = relevancia(a, queryNorm);
      const rb = relevancia(b, queryNorm);
      if (ra !== rb) return ra - rb;
      return a.titulo.localeCompare(b.titulo, "es");
    });
}
