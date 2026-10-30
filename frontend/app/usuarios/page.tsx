"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../../lib/api";
import { ModuleShell } from "../../components/ModuleShell";
import { UsersPanel } from "../../components/UsersPanel";

/** Módulo Control de usuarios (2026-10-30): el control maestro de
 * cuentas — aprobar/rechazar pendientes, cambiar roles, cambiar y
 * restablecer claves, borrar usuarios. Solo administradores: cualquier
 * otro rol es devuelto al dashboard. */
export default function UsuariosPage() {
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
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
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
    <ModuleShell
      moduleTitle="Control de usuarios"
      subtitle="Control maestro: aprobar cuentas nuevas, cambiar roles y claves, restablecer accesos"
    >
      <UsersPanel />
    </ModuleShell>
  );
}
