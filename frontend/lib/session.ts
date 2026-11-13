// Redirecciones de sesión — ÚNICO dueño (2026-11-13, C2/A4/A5/M10).
// Antes cada sitio construía su propia URL de /login: page.tsx perdía
// &expired=1, ModuleShell y usuarios perdían la query del destino y el
// cliente API solo conservaba el pathname. Toda redirección a /login por
// falta de sesión o sesión expirada pasa por aquí, y /login valida el
// destino con isSafeNext antes de usarlo.

/** Construye /login con destino preservado y, si se indica, expired=1.
 * `next` debe ser pathname+search internos (p. ej. "/crm?tab=x"). */
export function loginUrl(next: string, opts: { expired?: boolean } = {}): string {
  const params = new URLSearchParams();
  if (next) params.set("next", next);
  if (opts.expired) params.set("expired", "1");
  const q = params.toString();
  return q ? `/login?${q}` : "/login";
}

/** URL de login por sesión expirada desde la ubicación actual del
 * navegador (conserva pathname + query, p. ej. ?tab=… o filtros). */
export function expiredLoginUrlFromLocation(): string {
  if (typeof window === "undefined") return loginUrl("/", { expired: true });
  return loginUrl(window.location.pathname + window.location.search, { expired: true });
}

/** Validación estricta de ?next= (A4): solo rutas internas mismas.
 * Rechaza: backslash ("/\evil.com" se normaliza a "//evil.com"),
 * slashes codificados (%2f, %5c), caracteres de control, URLs absolutas
 * y el propio /login (quedarse atascado tras autenticarse). */
export function isSafeNext(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  if (/%2f|%5c|%00/i.test(value)) return false;
  if (/[\x00-\x1f\x7f]/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value, "http://localhost");
  } catch {
    return false;
  }
  // Con base http://localhost, una URL absoluta con otro origen conserva
  // su host; el startsWith("/") de arriba ya descarta "//evil.com", y
  // aquí se descarta cualquier pathname que sea la propia página de login.
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return false;
  return true;
}

/** Destino seguro tras el login, o el fallback si el ?next= no es válido. */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  return isSafeNext(value) ? (value as string) : fallback;
}
