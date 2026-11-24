// Perfil de acceso por rol (corrida 2026-11-23, chat potente + perfiles).
// Contrato del backend (Agente 2, en paralelo):
//   GET /api/acceso/perfil -> {role, is_admin, es_cliente_vinculado,
//     contacto_id, modulos: string[]}
// Las claves de `modulos` son las mismas que usa ModuleNav (NavKey).
// El frontend solo filtra lo visible; el backend refuerza cada endpoint.
// Chat-opt 2026-11-23: memo 60 s con dedup en vuelo (catalogMemo):
// ModuleNav y el FAB del Asistente pedían /api/acceso/perfil cada uno
// al montar (2 llamadas idénticas por página). El memo se vacía al
// cambiar el token (lib/api/client.ts), así que no sobrevive a un
// cambio de sesión; un cambio de rol tarda como mucho 60 s en verse.
import { request } from "./client";
import { catalogMemo } from "./memo";

export type PerfilRole = "super_admin" | "admin" | "prueba" | "cliente" | "invitado";

export type PerfilResponse = {
  role: PerfilRole;
  is_admin: boolean;
  es_cliente_vinculado: boolean;
  contacto_id: number | null;
  modulos: string[];
};

export const accesoApi = {
  /** Perfil de acceso: rol + módulos que le tocan a esta cuenta. */
  getPerfil: (opts?: { signal?: AbortSignal }) =>
    catalogMemo.get<PerfilResponse>("/api/acceso/perfil", () =>
      request<PerfilResponse>("/api/acceso/perfil", {
        auth: true,
        retry: true,
        signal: opts?.signal,
      }),
    ),
};
