"use client";

import { useEffect, useState } from "react";
import { api, type UserProfile } from "../lib/api";
import { Panel } from "./Panel";
import { ProfileEditor } from "./ProfileMenu";
import { useLanguage } from "../lib/i18n";

/** Mi perfil como dashboard: foto, datos del usuario y edición. Los
 * campos vacíos se muestran como "Sin registrar" — aquí nada se
 * inventa. La edición reutiliza el mismo editor del menú de perfil. */
export function PerfilPanel() {
  const { lang, t } = useLanguage();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);

  const ROLE_LABEL: Record<UserProfile["role"], string> = {
    super_admin: t.perfil.roleSuperAdmin,
    admin: t.perfil.roleAdmin,
    prueba: t.perfil.rolePrueba,
  };

  useEffect(() => {
    api.getMyProfile().then(setProfile).catch(() => setFailed(true));
  }, [editing]);

  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(lang === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long", year: "numeric" })
      : t.perfil.notRegistered;

  return (
    <Panel title={t.perfil.title}>
      {failed ? (
        <p className="py-2 text-sm text-zinc-500">
          {t.perfil.loadFailed}
        </p>
      ) : profile === null ? (
        <p className="py-2 text-sm text-zinc-500">{t.perfil.loadingProfile}</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-4 sm:gap-5">
            {profile.avatar_data_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_data_url} alt={t.perfil.photoAlt} className="h-24 w-24 shrink-0 rounded-full object-cover ring-2 ring-zinc-700" />
            ) : (
              <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-3xl font-bold text-white ring-2 ring-zinc-700">
                {(profile.display_name || profile.username).slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-2xl font-bold leading-tight text-zinc-100">
                {profile.display_name?.trim() || profile.username}
              </p>
              <p className="truncate text-sm text-zinc-400">@{profile.username}</p>
              <p className="mt-1 text-xs font-semibold text-emerald-400">{ROLE_LABEL[profile.role]}</p>
            </div>
            <button
              onClick={() => setEditing(true)}
              className="ml-auto min-h-[44px] rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              {t.perfil.editProfile}
            </button>
          </div>

          <dl className="grid gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 shadow-sm">
              <dt className="text-xs font-medium text-zinc-400">{t.perfil.name}</dt>
              <dd className="mt-1 break-words text-sm text-zinc-100">
                {profile.display_name?.trim() || t.perfil.notRegistered}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 shadow-sm">
              <dt className="text-xs font-medium text-zinc-400">{t.perfil.email}</dt>
              <dd className="mt-1 break-words text-sm text-zinc-100">
                {profile.email?.trim() || t.perfil.notRegistered}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 shadow-sm sm:col-span-2">
              <dt className="text-xs font-medium text-zinc-400">{t.perfil.address}</dt>
              <dd className="mt-1 break-words text-sm text-zinc-100">
                {profile.address?.trim() || t.perfil.notRegistered}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 shadow-sm">
              <dt className="text-xs font-medium text-zinc-400">{t.perfil.memberSince}</dt>
              <dd className="mt-1 text-sm text-zinc-100">{fmtDate(profile.created_at)}</dd>
            </div>
          </dl>

          <p className="text-sm leading-relaxed text-zinc-400">
            {t.perfil.note}
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
