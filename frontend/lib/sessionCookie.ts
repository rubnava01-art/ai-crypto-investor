// Cookie marcadora de sesión — corrección QA H2 (Fase 3 mejoras-v1,
// 2026-11-25).
//
// Problema: el servidor siempre renderizaba <Landing/> y el cliente la
// sustituía al hidratar por el skeleton y luego por el dashboard (dos
// swaps + hydration mismatch) para usuarios con sesión. El token vive
// en localStorage y el servidor no puede leerlo, así que la raíz no
// podía decidir sin JavaScript.
//
// Solución: una cookie marcadora NO SENSIBLE (`gpb_session=1`, sin datos
// personales, sin el token — el token sigue en localStorage como hoy)
// que se pone al iniciar sesión con cuenta y se borra al cerrar sesión
// o expirar (vía logout(), que es el punto central de ambos casos).
// `app/page.tsx` (servidor) la lee con `cookies()` y sirve la cáscara
// del dashboard en vez de la landing; sin ella sirve la landing SSR.
// Los invitados NO ponen la cookie: su flujo sigue siendo
// landing → /inicio como antes.
//
// Salvaguardas:
// - Si la cookie dice sesión pero el token no existe (o es de
//   invitado), el cliente cae al flujo actual: RootGate reconcilia
//   tras hidratar y muestra la landing (un solo swap, solo en ese
//   caso límite) sin romper nada.
// - La cookie caduca a los 30 días; si caduca antes que el token, el
//   servidor sirve la landing y el cliente hace el único swap a
//   dashboard, igual que antes de esta corrección.
// - `Secure` solo en HTTPS: en desarrollo local (http) la cookie debe
//   seguir funcionando.
// - La cookie NO autoriza nada: el gate real sigue siendo el backend
//   (el token) más el chequeo de presencia en cliente.

/** Nombre de la cookie marcadora (valor fijo "1", sin datos). */
export const SESSION_COOKIE_NAME = "gpb_session";
export const SESSION_COOKIE_VALUE = "1";
/** 30 días: mayor que la sesión de 60 min del token; la cookie solo
 * decide qué cáscara sirve el servidor, nunca autoriza. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Cadena `Set-Cookie` (vía document.cookie) para marcar sesión. */
export function buildSessionCookie(): string {
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  return (
    `${SESSION_COOKIE_NAME}=${SESSION_COOKIE_VALUE}; Path=/; ` +
    `Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`
  );
}

/** Cadena `Set-Cookie` para borrar la marca (misma ruta y SameSite). */
export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Marca sesión en el navegador (al iniciar sesión con cuenta). */
export function setSessionCookie(): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = buildSessionCookie();
  } catch {
    /* almacenamiento no disponible: la sesión sigue valiendo, solo se
       pierde la decisión del servidor (destello como antes) */
  }
}

/** Borra la marca (al cerrar sesión, expirar o entrar como invitado). */
export function clearSessionCookie(): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = buildClearSessionCookie();
  } catch {
    /* nada que limpiar */
  }
}

/** ¿Dice la cabecera `Cookie` que hay sesión con cuenta? Solo el valor
 * exacto `gpb_session=1` cuenta; cualquier otro valor es "sin sesión". */
export function hasSessionCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(";")
    .some((part) => part.trim() === `${SESSION_COOKIE_NAME}=${SESSION_COOKIE_VALUE}`);
}

/** Qué cáscara sirve el servidor para el valor de la cookie: "dashboard"
 * con sesión marcada, "landing" en cualquier otro caso. */
export function rootShellForSessionCookie(
  cookieValue: string | null | undefined,
): "dashboard" | "landing" {
  return cookieValue === SESSION_COOKIE_VALUE ? "dashboard" : "landing";
}
