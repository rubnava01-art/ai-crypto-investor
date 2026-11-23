// Validación de URLs guardadas antes de renderizarlas como enlaces o
// imágenes (corrida SEGURIDAD 2026-11-23).
//
// `normalizeClassUrl` es el espejo frontend de la regla de URLs del
// backend (E3): solo http/https con host. Sin esquema se normaliza a
// https://; cualquier otro esquema se rechaza. Vivía en ClasesPanel y
// ahora se reutiliza en Recomendaciones, Academy y Planes (F4).
// `isSafeAvatarSrc` (F5, B6): el avatar solo se renderiza si es
// `data:image/` o URL https; cualquier otro valor guardado por otra
// vía no llega a un <img>.
export function normalizeClassUrl(raw: string): { url: string } | { error: true } {
  const value = raw.trim();
  if (!value) return { url: "" };
  if (value.startsWith("//")) return { url: `https:${value}` };
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (s !== "http" && s !== "https") return { error: true };
    const rest = value.slice(scheme[0].length);
    if (!rest.startsWith("//")) {
      // V1 del QA de Clases (2026-11-12): "http:example.com" pasaba
      // este filtro y el backend lo rechazaba con 422 (sin netloc).
      // Sin autoridad se normaliza a https:// + el resto sin barras.
      const hostpart = rest.replace(/^\/+/, "");
      if (!hostpart) return { error: true };
      return { url: `https://${hostpart}` };
    }
    // "http://" sin host también lo rechaza el backend (sin netloc).
    if (!rest.slice(2).split("/")[0]) return { error: true };
    return { url: value };
  }
  return { url: `https://${value}` };
}

/** Devuelve la URL lista para `href` si es http/https válida, o `null`
 * si hay que no renderizar el enlace (esquema no admitido o vacía). */
export function safeHttpHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = normalizeClassUrl(raw);
  if ("error" in normalized) return null;
  return normalized.url || null;
}

/** Solo `data:image/` o URL https. En <img>, `data:text/html` no
 * ejecuta y `javascript:` no corre en navegadores modernos, pero un
 * valor no-imagen guardado por otra vía no debe renderizarse. */
export function isSafeAvatarSrc(src: string | null | undefined): src is string {
  if (!src) return false;
  if (src.startsWith("data:image/")) return true;
  if (src.startsWith("https://")) return true;
  return false;
}
