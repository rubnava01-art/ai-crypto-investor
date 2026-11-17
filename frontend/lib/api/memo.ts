// Memo en memoria para GETs de catálogo casi estáticos (2026-11-17).
//
// El backend ya marca /api/academy/courses y /api/clases/classes con
// `Cache-Control: private, max-age=60`, pero el cliente envía
// `cache: "no-store"` en cada fetch, así que la caché HTTP nunca evita
// el viaje: cada montaje de AcademyPanel y de las dos secciones de
// ClasesPanel volvía a pedir el mismo catálogo. Este memo aplica el
// mismo patrón que /me en lib/api/client.ts (TTL 60 s + deduplicación
// de peticiones en vuelo) a esos dos listados.
//
// Solo para lecturas de catálogo: nunca se memoizan datos por usuario
// ni mutables (CRM, facturas, inventario, perfil, /me ya tiene su
// propio memo). Los errores NO se guardan: un fallo deja la entrada
// libre para reintentar. Cada mutación (crear/editar/borrar curso o
// clase) invalida su prefijo, así que la lista tras guardar nunca
// muestra datos viejos más de lo que tarda el refetch.
export interface CatalogMemo {
  get<T>(key: string, fetcher: () => Promise<T>): Promise<T>;
  invalidate(keyPrefix: string): void;
}

export const CATALOG_MEMO_TTL_MS = 60_000;

export function createCatalogMemo(ttlMs: number = CATALOG_MEMO_TTL_MS): CatalogMemo {
  const cache = new Map<string, { at: number; data: unknown }>();
  const inflight = new Map<string, Promise<unknown>>();
  // Generación global: si una mutación invalida mientras un fetch está
  // en vuelo, su resultado ya es viejo y no debe guardarse en caché.
  let generation = 0;

  return {
    async get<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
      const pending = inflight.get(key);
      if (pending) return pending as Promise<T>;
      const genAtStart = generation;
      const p = fetcher().then(
        (data) => {
          if (genAtStart === generation) cache.set(key, { at: Date.now(), data });
          inflight.delete(key);
          return data;
        },
        (err) => {
          inflight.delete(key);
          throw err;
        },
      );
      inflight.set(key, p);
      return p;
    },

    invalidate(keyPrefix: string) {
      generation += 1;
      for (const key of [...cache.keys()]) {
        if (key.startsWith(keyPrefix)) cache.delete(key);
      }
    },
  };
}

/** Instancia compartida por los módulos de catálogo (academy, clases). */
export const catalogMemo = createCatalogMemo();
