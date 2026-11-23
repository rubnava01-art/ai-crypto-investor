"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../../lib/api";
import { expiredLoginUrlFromLocation } from "../../lib/session";
import { ModuleShell } from "../../components/ModuleShell";
import { TerminalPanel } from "../../components/TerminalPanel";

/** Módulo Terminal (2026-11-05): consola de pruebas dentro de la web.
 * Terminal SIMULADA con comandos integrados seguros (help, status,
 * health, modules, about, date, echo, clear): no ejecuta nada en el
 * servidor y no hay endpoint de ejecución. Solo administradores
 * (entrada adminOnly en el menú). El título y el subtítulo van en
 * texto fijo porque no hay clave de diccionario para terminal.
 * Gate por rol (2026-11-23, M3): mismo patrón que /usuarios — antes
 * solo se ocultaba del menú y un usuario prueba entraba por URL
 * directa. */
export default function TerminalPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((m) => {
        if (m.is_admin) setAllowed(true);
        else router.replace("/");
      })
      .catch((err) => {
        // C2: el 401 usa el redirect central (lib/session.ts) con
        // expired=1 y el destino preservado, como el cliente API.
        if (err instanceof ApiError && err.status === 401) router.replace(expiredLoginUrlFromLocation());
        else router.replace("/");
      });
  }, [router]);

  if (!allowed) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <p className="text-sm text-zinc-400">Cargando…</p>
      </main>
    );
  }

  return (
    <ModuleShell moduleTitle="Terminal" subtitle="Consola de pruebas con comandos seguros.">
      <TerminalPanel />
    </ModuleShell>
  );
}
