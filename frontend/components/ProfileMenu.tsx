"use client";

import { useEffect, useRef, useState } from "react";
import { api, type MeResponse } from "../lib/api";

export function ProfileMenu({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const initial = (me?.username ?? "A").slice(0, 1).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú de perfil"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-500"
      >
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl">
          <div className="border-b border-zinc-800 px-4 py-3">
            <p className="truncate text-sm font-semibold text-zinc-100">{me?.username ?? "…"}</p>
            <p className="text-xs text-zinc-500">{me?.is_admin ? "Administrador · control total" : "Prueba · solo ver y probar"} · modo demo</p>
          </div>
          <button
            role="menuitem"
            onClick={() => { setOpen(false); onLogout(); }}
            className="block w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
