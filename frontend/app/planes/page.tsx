"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { PlanesPanel } from "../../components/PlanesPanel";
import { useLanguage } from "../../lib/i18n";

/** Módulo Planes (2026-11-06): sección de precios de suscripción de
 * Grow Business Platform — Esencial $19, Crecimiento $49, Negocio
 * Total $99 al mes, todos con 14 días de prueba gratis (precios
 * aprobados por Rubén). Solo muestra los planes; no hay cobro en
 * línea todavía. */
export default function PlanesPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.planes.title} subtitle={t.planes.subtitle}>
      <PlanesPanel />
    </ModuleShell>
  );
}
