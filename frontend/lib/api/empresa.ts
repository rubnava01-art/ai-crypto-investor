// Dominio empresa (Talento / Riesgos / Planillas) — SOLO frontend.
// Contrato esperado del backend (agente Backend): GET/POST/PUT/DELETE en
// /api/talento, /api/riesgos y /api/planillas. La forma de lista del backend
// existente es un array pelado (crm, inventario: response_model=list[...]),
// así que se acepta array pelado y, por tolerancia, {items:[...]}.
// Las escrituras requieren admin (403 para prueba); GET para prueba:
// talento -> [], planillas -> [], riesgos -> lista completa (solo lectura).
// NO hay campos de SSN, banco ni impuestos, y no se mueve dinero: las
// planillas son solo REGISTROS (periodo, empleado, monto, estado).
import { request } from "./client";

export type EmpleadoEstado = "activo" | "inactivo";
export interface Empleado {
  id: number;
  nombre: string;
  puesto: string;
  contacto: string;
  fecha_ingreso: string | null;
  estado: EmpleadoEstado;
  notas: string;
}
export interface EmpleadoInput {
  nombre: string;
  puesto?: string;
  contacto?: string;
  fecha_ingreso?: string | null;
  estado?: EmpleadoEstado;
  notas?: string;
}

export type RiesgoProbabilidad = "baja" | "media" | "alta";
export type RiesgoImpacto = "bajo" | "medio" | "alto";
export type RiesgoEstado = "abierto" | "en_curso" | "mitigado" | "cerrado";
export interface Riesgo {
  id: number;
  riesgo: string;
  descripcion: string;
  probabilidad: RiesgoProbabilidad;
  impacto: RiesgoImpacto;
  mitigacion: string;
  responsable: string;
  estado: RiesgoEstado;
}
export interface RiesgoInput {
  riesgo: string;
  descripcion?: string;
  probabilidad?: RiesgoProbabilidad;
  impacto?: RiesgoImpacto;
  mitigacion?: string;
  responsable?: string;
  estado?: RiesgoEstado;
}

export type PlanillaEstado = "pendiente" | "pagado";
export interface Planilla {
  id: number;
  periodo: string;
  empleado_id: number | null;
  empleado_nombre: string;
  monto: number;
  estado: PlanillaEstado;
  notas: string;
}
export interface PlanillaInput {
  periodo: string;
  empleado_id?: number | null;
  monto?: number;
  estado?: PlanillaEstado;
  notas?: string;
}

// Normaliza la forma de lista: array pelado (patrón actual del backend)
// o {items:[...]} si el backend nuevo opta por envoltorio. Cualquier otra
// forma se trata como lista vacía en vez de romper el panel.
function asList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}

async function list<T>(path: string): Promise<T[]> {
  const data = await request<unknown>(path, { auth: true, retry: true });
  return asList<T>(data);
}

export const empresaApi = {
  listEmpleados: () => list<Empleado>("/api/talento"),
  createEmpleado: (body: EmpleadoInput) =>
    request<Empleado>("/api/talento", { method: "POST", auth: true, body }),
  updateEmpleado: (id: number, body: EmpleadoInput) =>
    request<Empleado>(`/api/talento/${id}`, { method: "PUT", auth: true, body }),
  deleteEmpleado: (id: number) =>
    request<void>(`/api/talento/${id}`, { method: "DELETE", auth: true }),

  listRiesgos: () => list<Riesgo>("/api/riesgos"),
  createRiesgo: (body: RiesgoInput) =>
    request<Riesgo>("/api/riesgos", { method: "POST", auth: true, body }),
  updateRiesgo: (id: number, body: RiesgoInput) =>
    request<Riesgo>(`/api/riesgos/${id}`, { method: "PUT", auth: true, body }),
  deleteRiesgo: (id: number) =>
    request<void>(`/api/riesgos/${id}`, { method: "DELETE", auth: true }),

  listPlanillas: () => list<Planilla>("/api/planillas"),
  createPlanilla: (body: PlanillaInput) =>
    request<Planilla>("/api/planillas", { method: "POST", auth: true, body }),
  updatePlanilla: (id: number, body: PlanillaInput) =>
    request<Planilla>(`/api/planillas/${id}`, { method: "PUT", auth: true, body }),
  deletePlanilla: (id: number) =>
    request<void>(`/api/planillas/${id}`, { method: "DELETE", auth: true }),
};
