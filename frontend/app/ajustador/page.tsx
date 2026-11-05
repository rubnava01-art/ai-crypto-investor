"use client";

import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";
import { AjustadorPanel } from "../../components/AjustadorPanel";

/** Módulo Ajustador (2026-11-05): tablero de mejora continua de la
 * plataforma. Lo administra Swapy y coordina a los 3 agentes que
 * optimizan cada sección del menú. El tablero es de gestión — el
 * trabajo real de los agentes se hace a través de Swapy en las
 * sesiones y en las mejoras diarias — y las propuestas empiezan
 * vacías. A diferencia de /usuarios, la página NO redirige a prueba:
 * prueba ve el tablero y las propuestas en solo lectura; solo el
 * administrador propone, edita o borra. */
export default function AjustadorPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.ajustador.title} subtitle={t.ajustador.subtitle}>
      <AjustadorPanel />
    </ModuleShell>
  );
}
