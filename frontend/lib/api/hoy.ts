// Dominio "Hoy" del API (Fase 4 mejoras-v1, tarea 7): lo urgente del día.
import { request } from "./client";
import type { HoyResponse } from "./types";

export const hoyApi = {
  listHoy: (opts?: { signal?: AbortSignal }) =>
    request<HoyResponse>("/api/dashboard/hoy", { auth: true, retry: true, signal: opts?.signal }),
};
