// Ruta propia del portal del cliente (corrida 2026-11-23, perfiles).
// Antes el portal solo existía como sub-pestaña de /business
// (Negocio > Marketing > Portal), y el perfil "cliente vinculado"
// no tiene "business" en sus módulos: sin esta ruta no podía llegar
// a su portal desde el menú. La página reutiliza ClientPortalPanel
// tal cual (sus datos ya vienen filtrados por contacto en servidor);
// no se duplica lógica ni se abre ningún dato nuevo.
"use client";

import { useEffect, useState } from "react";
import { api, type MeResponse } from "../../lib/api";
import { ModuleShell } from "../../components/ModuleShell";
import { ClientPortalPanel } from "../../components/portal/ClientPortalPanel";
import { useLanguage } from "../../lib/i18n";

export default function PortalPage() {
  const { t } = useLanguage();
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((m) => {
        if (!cancelled) setMe(m);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ModuleShell moduleTitle={t.portal.panelTitle} subtitle={t.portal.intro}>
      <ClientPortalPanel me={me} isAdmin={!!me?.is_admin} />
    </ModuleShell>
  );
}
