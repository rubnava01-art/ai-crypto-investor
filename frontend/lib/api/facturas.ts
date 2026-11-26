// Dominio facturas del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import { catalogMemo } from "./memo";
import type { Invoice, InvoiceItem, InvoiceStatus } from "./types";

export const facturasApi = {
  // Lista casi estática (2026-11-22): la lista guardada es la misma
  // para todos los lectores (solo el admin escribe) y cada navegación
  // de vuelta a Facturas — y cada visita a Correos/CRM que la lee —
  // volvía a pedirla; memo 60 s en cliente como Academia/Clases/
  // Tendencias, y el backend la marca Cache-Control private
  // max-age=60. Crear, cambiar estado y borrar invalidan el prefijo,
  // así que tras guardar nunca se muestra la lista vieja (el panel
  // además recarga tras cada mutación).
  // La señal del llamador (useAsyncLoad al desmontar) NO se pasa al
  // fetch memoizado: la petición en vuelo es compartida y abortarla
  // un consumidor dejaría a los demás sin datos; el hook ya evita
  // escribir tras desmontar con su guarda `cancelled`.
  listInvoices: (opts?: { signal?: AbortSignal }) =>
    catalogMemo.get<Invoice[]>("/api/facturas/invoices", () =>
      request<Invoice[]>("/api/facturas/invoices", { auth: true, retry: true }),
    ),
  createInvoice: (body: { number?: string; client_name: string; client_email?: string; client_phone?: string; items: InvoiceItem[]; tax_rate?: number; due_date?: string | null; notes?: string }) =>
    request<Invoice>("/api/facturas/invoices", { method: "POST", auth: true, body }).then((res) => {
      catalogMemo.invalidate("/api/facturas/invoices");
      return res;
    }),
  updateInvoiceStatus: (id: number, status: InvoiceStatus) =>
    request<Invoice>(`/api/facturas/invoices/${id}`, { method: "PATCH", auth: true, body: { status } }).then((res) => {
      catalogMemo.invalidate("/api/facturas/invoices");
      return res;
    }),
  // Fecha de vencimiento de una factura existente (Fase 5b, tarea 2;
  // cierra el pendiente de Fase 4): fijar con "AAAA-MM-DD" o borrar
  // con null. El endpoint PATCH ya lo soportaba (fix H1 Fase 4); aquí
  // solo faltaba el cliente y el control por fila del panel.
  updateInvoiceDueDate: (id: number, due_date: string | null) =>
    request<Invoice>(`/api/facturas/invoices/${id}`, { method: "PATCH", auth: true, body: { due_date } }).then((res) => {
      catalogMemo.invalidate("/api/facturas/invoices");
      return res;
    }),
  deleteInvoice: (id: number) =>
    request<void>(`/api/facturas/invoices/${id}`, { method: "DELETE", auth: true }).then((res) => {
      catalogMemo.invalidate("/api/facturas/invoices");
      return res;
    }),
};
