// Perfil de acceso por rol (corrida 2026-11-23, chat potente + perfiles).
// Contrato del backend (Agente 2, en paralelo):
//   GET /api/acceso/perfil -> {role, is_admin, es_cliente_vinculado,
//     contacto_id, modulos: string[]}
// Las claves de `modulos` son las mismas que usa ModuleNav (NavKey).
// El frontend solo filtra lo visible; el backend refuerza cada endpoint.
import { request } from "./client";

export type PerfilRole = "super_admin" | "admin" | "prueba" | "cliente";

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
    request<PerfilResponse>("/api/acceso/perfil", {
      auth: true,
      retry: true,
      signal: opts?.signal,
    }),
};
