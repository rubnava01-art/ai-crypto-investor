// Dominio suscripciones (Fase 7 mejoras-v1): ver la suscripción propia
// y cancelarla. Sin pago en línea: la activación la hace el admin.
import { request } from "./client";
import type { CancelarSuscripcionResult, MiSuscripcion } from "./types";

export const suscripcionesApi = {
  getMiSuscripcion: () => request<MiSuscripcion>("/api/suscripciones/mia", { auth: true }),
  cancelarMiSuscripcion: () =>
    request<CancelarSuscripcionResult>("/api/suscripciones/mia/cancelar", {
      method: "POST",
      auth: true,
    }),
};
