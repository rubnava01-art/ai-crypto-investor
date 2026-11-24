"use client";

// Prueba sin registro (Fase 1, 2026-11-23): CTA del hero "Probar sin
// registro" → reto matemático (mismo de /api/auth/register-challenge) →
// POST /api/auth/guest → sesión de invitado (15 min) → /inicio.
// Si el endpoint aún no existe (404/501), muestra el aviso de no
// disponible y NO inventa el comportamiento. Sin PII.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, guestApi } from "../lib/api";
import { useLanguage } from "../lib/i18n";

export function GuestTrialButton() {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [challenge, setChallenge] = useState<{ challenge_id: string; question: string } | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<"wrong" | "unavailable" | "load" | null>(null);

  const loadChallenge = async () => {
    setError(null);
    setAnswer("");
    try {
      setChallenge(await guestApi.challenge());
    } catch {
      setChallenge(null);
      setError("load");
    }
  };

  const openTrial = () => {
    setOpen(true);
    void loadChallenge();
  };

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge || loading) return;
    const n = Number(answer);
    if (!Number.isFinite(n)) {
      setError("wrong");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await guestApi.start(challenge.challenge_id, n);
      router.push("/inicio");
    } catch (err) {
      // 404/501: el endpoint aún no existe (backend en paralelo) — aviso
      // honesto, sin inventar la sesión. 400/422: respuesta incorrecta
      // (el reto es de un solo uso: se pide uno nuevo).
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        setError("unavailable");
      } else if (err instanceof ApiError && (err.status === 400 || err.status === 422)) {
        setError("wrong");
        void loadChallenge();
      } else {
        setError("unavailable");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openTrial}
        className="fintech-btn fintech-btn-secondary"
      >
        {t.landing.guestCta}
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t.guest.challengeTitle}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setOpen(false)}
        >
          <form
            onSubmit={start}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-slate-700 bg-[#0B0F19] p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-50">{t.guest.challengeTitle}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.common.close}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                ✕
              </button>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{t.guest.challengeHint}</p>
            {challenge ? (
              <p className="mt-4 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2.5 text-base font-semibold text-slate-100">
                {challenge.question}
              </p>
            ) : (
              <p role="status" className="mt-4 text-sm text-slate-400">{t.common.loading}</p>
            )}
            <label className="mt-4 block text-xs text-slate-400">
              {t.guest.challengeAnswer}
              <input
                data-no-swipe
                className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#0B0F19] px-3.5 py-2.5 text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                type="number"
                inputMode="numeric"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                disabled={!challenge || loading}
                autoFocus
              />
            </label>
            {error === "wrong" && (
              <p role="alert" className="mt-2 text-sm text-amber-400">{t.guest.challengeError}</p>
            )}
            {error === "load" && (
              <p role="alert" className="mt-2 text-sm text-amber-400">{t.guest.challengeLoadError}</p>
            )}
            {error === "unavailable" && (
              <p role="alert" className="mt-2 text-sm leading-relaxed text-amber-400">{t.landing.guestUnavailable}</p>
            )}
            <button
              type="submit"
              disabled={!challenge || loading}
              className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {loading ? t.landing.guestCtaLoading : t.guest.challengeStart}
            </button>
            <p className="mt-3 text-center text-sm">
              <Link
                href="/login?mode=register"
                className="font-semibold text-blue-300 hover:text-blue-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
              >
                {t.guest.bannerCta}
              </Link>
            </p>
          </form>
        </div>
      )}
    </>
  );
}
