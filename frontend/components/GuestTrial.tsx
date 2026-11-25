"use client";

// Prueba sin registro (Fase 1, 2026-11-23): CTA del hero "Probar sin
// registro" → reto matemático (mismo de /api/auth/register-challenge) →
// POST /api/auth/guest → sesión de invitado (15 min) → destino ?next=
// validado (H-01, QA TBT-Herramientas 2026-11-24) o /inicio.
// Si el endpoint aún no existe (404/501), muestra el aviso de no
// disponible y NO inventa el comportamiento. Sin PII.
// Entrada rápida (2026-11-24): el reto sigue siendo obligatorio y la
// sesión sigue siendo JWT 15 min solo lectura — lo que cambia es la
// fricción: al pasar el cursor (o el foco) por el botón ya se prefetch
// la ruta /inicio y se calienta el backend; al abrir, el reto se pide
// a la vez que el warmup; la respuesta solo acepta dígitos (máx. 3,
// teclado numérico), el error se borra al teclear de nuevo, una
// respuesta de 3 cifras se envía sola a los 600 ms (borrar un dígito
// lo cancela), el reintento tras fallar no recarga nada y vuelve a
// enfocar el campo, y si el reto tarda más de ~5 s aparece el aviso
// de cold start con reintento. Ningún paso nuevo.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, guestApi } from "../lib/api";
import { guestNextFromSearch } from "../lib/session";
import { useLanguage } from "../lib/i18n";
import { ColdStartNotice } from "./ColdStartNotice";

/** Respuesta de 3 cifras: se envía sola pasado este margen, para que
 * un dedo torpe pueda borrar y corregir antes del envío. */
const AUTO_SUBMIT_DELAY_MS = 600;

export function GuestTrialButton() {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [challenge, setChallenge] = useState<{ challenge_id: string; question: string } | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<"wrong" | "unavailable" | "load" | null>(null);
  // Una respuesta de 3 cifras está a punto de enviarse sola.
  const [autoSubmitting, setAutoSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Prefetch por intención (hover/foco): una sola vez por montaje del
  // botón — el reto tiene límite por IP y no se quema en cada hover.
  const intentPrefetched = useRef(false);

  const clearAutoSubmit = () => {
    if (autoSubmitTimer.current) {
      clearTimeout(autoSubmitTimer.current);
      autoSubmitTimer.current = null;
    }
    setAutoSubmitting(false);
  };

  useEffect(() => () => clearAutoSubmit(), []);

  const loadChallenge = async () => {
    setError(null);
    setAnswer("");
    clearAutoSubmit();
    try {
      setChallenge(await guestApi.challenge());
    } catch {
      setChallenge(null);
      setError("load");
    }
  };

  // Intención de probar (hover o foco, antes del clic): prefetch de la
  // ruta lite + warmup del backend, para que al abrir el modal el
  // reto y la navegación ya lleguen calientes.
  const prefetchIntent = () => {
    if (intentPrefetched.current) return;
    intentPrefetched.current = true;
    router.prefetch("/inicio");
    void guestApi.warmup();
  };

  const closeTrial = () => {
    clearAutoSubmit();
    setOpen(false);
  };

  const openTrial = () => {
    prefetchIntent();
    setOpen(true);
    void loadChallenge();
  };

  const submitWith = async (value: string) => {
    if (!challenge || loading) return;
    const n = Number(value);
    if (!Number.isFinite(n) || value.length === 0) {
      setError("wrong");
      return;
    }
    clearAutoSubmit();
    setLoading(true);
    setError(null);
    try {
      await guestApi.start(challenge.challenge_id, n);
      // H-01 (QA TBT-Herramientas): enhebrar el destino — el invitado
      // vuelve a ?next= cuando es una ruta interna válida (p. ej.
      // /estudiar#herramienta-calculadora desde «Pruébala sin cuenta»,
      // o /estudiar#herramienta-bitcoin); sin destino válido, /inicio.
      // Se lee window.location.search (patrón Landing: sin
      // useSearchParams, sin Suspense) porque este botón vive también
      // en el héroe de la landing, fuera de todo límite Suspense.
      router.push(guestNextFromSearch(window.location.search));
    } catch (err) {
      // 404/501: el endpoint aún no existe (backend en paralelo) — aviso
      // honesto, sin inventar la sesión. 400/422: respuesta incorrecta
      // (el reto es de un solo uso: se pide uno nuevo, sin recargar, y
      // el campo recupera el foco para reintentar al momento).
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

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    void submitWith(answer);
  };

  // Validación inmediata: solo dígitos (máx. 3, la suma mayor es 198),
  // el error viejo se borra al teclear de nuevo, y con 3 cifras el
  // envío se programa solo — borrar un dígito lo cancela.
  const onAnswerChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 3);
    clearAutoSubmit();
    setAnswer(digits);
    if (error === "wrong") setError(null);
    if (digits.length === 3 && challenge && !loading) {
      setAutoSubmitting(true);
      autoSubmitTimer.current = setTimeout(() => {
        void submitWith(digits);
      }, AUTO_SUBMIT_DELAY_MS);
    }
  };

  // Tras un reto nuevo (también tras fallar), el foco vuelve al campo:
  // el reintento es teclear y listo, sin tocar nada más.
  useEffect(() => {
    if (open && challenge) inputRef.current?.focus();
  }, [open, challenge]);

  return (
    <>
      <button
        type="button"
        onClick={openTrial}
        onMouseEnter={prefetchIntent}
        onFocus={prefetchIntent}
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
          onClick={closeTrial}
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
                onClick={closeTrial}
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
            {/* Cold start: si el reto tarda más de ~5 s, el aviso honesto
                con el tiempo real y reintento — nunca tapa el modal ni
                deja un "Cargando…" sin explicar nada. */}
            <ColdStartNotice loading={!challenge && !error} onRetry={() => void loadChallenge()} />
            <label className="mt-4 block text-xs text-slate-400">
              {t.guest.challengeAnswer}
              <input
                ref={inputRef}
                data-no-swipe
                className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#0B0F19] px-3.5 py-2.5 text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                maxLength={3}
                value={answer}
                onChange={(e) => onAnswerChange(e.target.value)}
                disabled={!challenge || loading}
                autoFocus
              />
            </label>
            {autoSubmitting && (
              <p role="status" className="mt-2 text-sm text-emerald-300">{t.guest.challengeAutoSubmit}</p>
            )}
            {error === "wrong" && (
              <p role="alert" className="mt-2 text-sm text-amber-400">{t.guest.challengeError}</p>
            )}
            {error === "load" && (
              <>
                <p role="alert" className="mt-2 text-sm text-amber-400">{t.guest.challengeLoadError}</p>
                <button
                  type="button"
                  onClick={() => void loadChallenge()}
                  className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-amber-500/60 px-4 py-2.5 text-sm font-semibold text-amber-200 hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
                >
                  {t.guest.challengeRetry}
                </button>
              </>
            )}
            {error === "unavailable" && (
              <p role="alert" className="mt-2 text-sm leading-relaxed text-amber-400">{t.landing.guestUnavailable}</p>
            )}
            <button
              type="submit"
              disabled={!challenge || loading || answer.length === 0}
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
