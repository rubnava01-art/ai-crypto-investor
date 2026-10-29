"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, type MeResponse, type UserProfile } from "../lib/api";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const MAX_AVATAR_BYTES = 500 * 1024;

/** Profile editor: nombre, correo, dirección y foto. All fields optional
 * and empty at first — nothing is ever invented for the user. */
export function ProfileEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: UserProfile;
  onClose: () => void;
  onSaved: (p: UserProfile) => void;
}) {
  const [displayName, setDisplayName] = useState(initial.display_name ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [avatar, setAvatar] = useState<string | null>(initial.avatar_data_url ?? null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPhoto = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("La foto debe ser una imagen (PNG, JPEG, GIF o WebP).");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError("La foto supera los 500 KB permitidos.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAvatar(typeof reader.result === "string" ? reader.result : null);
      setAvatarRemoved(false);
    };
    reader.onerror = () => setError("No se pudo leer la foto.");
    reader.readAsDataURL(file);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const saved = await api.updateMyProfile({
        display_name: displayName,
        email,
        address,
        avatar_data_url: avatarRemoved ? "" : avatar ?? "",
      });
      setMsg("Perfil guardado.");
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el perfil.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Editar perfil"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <form
        onSubmit={save}
        className="w-full max-w-md space-y-3 rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-zinc-100">Mi perfil</h2>
            <p className="text-xs text-zinc-500">
              Nombre, correo, dirección y foto. Todo opcional: lo que dejes
              vacío queda vacío.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-3">
          {avatar && !avatarRemoved ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="Foto de perfil" className="h-14 w-14 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-white">
              {(displayName || initial.username).slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">Foto (máx. 500 KB)</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={(e) => onPhoto(e.target.files?.[0])}
                className="w-full text-xs text-zinc-400"
              />
            </label>
            {(avatar || avatarRemoved) && (
              <button
                type="button"
                onClick={() => { setAvatar(null); setAvatarRemoved(true); }}
                className="mt-1 text-xs font-semibold text-red-400 hover:underline"
              >
                Quitar foto
              </button>
            )}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Nombre</span>
          <input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} placeholder="Tu nombre para mostrar" autoComplete="name" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Correo</span>
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} placeholder="correo@ejemplo.com" autoComplete="email" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Dirección</span>
          <textarea className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} rows={2} placeholder="Dirección" autoComplete="street-address" />
        </label>

        {msg && <p className="text-sm text-emerald-400">{msg}</p>}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Guardar perfil"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Cerrar
          </button>
        </div>
      </form>
    </div>
  );
}

export function ProfileMenu({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
    api.getMyProfile().then(setProfile).catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const displayName = profile?.display_name?.trim() || me?.username || "…";
  const initial = displayName.slice(0, 1).toUpperCase();
  // Demo-word cleanup (2026-10-28): the generic "modo demo" suffix is
  // removed from the role line. Trading simulation labels (DemoBadge,
  // system mode, footer) and AI stub labels stay untouched — those
  // features genuinely run simulated/stub.
  const roleText = me?.is_admin ? "Administrador · control total" : "Prueba · solo ver y probar";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú de perfil"
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-500"
      >
        {profile?.avatar_data_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatar_data_url} alt="" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl">
          <div className="border-b border-zinc-800 px-4 py-3">
            <p className="truncate text-sm font-semibold text-zinc-100">{displayName}</p>
            <p className="truncate text-xs text-zinc-500">{me?.username}</p>
            <p className="text-xs text-zinc-500">{roleText}</p>
          </div>
          <button
            role="menuitem"
            onClick={() => { setOpen(false); setEditing(true); }}
            className="block w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Mi perfil
          </button>
          <button
            role="menuitem"
            onClick={() => { setOpen(false); onLogout(); }}
            className="block w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Cerrar sesión
          </button>
        </div>
      )}
      {editing && profile && (
        <ProfileEditor
          initial={profile}
          onClose={() => setEditing(false)}
          onSaved={(p) => setProfile(p)}
        />
      )}
      {editing && !profile && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setEditing(false)}
        >
          <p className="rounded-2xl border border-zinc-700 bg-zinc-900 px-6 py-4 text-sm text-zinc-300">
            No se pudo cargar el perfil. Cierra esto e inténtalo de nuevo.
          </p>
        </div>
      )}
    </div>
  );
}
