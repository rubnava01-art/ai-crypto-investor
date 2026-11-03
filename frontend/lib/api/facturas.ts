// Dominio facturas del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { Invoice, InvoiceItem, InvoiceStatus } from "./types";

export const facturasApi = {
  listInvoices: (opts?: { signal?: AbortSignal }) =>
    request<Invoice[]>("/api/facturas/invoices", { auth: true, retry: true, signal: opts?.signal }),
  createInvoice: (body: { number?: string; client_name: string; client_email?: string; client_phone?: string; items: InvoiceItem[]; tax_rate?: number; notes?: string }) =>
    request<Invoice>("/api/facturas/invoices", { method: "POST", auth: true, body }),
  updateInvoiceStatus: (id: number, status: InvoiceStatus) =>
    request<Invoice>(`/api/facturas/invoices/${id}`, { method: "PATCH", auth: true, body: { status } }),
  deleteInvoice: (id: number) =>
    request<void>(`/api/facturas/invoices/${id}`, { method: "DELETE", auth: true }),
};
