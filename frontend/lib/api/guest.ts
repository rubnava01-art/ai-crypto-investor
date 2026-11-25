// Sesión de invitado / lite sin registro (Fase 1, 2026-11-23).
// Contrato API (lo implementa el backend; si aún no existe, el CTA de
// la landing muestra el aviso de no disponible y NO inventa el flujo):
//   POST /api/auth/guest  body {challenge_id, challenge_answer}
//   -> {access_token, token_type:"bearer", expires_in:900,
//       perfil:"invitado", modulos:["inicio","estudiar","planes","asistente"]}
// El reto matemático se reutiliza de /api/auth/register-challenge.
// El token invitado dura 15 min, sin refresh, sin fila de usuario y sin
// persistencia de invitado. Sin PII.
import { request, setGuestToken } from "./client";
import type { RegisterChallenge } from "./types";

export type GuestTokenResponse = {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  perfil: "invitado";
  modulos: string[];
};

/** Módulos del invitado (mismo conjunto que el contrato del backend).
 * Lo usa ModuleNav como fallback fail-closed si /api/acceso/perfil
 * falla con sesión de invitado. */
export const GUEST_MODULES: readonly string[] = ["inicio", "estudiar", "planes", "asistente"];

export const guestApi = {
  /** Reto matemático para la prueba sin registro (mismo que registro). */
  challenge: () => request<RegisterChallenge>("/api/auth/register-challenge"),
  /** Calienta el backend (GET /api/health, sin auth) mientras el
   * visitante resuelve el reto: en el free tier la primera petición
   * despierta el servidor y las siguientes ya llegan calientes. Se
   * dispara al abrir el modal (y al pasar el cursor por el botón) y
   * nunca bloquea el flujo: un fallo se traga en silencio. */
  warmup: () => request<{ status: string }>("/api/health").catch(() => undefined),
  /** Emite el token invitado y lo guarda como sesión de invitado. */
  start: async (challenge_id: string, challenge_answer: number) => {
    const res = await request<GuestTokenResponse>("/api/auth/guest", {
      method: "POST",
      body: { challenge_id, challenge_answer },
    });
    setGuestToken(res.access_token);
    return res;
  },
};
