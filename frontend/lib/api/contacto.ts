// Dominio mensajes de contacto del API (2026-11-25, plan servicios-calc).
// Contrato del backend (implementación en paralelo, no tocar):
// - POST /api/contacto/mensajes (público, sin auth): { nombre 1-100,
//   email válido, servicio, mensaje 1-2000, website? honeypot }.
//   201 → { id, created_at }. 422 validación, 429 rate limit.
// - GET /api/contacto/mensajes (solo admin): lista desc, paginada.
// - PATCH /api/contacto/mensajes/{id} (admin): { estado }.
// - DELETE /api/contacto/mensajes/{id} (admin): 204.
// El POST público NO lleva token (auth ausente a propósito); el resto
// sigue el patrón de lib/api/correos.ts (auth: true, retry en GET).
import { request } from "./client";
import type { ContactoMensaje, ContactoMensajeCreated, ContactoMensajeEstado, ContactoServicio } from "./types";

export const contactoApi = {
  createContactoMensaje: (body: {
    nombre: string;
    email: string;
    servicio: ContactoServicio;
    mensaje: string;
    website?: string;
  }) => request<ContactoMensajeCreated>("/api/contacto/mensajes", { method: "POST", body }),
  listContactoMensajes: (opts?: { signal?: AbortSignal; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return request<ContactoMensaje[]>(`/api/contacto/mensajes${qs ? `?${qs}` : ""}`, {
      auth: true,
      retry: true,
      signal: opts?.signal,
    });
  },
  updateContactoMensajeEstado: (id: number, estado: ContactoMensajeEstado) =>
    request<ContactoMensaje>(`/api/contacto/mensajes/${id}`, { method: "PATCH", auth: true, body: { estado } }),
  deleteContactoMensaje: (id: number) =>
    request<void>(`/api/contacto/mensajes/${id}`, { method: "DELETE", auth: true }),
};
