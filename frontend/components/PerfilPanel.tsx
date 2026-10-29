"use client";

import { useEffect, useState } from "react";
import { api, type UserProfile } from "../lib/api";
import { Panel } from "./Panel";
import { ProfileEditor } from "./ProfileMenu";

const ROLE_LABEL: Record<UserProfile["role"], string> = {
  super_admin: "Super administrador",
  admin: "Administrador",
  prueba: "Prueba · solo ver y probar",
};

/** Mi perfil como dashboard: foto, datos del usuario y edición. Los
 * campos vacíos se muestran como "Sin registrar" — aquí nada se
 * inventa. La edición reutiliza el mismo editor del menú de perfil. */
export function PerfilPanel() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api.getMyProfile().then(setProfile).catch(() => setFailed(true));
  }, [editing]);

  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })
      : "Sin registrar";

  return (
    <Panel title="Mi perfil">
      {failed ? (
        <p className="py-2 text-sm text-zinc-500">
          No se pudo cargar el perfil. Recarga la página e inténtalo de nuevo.
        </p>
      ) : profile === null ? (
        <p className="py-2 text-sm text-zinc-500">Cargando perfil…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-4">
            {profile.avatar_data_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_data_url} alt="Foto de perfil" className="h-24 w-24 rounded-full object-cover" />
            ) : (
              <span className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-600 text-3xl font-bold text-white">
                {(profile.display_name || profile.username).slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-xl font-bold text-zinc-100">
                {profile.display_name?.trim() || profile.username}
              </p>
              <p className="truncate text-sm text-zinc-500">@{profile.username}</p>
              <p className="mt-1 text-xs font-semibold text-emerald-400">{ROLE_LABEL[profile.role]}</p>
            </div>
            <button
              onClick={() => setEditing(true)}
              className="ml-auto rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Editar perfil
            </button>
          </div>

          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
              <dt className="text-xs font-medium text-zinc-500">Nombre</dt>
              <dd className="mt-1 break-words text-sm text-zinc-100">
                {profile.display_name?.trim() || "Sin registrar"}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
              <dt className="text-xs font-medium text-zinc-500">Correo</dt>
              <dd className="mt-1 break-words text-sm text-zinc-100">
                {profile.email?.trim() || "Sin registrar"}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5 sm:col-span-2">
              <dt className="text-xs font-medium text-zinc-500">Dirección</dt>
              <dd className="mt-1 break-words text-sm text-zinc-100">
                {profile.address?.trim() || "Sin registrar"}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
              <dt className="text-xs font-medium text-zinc-500">Miembro desde</dt>
              <dd className="mt-1 text-sm text-zinc-100">{fmtDate(profile.created_at)}</dd>
            </div>
          </dl>

          <p className="text-xs leading-relaxed text-zinc-500">
            Tu foto y tus datos solo se usan en tu perfil. La foto debe ser
            PNG, JPEG, GIF o WebP y pesar como máximo 500 KB.
          </p>
        </div>
      )}

      {editing && profile && (
        <ProfileEditor
          initial={profile}
          onClose={() => setEditing(false)}
          onSaved={(p) => {
            setProfile(p);
            setEditing(false);
          }}
        />
      )}
    </Panel>
  );
}
