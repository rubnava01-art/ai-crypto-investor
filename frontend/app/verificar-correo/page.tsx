"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "../../lib/api";
import { useLanguage } from "../../lib/i18n";
import { PublicNav } from "../../components/PublicNav";
import { Footer } from "../../components/Footer";

/** Página pública /verificar-correo (Fase 1 mejoras-v1, corrección F1).
 * Antes no existía: el enlace del correo de verificación apuntaba aquí
 * y caía en 404. Lee el token de la URL (?token=…), llama a POST
 * /api/auth/verify-email y muestra el resultado en español:
 * éxito / enlace no válido / enlace vencido / falta el enlace.
 * El backend no distingue un token ya usado de uno inventado (un solo
 * uso, solo se guarda su hash): el caso "ya verificado" se cubre en el
 * texto del estado no válido, con enlace directo a /login.
 * Debajo, formulario de reenvío (usuario → enlace nuevo) y enlace a
 * /login. Página pública: no dispara llamadas autenticadas. */
type Status = "loading" | "success" | "invalid" | "expired" | "missing" | "error";

function VerificarCorreoInner() {
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const v = t.verifyEmail;
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("loading");
  const [resendUser, setResendUser] = useState("");
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  // El efecto verifica una sola vez por token: en dev con StrictMode
  // el montaje doble no debe consumir el token dos veces (el segundo
  // intento vería el token ya usado y mostraría "no válido").
  const verifiedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("missing");
      return;
    }
    if (verifiedTokenRef.current === token) return;
    verifiedTokenRef.current = token;
    let cancelled = false;
    api
      .verifyEmail(token)
      .then(() => {
        if (!cancelled) setStatus("success");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 400) {
          // El backend distingue vencido ("ya venció") de no válido.
          setStatus(
            (err.detail ?? "").includes("venció") ? "expired" : "invalid",
          );
        } else {
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setResendMsg(null);
    setResendError(null);
    if (!resendUser.trim()) return;
    setResendBusy(true);
    try {
      await api.resendVerification(resendUser.trim());
      // Respuesta siempre genérica (no filtra si la cuenta existe).
      setResendMsg(v.resendSent);
    } catch {
      setResendError(v.resendFailed);
    } finally {
      setResendBusy(false);
    }
  };

  const state =
    status === "success"
      ? { title: v.successTitle, body: v.successBody, tone: "ok" as const }
      : status === "invalid"
        ? { title: v.invalidTitle, body: v.invalidBody, tone: "error" as const }
        : status === "expired"
          ? { title: v.expiredTitle, body: v.expiredBody, tone: "error" as const }
          : status === "missing"
            ? { title: v.missingTitle, body: v.missingBody, tone: "error" as const }
            : status === "error"
              ? { title: v.invalidTitle, body: v.error, tone: "error" as const }
              : null;

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <PublicNav />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{v.title}</h1>
        <p className="mt-3 text-base leading-relaxed text-zinc-400">{v.subtitle}</p>

        {status === "loading" ? (
          <p role="status" className="mt-8 flex items-center gap-2 text-sm text-zinc-400">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4 animate-spin">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
            </svg>
            {v.verifying}
          </p>
        ) : (
          state && (
            <section
              aria-label={state.title}
              className={`mt-8 rounded-xl border p-5 sm:p-6 ${
                state.tone === "ok"
                  ? "border-emerald-800 bg-emerald-500/10"
                  : "border-red-800 bg-red-500/10"
              }`}
            >
              <h2 className={`text-lg font-bold ${state.tone === "ok" ? "text-emerald-300" : "text-red-300"}`}>
                {state.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-300">{state.body}</p>
              <div className="mt-5">
                <Link
                  href="/login"
                  className="inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                >
                  {v.loginLink}
                </Link>
              </div>
            </section>
          )
        )}

        {status !== "loading" && status !== "success" && (
          <section aria-label={v.resendTitle} className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
            <h2 className="text-lg font-bold text-zinc-50">{v.resendTitle}</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{v.resendHint}</p>
            <form onSubmit={onResend} className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-400">{v.resendUserLabel}</span>
                <input
                  className="w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                  value={resendUser}
                  onChange={(e) => setResendUser(e.target.value)}
                  placeholder={v.resendUserPlaceholder}
                  maxLength={64}
                  required
                  autoComplete="username"
                />
              </label>
              <button
                type="submit"
                disabled={resendBusy || !resendUser.trim()}
                className="inline-flex min-h-[44px] items-center rounded-lg border border-zinc-600 px-5 py-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                {resendBusy ? v.resendSending : v.resendSubmit}
              </button>
              {resendMsg && (
                <p role="status" className="text-sm text-emerald-400">{resendMsg}</p>
              )}
              {resendError && (
                <p role="alert" className="text-sm text-red-400">{resendError}</p>
              )}
            </form>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}

// useSearchParams exige un límite Suspense en el prerender estático.
export default function VerificarCorreoPage() {
  return (
    <Suspense>
      <VerificarCorreoInner />
    </Suspense>
  );
}
