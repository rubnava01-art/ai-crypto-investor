// Utilidades compartidas de Crear (extraídas de CrearPanel.tsx, 2026-11-17).
import type { CopyPlatform } from "../../lib/api";

export const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40";

export const PLATFORMS: { value: CopyPlatform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "threads", label: "Threads" },
  { value: "facebook", label: "Facebook" },
];

export const platformLabel = (p: string) => PLATFORMS.find((x) => x.value === p)?.label ?? p;

export const fmtDate = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : null;
