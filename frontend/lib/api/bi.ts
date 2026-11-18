// Dominio BI del API (NEST, 2026-11-17): Nest Business Intelligence.
// Todo require_admin en el backend. Ventas = facturas PAGADAS; sin costos
// registrados, rentabilidad es null + costos_sin_datos: true. El frontend
// nunca suma facturas en el navegador: los agregados los calcula el servidor.
import { request } from "./client";
import type {
  BiClientes, BiResumen, BiVentasPoint, BusinessCost, BusinessCostCategory,
  BusinessCostInput, BusinessCostUpdate,
} from "./types";

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const biApi = {
  getResumen: (range: { from: string; to: string }, opts?: { signal?: AbortSignal }) =>
    request<BiResumen>(
      `/api/business/marketing/bi/resumen${qs({ from: range.from, to: range.to })}`,
      { auth: true, retry: true, signal: opts?.signal },
    ),
  listVentas: (
    range: { from: string; to: string },
    filters?: { contact_id?: number },
    opts?: { signal?: AbortSignal },
  ) =>
    request<BiVentasPoint[]>(
      `/api/business/marketing/bi/ventas${qs({
        from: range.from, to: range.to,
        contact_id: filters?.contact_id !== undefined ? String(filters.contact_id) : undefined,
      })}`,
      { auth: true, retry: true, signal: opts?.signal },
    ),
  getClientes: (opts?: { signal?: AbortSignal }) =>
    request<BiClientes>("/api/business/marketing/bi/clientes", {
      auth: true, retry: true, signal: opts?.signal,
    }),
  // ---------- Costos (admin) ----------
  listCosts: (
    filters?: { from?: string; to?: string; category?: BusinessCostCategory },
    opts?: { signal?: AbortSignal },
  ) =>
    request<BusinessCost[]>(
      `/api/business/marketing/bi/costos${qs({
        from: filters?.from, to: filters?.to, category: filters?.category,
      })}`,
      { auth: true, retry: true, signal: opts?.signal },
    ),
  createCost: (body: BusinessCostInput) =>
    request<BusinessCost>("/api/business/marketing/bi/costos", { method: "POST", auth: true, body }),
  updateCost: (id: number, body: BusinessCostUpdate) =>
    request<BusinessCost>(`/api/business/marketing/bi/costos/${id}`, { method: "PUT", auth: true, body }),
  deleteCost: (id: number) =>
    request<void>(`/api/business/marketing/bi/costos/${id}`, { method: "DELETE", auth: true }),
};
