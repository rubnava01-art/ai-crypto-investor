// Dominio marketing del API (NEST, 2026-11-17): citas y campañas de
// marketing general. Prefijo /api/business/marketing (Negocio > Marketing).
// Las citas usan ISO UTC con offset; el render usa America/Los_Angeles
// explícito (lib/dates.ts).
import { request } from "./client";
import type {
  Appointment, AppointmentInput, AppointmentStatus, AppointmentUpdate,
  MarketingCampaign, MarketingCampaignInput,
} from "./types";

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const marketingApi = {
  // ---------- Citas ----------
  listAppointments: (
    filters?: { status?: AppointmentStatus; from?: string; to?: string; contact_id?: number },
    opts?: { signal?: AbortSignal },
  ) =>
    request<Appointment[]>(
      `/api/business/marketing/citas${qs({
        status: filters?.status,
        from: filters?.from,
        to: filters?.to,
        contact_id: filters?.contact_id !== undefined ? String(filters.contact_id) : undefined,
      })}`,
      { auth: true, retry: true, signal: opts?.signal },
    ),
  createAppointment: (body: AppointmentInput) =>
    request<Appointment>("/api/business/marketing/citas", { method: "POST", auth: true, body }),
  updateAppointment: (id: number, body: AppointmentUpdate) =>
    request<Appointment>(`/api/business/marketing/citas/${id}`, { method: "PATCH", auth: true, body }),
  deleteAppointment: (id: number) =>
    request<void>(`/api/business/marketing/citas/${id}`, { method: "DELETE", auth: true }),

  // ---------- Campañas de marketing ----------
  listCampaigns: (
    filters?: { status?: string; channel?: string; contact_id?: number },
    opts?: { signal?: AbortSignal },
  ) =>
    request<MarketingCampaign[]>(
      `/api/business/marketing/campanas${qs({
        status: filters?.status,
        channel: filters?.channel,
        contact_id: filters?.contact_id !== undefined ? String(filters.contact_id) : undefined,
      })}`,
      { auth: true, retry: true, signal: opts?.signal },
    ),
  createCampaign: (body: MarketingCampaignInput) =>
    request<MarketingCampaign>("/api/business/marketing/campanas", { method: "POST", auth: true, body }),
  updateCampaign: (id: number, body: MarketingCampaignInput) =>
    request<MarketingCampaign>(`/api/business/marketing/campanas/${id}`, { method: "PUT", auth: true, body }),
  deleteCampaign: (id: number) =>
    request<void>(`/api/business/marketing/campanas/${id}`, { method: "DELETE", auth: true }),
};
