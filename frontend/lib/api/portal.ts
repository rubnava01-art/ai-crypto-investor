// Dominio portal del API (NEST, 2026-11-17): Nest Client Portal.
// SOLO endpoints /api/business/marketing/portal/* — el frontend del portal
// nunca llama a listContacts / listInvoices / listReferralCampaigns.
// El contact_id nunca viene del cliente: el servidor lo deriva del vínculo
// usuario↔contacto; solo el admin pasa ?contact_id= para la vista previa.
import { request } from "./client";
import type {
  Appointment, PortalCampaignsResponse, PortalInvoice, PortalMeResponse,
  PortalResumen, PortalTasksResponse, PortalVinculo, PortalVinculoInput,
} from "./types";

function previewQs(contactId?: number): string {
  return contactId !== undefined ? `?contact_id=${contactId}` : "";
}

export const portalApi = {
  /** Ficha del cliente vinculado. Admin: ?contact_id= para vista previa. */
  getPortalMe: (contactId?: number, opts?: { signal?: AbortSignal }) =>
    request<PortalMeResponse>(`/api/business/marketing/portal/me${previewQs(contactId)}`, {
      auth: true, retry: true, signal: opts?.signal,
    }),
  listPortalCampaigns: (contactId?: number, opts?: { signal?: AbortSignal }) =>
    request<PortalCampaignsResponse>(`/api/business/marketing/portal/campanas${previewQs(contactId)}`, {
      auth: true, retry: true, signal: opts?.signal,
    }),
  listPortalInvoices: (contactId?: number, opts?: { signal?: AbortSignal }) =>
    request<PortalInvoice[]>(`/api/business/marketing/portal/facturas${previewQs(contactId)}`, {
      auth: true, retry: true, signal: opts?.signal,
    }),
  listPortalTasks: (contactId?: number, opts?: { signal?: AbortSignal }) =>
    request<PortalTasksResponse>(`/api/business/marketing/portal/tareas${previewQs(contactId)}`, {
      auth: true, retry: true, signal: opts?.signal,
    }),
  listPortalAppointments: (contactId?: number, opts?: { signal?: AbortSignal }) =>
    request<Appointment[]>(`/api/business/marketing/portal/citas${previewQs(contactId)}`, {
      auth: true, retry: true, signal: opts?.signal,
    }),
  getPortalResumen: (contactId?: number, opts?: { signal?: AbortSignal }) =>
    request<PortalResumen>(`/api/business/marketing/portal/resumen${previewQs(contactId)}`, {
      auth: true, retry: true, signal: opts?.signal,
    }),
  // ---------- Vínculos usuario↔cliente (solo admin) ----------
  listVinculos: (opts?: { signal?: AbortSignal }) =>
    request<PortalVinculo[]>("/api/business/marketing/portal/vinculos", {
      auth: true, retry: true, signal: opts?.signal,
    }),
  createVinculo: (body: PortalVinculoInput) =>
    request<PortalVinculo>("/api/business/marketing/portal/vinculos", {
      method: "POST", auth: true, body,
    }),
  deleteVinculo: (contactId: number) =>
    request<void>(`/api/business/marketing/portal/vinculos/${contactId}`, {
      method: "DELETE", auth: true,
    }),
};
