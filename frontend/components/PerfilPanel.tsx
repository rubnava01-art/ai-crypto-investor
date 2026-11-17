"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api, ApiError, type ReferralCampaign, type UserProfile } from "../lib/api";
import { Panel } from "./Panel";
import { ProfileEditor } from "./ProfileMenu";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { encodeQr, type QrCode } from "../lib/qr";
import { MODULES } from "./ModuleNav";
import { copyTextWithFallback } from "./ui";

const MAX_AVATAR_BYTES = 500 * 1024;

/** Iconos de trazo (currentColor) — mismo patrón que ModuleNav. */
function Icon({ d, size = 20, children }: { d?: string; size?: number; children?: React.ReactNode }) {
  return (
    <svg
      className="shrink-0"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}

const ICONS = {
  crown: <path d="M3 8l4 4 5-6 5 6 4-4-1.5 9h-15L3 8z" />,
  pencil: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />,
  camera: (
    <>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2v11z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  pin: (
    <>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM21 14v.01M14 21v.01M18 18h3v3h-2" />
    </>
  ),
  invite: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </>
  ),
  sparkle: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />,
  check: <path d="M20 6L9 17l-5-5" />,
  home: <path d="M3 12l9-9 9 9M5 10v10h14V10M9 20v-6h6v6" />,
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  briefcase: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </>
  ),
};

function QrSvg({ qr }: { qr: QrCode }) {
  const size = qr.size;
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (qr.modules[y][x]) {
        cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#030712" />);
      }
    }
  }
  return (
    <svg
      viewBox={`-4 -4 ${size + 8} ${size + 8}`}
      className="h-56 w-56"
      role="img"
      aria-label="QR"
      shapeRendering="crispEdges"
    >
      <rect x={-4} y={-4} width={size + 8} height={size + 8} fill="#ffffff" />
      {cells}
    </svg>
  );
}

/** Barra inferior flotante, solo en la vista de perfil (no hay patrón
 * de navegación móvil en la plataforma: se crea aquí, no en el layout). */
function ProfileBottomNav() {
  const { t } = useLanguage();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const itemCls = (active: boolean) =>
    `flex min-h-[48px] min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-[11px] font-semibold transition-colors ${
      active ? "text-emerald-400" : "text-zinc-400 hover:text-zinc-100"
    }`;

  return (
    <>
      <nav
        aria-label={t.perfil.moreTitle}
        className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-lg items-end justify-between rounded-full border border-zinc-700/80 bg-zinc-900/95 px-2 py-2 shadow-2xl backdrop-blur"
      >
        <Link href="/inicio" className={itemCls(pathname === "/inicio")}>
          <Icon size={22}>{ICONS.home}</Icon>
          {t.perfil.navHome}
        </Link>
        <Link href="/crm" className={itemCls(pathname === "/crm")}>
          <Icon size={22}>{ICONS.users}</Icon>
          {t.perfil.navNetwork}
        </Link>
        <Link
          href="/"
          aria-label={t.perfil.navAi}
          className="flex flex-col items-center gap-0.5"
        >
          <span className="-mt-8 flex h-14 w-14 items-center justify-center rounded-full bg-amber-400 text-zinc-950 shadow-lg ring-4 ring-zinc-900 transition-transform hover:scale-105">
            <Icon size={26}>{ICONS.sparkle}</Icon>
          </span>
          <span className="-mt-0.5 text-[11px] font-semibold text-amber-300">{t.perfil.navAi}</span>
        </Link>
        <Link href="/business" className={itemCls(pathname === "/business")}>
          <Icon size={22}>{ICONS.briefcase}</Icon>
          {t.perfil.navBusiness}
        </Link>
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          className={itemCls(false)}
        >
          <Icon size={22}>{ICONS.grid}</Icon>
          {t.perfil.navMore}
        </button>
      </nav>

      {moreOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t.perfil.moreTitle}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 pb-4"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="max-h-[75dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-zinc-100">{t.perfil.moreTitle}</h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label={t.perfil.closeAria}
                className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                ✕
              </button>
            </div>
            <ul className="divide-y divide-zinc-800">
              {MODULES.map((m) => (
                <li key={m.href}>
                  <Link
                    href={m.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-3 px-2 py-3 text-sm text-zinc-200 hover:text-white"
                  >
                    <span className="text-emerald-400">{m.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{m.label}</span>
                      <span className="block truncate text-xs text-zinc-400">{m.hint}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

/** Mi perfil como tarjeta de red: avatar con anillo, insignia de rol
 * real, bio, ubicación, estadísticas reales, compartir/QR/invitar y
 * tarjeta de negocio. Nada se inventa: lo vacío no se muestra y cada
 * estadística que no carga se omite. */
export function PerfilPanel() {
  const isCancelled = useCancelled();
  const { lang, t } = useLanguage();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [origin, setOrigin] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ contacts?: number; clients?: number; referrals?: number }>({});
  const [activeCampaign, setActiveCampaign] = useState<ReferralCampaign | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    api.getMyProfile().then((v) => { if (!isCancelled()) setProfile(v); }).catch(() => { if (!isCancelled()) setFailed(true); });
  }, [editing]);

  // Estadísticas reales, cada fuente por su lado: si una falla, esa
  // estadística se omite en vez de mostrar un número inventado.
  useEffect(() => {
    api.listContacts()
      .then((list) => {
        if (isCancelled()) return;
        setStats((s) => ({
          ...s,
          contacts: list.length,
          clients: list.filter((c) => c.status === "cliente").length,
        }));
      })
      .catch(() => undefined);
    api.listReferralCampaigns()
      .then((campaigns) => {
        if (isCancelled()) return;
        setStats((s) => ({
          ...s,
          referrals: campaigns.reduce((n, c) => n + (c.referrals_count ?? 0), 0),
        }));
        setActiveCampaign(campaigns.find((c) => c.status === "active") ?? null);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!qrOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQrOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qrOpen]);

  const profileUrl = origin ? `${origin}/perfil` : "";
  const displayName = profile?.display_name?.trim() || profile?.username || "";
  const hasBusiness =
    !!profile?.business_handle?.trim() ||
    !!profile?.business_description?.trim() ||
    (profile?.skills?.length ?? 0) > 0;

  const qr = useMemo(() => {
    if (!qrOpen || !profileUrl) return null;
    try {
      return encodeQr(profileUrl);
    } catch {
      return null;
    }
  }, [qrOpen, profileUrl]);

  const onPhoto = (file: File | undefined) => {
    setPhotoError(null);
    if (!file || !profile) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError(t.perfil.photoNotImage);
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setPhotoError(t.perfil.photoTooLarge);
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (!dataUrl) {
        setPhotoError(t.perfil.photoReadFailed);
        return;
      }
      setPhotoBusy(true);
      try {
        const saved = await api.updateMyProfile({ avatar_data_url: dataUrl });
        if (!isCancelled()) setProfile(saved);
      } catch (err) {
        if (!isCancelled()) {
          setPhotoError(err instanceof ApiError ? err.message : t.perfil.saveFailed);
        }
      } finally {
        if (!isCancelled()) setPhotoBusy(false);
      }
    };
    reader.onerror = () => setPhotoError(t.perfil.photoReadFailed);
    reader.readAsDataURL(file);
  };

  const shareCard = async () => {
    if (!profileUrl) return;
    const text = `${displayName} (@${profile?.username}) · Grow Business Platform`;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: t.perfil.title, text, url: profileUrl });
        return;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      }
    }
    const ok = await copyTextWithFallback(profileUrl);
    setToast(ok ? t.perfil.shareCardCopied : t.perfil.shareCardFailed);
  };

  const invite = async () => {
    if (!origin) return;
    const registerUrl = `${origin}/login?mode=register`;
    const code = activeCampaign?.share_code;
    const text = code
      ? t.perfil.inviteTextCode.replace("{url}", registerUrl).replace("{codigo}", code)
      : t.perfil.inviteText.replace("{url}", registerUrl);
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: t.perfil.invite, text, url: registerUrl });
        return;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      }
    }
    const ok = await copyTextWithFallback(text);
    setToast(ok ? (code ? t.perfil.inviteCopied : t.perfil.inviteNoCampaign) : t.perfil.shareCardFailed);
  };

  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(lang === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long", year: "numeric" })
      : t.perfil.notRegistered;

  const badge =
    profile?.role === "super_admin" ? (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-400/15 px-3 py-1 text-xs font-bold tracking-widest text-amber-300">
        <Icon size={14}>{ICONS.crown}</Icon>
        {t.perfil.badgeSuper}
      </span>
    ) : profile?.role === "admin" ? (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/50 bg-emerald-400/10 px-3 py-1 text-xs font-bold tracking-widest text-emerald-300">
        {t.perfil.badgeAdmin}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-600 bg-zinc-800 px-3 py-1 text-xs font-bold tracking-widest text-zinc-300">
        {t.perfil.badgeTrial}
      </span>
    );

  const ringCls =
    profile?.role === "super_admin"
      ? "ring-amber-400/70"
      : profile?.role === "admin"
        ? "ring-emerald-400/60"
        : "ring-zinc-600";

  const statItems: Array<{ value: number; label: string }> = [];
  if (stats.contacts !== undefined) statItems.push({ value: stats.contacts, label: t.perfil.statsContacts });
  if (stats.clients !== undefined) statItems.push({ value: stats.clients, label: t.perfil.statsClients });
  if (stats.referrals !== undefined) statItems.push({ value: stats.referrals, label: t.perfil.statsReferrals });

  return (
    <Panel title={t.perfil.title}>
      {failed ? (
        <p className="py-2 text-sm text-zinc-400">{t.perfil.loadFailed}</p>
      ) : profile === null ? (
        <p className="py-2 text-sm text-zinc-400">{t.perfil.loadingProfile}</p>
      ) : (
        <div className="space-y-5">
          <div className="flex justify-center">{badge}</div>

          <div className="flex flex-wrap items-start gap-4 sm:gap-5">
            <div className="relative shrink-0">
              {profile.avatar_data_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar_data_url} alt={t.perfil.photoAlt} className={`h-28 w-28 rounded-full object-cover ring-2 ${ringCls}`} />
              ) : (
                <span className={`flex h-28 w-28 items-center justify-center rounded-full bg-emerald-700 text-4xl font-bold text-white ring-2 ${ringCls}`}>
                  {(displayName || profile.username).slice(0, 1).toUpperCase()}
                </span>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={photoBusy}
                aria-label={t.perfil.editPhotoAria}
                className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 shadow-md ring-2 ring-zinc-900 transition-transform hover:scale-105 disabled:opacity-60"
              >
                <Icon size={16}>{ICONS.camera}</Icon>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  onPhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="break-words text-2xl font-bold leading-tight text-zinc-100">
                {displayName}
              </p>
              <p className="truncate text-sm text-zinc-400">@{profile.username}</p>
              {profile.bio?.trim() && (
                <p className="mt-2 text-sm leading-relaxed text-zinc-300">{profile.bio.trim()}</p>
              )}
              {profile.location?.trim() && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-zinc-400">
                  <Icon size={16}>{ICONS.pin}</Icon>
                  {profile.location.trim()}
                </p>
              )}
              {photoBusy && <p className="mt-2 text-xs text-zinc-400">{t.perfil.photoSaving}</p>}
              {photoError && (
                <p role="alert" className="mt-2 text-xs text-red-400">{photoError}</p>
              )}
            </div>
          </div>

          {statItems.length > 0 && (
            <div className="flex items-center justify-around gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 px-2 py-3 text-center">
              {statItems.map((s) => (
                <div key={s.label} className="min-w-0">
                  <p className="text-xl font-bold leading-none text-zinc-100">{s.value}</p>
                  <p className="mt-1 truncate text-xs text-zinc-400">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-base font-bold text-white shadow-sm transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <Icon size={20}>{ICONS.pencil}</Icon>
              {t.perfil.editProfile}
            </button>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={shareCard}
                className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-emerald-500/60 px-3 py-2.5 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/10"
              >
                <Icon size={18}>{ICONS.share}</Icon>
                {t.perfil.shareCard}
              </button>
              <button
                type="button"
                onClick={() => setQrOpen(true)}
                className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-zinc-600 px-3 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
              >
                <Icon size={18}>{ICONS.qr}</Icon>
                {t.perfil.viewQr}
              </button>
            </div>
            <button
              type="button"
              onClick={invite}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-zinc-600 px-3 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              <Icon size={18}>{ICONS.invite}</Icon>
              {t.perfil.invite}
              {activeCampaign && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-xs font-bold text-emerald-300">
                  {activeCampaign.share_code}
                </span>
              )}
            </button>
            {toast && (
              <p role="status" className="rounded-lg bg-emerald-500/10 px-3 py-2 text-center text-sm text-emerald-300">
                {toast}
              </p>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-base font-bold text-zinc-100">{t.perfil.businessTitle}</h3>
            {hasBusiness ? (
              <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 shadow-sm">
                {profile.business_handle?.trim() && (
                  <p className="break-words text-lg font-bold text-zinc-100">
                    @{profile.business_handle.trim()}
                  </p>
                )}
                {profile.business_description?.trim() && (
                  <p className="text-sm leading-relaxed text-zinc-300">
                    {profile.business_description.trim()}
                  </p>
                )}
                {(profile.skills?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {profile.skills!.map((skill) => (
                      <span
                        key={skill}
                        className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-200"
                      >
                        <span className="text-sky-400">
                          <Icon size={13}>{ICONS.check}</Icon>
                        </span>
                        {skill}
                      </span>
                    ))}
                  </div>
                )}
                <Link
                  href="/crear"
                  className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-violet-500"
                >
                  <Icon size={18}>{ICONS.sparkle}</Icon>
                  {t.perfil.createCta}
                  <span className="font-normal text-violet-200">{t.perfil.createHint}</span>
                </Link>
              </div>
            ) : (
              <div className="space-y-3 rounded-2xl border border-dashed border-zinc-700 bg-zinc-950 p-4 text-center">
                <p className="text-sm leading-relaxed text-zinc-400">{t.perfil.businessEmpty}</p>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="min-h-[44px] rounded-lg border border-emerald-500/60 px-4 py-2 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/10"
                >
                  {t.perfil.addBusiness}
                </button>
              </div>
            )}
          </div>

          <dl className="grid gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 shadow-sm">
              <dt className="text-xs font-medium text-zinc-400">{t.perfil.email}</dt>
              <dd className="mt-1 break-words text-sm text-zinc-100">
                {profile.email?.trim() || t.perfil.notRegistered}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 shadow-sm">
              <dt className="text-xs font-medium text-zinc-400">{t.perfil.memberSince}</dt>
              <dd className="mt-1 text-sm text-zinc-100">{fmtDate(profile.created_at)}</dd>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 shadow-sm sm:col-span-2">
              <dt className="text-xs font-medium text-zinc-400">{t.perfil.address}</dt>
              <dd className="mt-1 break-words text-sm text-zinc-100">
                {profile.address?.trim() || t.perfil.notRegistered}
              </dd>
            </div>
          </dl>

          <p className="text-sm leading-relaxed text-zinc-400">{t.perfil.note}</p>
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

      {qrOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t.perfil.qrTitle}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setQrOpen(false)}
        >
          <div
            className="w-full max-w-xs space-y-4 rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-zinc-100">{t.perfil.qrTitle}</h2>
            {qr ? (
              <div className="flex justify-center">
                <QrSvg qr={qr} />
              </div>
            ) : (
              <p className="text-sm text-zinc-400">{t.perfil.shareCardFailed}</p>
            )}
            <p className="text-sm leading-relaxed text-zinc-400">{t.perfil.qrHint}</p>
            <button
              type="button"
              onClick={() => setQrOpen(false)}
              className="min-h-[44px] w-full rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              {t.common.close}
            </button>
          </div>
        </div>
      )}

      <ProfileBottomNav />
    </Panel>
  );
}
