// Dominio referidos del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { Referral, ReferralCampaign, ReferralCampaignInput, ReferralInput, ReferralStatus } from "./types";

export const referidosApi = {
  listReferralCampaigns: (status?: string, opts?: { signal?: AbortSignal }) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<ReferralCampaign[]>(`/api/referrals/campaigns${qs}`, { auth: true, retry: true, signal: opts?.signal });
  },
  createReferralCampaign: (body: ReferralCampaignInput) =>
    request<ReferralCampaign>("/api/referrals/campaigns", { method: "POST", auth: true, body }),
  updateReferralCampaign: (id: number, body: ReferralCampaignInput) =>
    request<ReferralCampaign>(`/api/referrals/campaigns/${id}`, { method: "PUT", auth: true, body }),
  listReferrals: (campaignId: number, status?: string, opts?: { signal?: AbortSignal }) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<Referral[]>(`/api/referrals/campaigns/${campaignId}/referrals${qs}`, { auth: true, retry: true, signal: opts?.signal });
  },
  registerReferral: (campaignId: number, body: ReferralInput) =>
    request<Referral>(`/api/referrals/campaigns/${campaignId}/referrals`, { method: "POST", auth: true, body }),
  updateReferralStatus: (id: number, status: ReferralStatus) =>
    request<Referral>(`/api/referrals/referrals/${id}`, { method: "PATCH", auth: true, body: { status } }),
};
