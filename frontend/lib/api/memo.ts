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
// ni mutables (CRM, inventario, perfil, /me ya tiene su propio memo).
// Excepción desde 2026-11-22: la lista de facturas guardadas — lista
// compartida gestionada solo por el admin, la misma para todos los
// lectores, y sus tres mutaciones (crear/cambiar estado/borrar)
// invalidan el prefijo en lib/api/facturas.ts. Los errores NO se
// guardan: un fallo deja la entrada libre para reintentar. Cada
// mutación (crear/editar/borrar curso o clase) invalida su prefijo, así que la lista tras guardar nunca
// muestra datos viejos más de lo que tarda el refetch. Además, desde
// 2026-11-23 el memo se vacía entero al cambiar el token (login,
// logout o 401; lib/api/client.ts): defensa en profundidad para que
// ningún catálogo sobreviva a un cambio de sesión.
export interface CatalogMemo {
  get<T>(key: string, fetcher: () => Promise<T>): Promise<T>;
  invalidate(keyPrefix: string): void;
  /** Vacía toda la caché (2026-11-23): al cambiar el token (login,
   * logout o 401) ningún catálogo del usuario anterior debe sobrevivir
   * al siguiente; los fetches en vuelo no se guardan por la generación. */
  clear(): void;
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

    clear() {
      generation += 1;
      cache.clear();
    },
  };
}

/** Instancia compartida por los módulos de catálogo (academy, clases). */
export const catalogMemo = createCatalogMemo();
