# /herramientas — RECONCILIADO (fusión mejoras-todas, 2026-11-26)

## Estado actual

La reconciliación ya ocurrió en la rama `mejoras-todas`: los archivos
publicados en remoto (db459314) **sí están en este árbol** (venían de
la base, contenido remoto sync #72):

- `frontend/lib/herramientas.ts` — catálogo de 26 herramientas
- `frontend/components/HerramientasSection.tsx`
- `frontend/app/herramientas/page.tsx`
- la versión publicada de `frontend/app/sitemap.ts` (con /herramientas)

## Lo que sigue sin hacerse (y por qué)

La ruta `frontend/app/herramientas/[slug]/page.tsx` sigue devolviendo
404 para todo slug, **a propósito**: el catálogo real NO tiene
título/descripción/texto por herramienta — solo `id`, `categoria`,
`featureKey`, `href` (la ruta real de la herramienta en la app) y
`free`. Los títulos/descripciones viven en i18n dentro de
`HerramientasSection`, y cada herramienta se abre en su página real
(vía `href`), no en una página propia. Inventar un texto por
herramienta para rellenar `[slug]` violaría la regla de no inventar
contenido. Si algún día el catálogo gana texto propio por herramienta,
entonces sí: `generateStaticParams()` desde `lib/herramientas.ts`,
página por slug con 404 si no existe, y sus rutas al sitemap + ItemList
al JSON-LD. Mientras tanto: sin entradas `[slug]` en el sitemap (dan
404) y sin ItemList inventado.

## Motivo original (histórico, ya resuelto)

En mejoras-v1 (base b1d66d1) esos cuatro archivos no existían: la
sección vivía solo en main remota y traerla estaba bloqueado por un
control de riesgo de ejecución. La Fase 3 dejó solo la estructura de
`[slug]` (plantilla + `generateStaticParams()` vacío + 404 honesto) sin
inventar contenido, y la Fase 5b aplicó lo público a la calculadora de
interés compuesto del héroe (Copiar/Compartir + «Guardar creando
cuenta»); el resto quedó pendiente de esta reconciliación, que ya se
hizo aquí: los archivos llegaron con la base (contenido remoto sync
#72), no por descarga.
