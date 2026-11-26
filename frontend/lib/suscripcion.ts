// Lógica del aviso de fin de prueba dentro de la app (Fase 7
// mejoras-v1, tarea 3): función pura para poder testearla sin
// renderizar el panel. El aviso sale cuando la prueba está activa y
// vence en 3 días o menos (y aún no venció). Una suscripción
// cancelada o vencida NO avisa de "pronto".
// Regla compartida con el backend (app/api/suscripciones.py,
// pruebas_por_vencer; corrección QA H3-2 Fase 7, 2026-11-25):
// días naturales completos restantes (floor) entre 0 y
// DIAS_AVISO_PRUEBA inclusive, es decir, vence en menos de 4 días.
// El backend usa la misma frontera (fin < ahora + 4 días), así que
// banner y /admin/avisos-prueba siempre coinciden.
import type { Suscripcion } from "./api/types";

export const DIAS_AVISO_PRUEBA = 3;

export function mostrarAvisoPrueba(sub: Suscripcion | null): boolean {
  if (sub === null) return false;
  if (sub.estado_efectivo !== "prueba_activa") return false;
  const dias = sub.dias_restantes_prueba;
  if (dias === null || dias === undefined) return false;
  return dias >= 0 && dias <= DIAS_AVISO_PRUEBA;
}
