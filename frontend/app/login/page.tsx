"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, setToken, ApiError } from "../../lib/api";
import { useLanguage } from "../../lib/i18n";
import { SkipLink } from "../../components/ui";

/** Login restyled (paquete 2026-10-28): clean and minimal, inspired by
 * claude.ai — one centered card, generous spacing, no clutter.
 * Cuentas por aprobar (2026-10-30): el registro ya NO inicia sesión
 * directo — la cuenta queda pendiente hasta que un administrador la
 * active desde el módulo Control de usuarios; el login de una cuenta
 * pendiente responde 403 con el aviso en español. */
function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Fase 4 (FE7): volver al destino preservado (?next=) tras el login y
  // avisar cuando la llegada es por sesión expirada (?expired=1). Solo se
  // aceptan destinos internos ("/..." sin "//") para no abrir redirects.
  const nextParam = searchParams.get("next");
  const nextDest =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const sessionExpired = searchParams.get("expired") === "1";
  const { t } = useLanguage();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [challenge, setChallenge] = useState<{ challenge_id: string; question: string } | null>(null);
  const [answer, setAnswer] = useState("");

  const loadChallenge = useCallback(async () => {
    try {
      setChallenge(await api.registerChallenge());
    } catch {
      setChallenge(null);
    }
  }, []);

  function switchMode(m: "login" | "register") {
    setMode(m);
    setError(null);
    setNotice(null);
    setUsername("");
    setPassword("");
    setAnswer("");
    if (m === "register") loadChallenge();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await api.login(username, password);
      setToken(res.access_token);
      router.replace(nextDest);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.login.errorLogin);
    } finally {
      setLoading(false);
    }
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (!challenge) throw new Error(t.login.errorChallenge);
      await api.register({
        username: username.trim(),
        password,
        challenge_id: challenge.challenge_id,
        answer: Number(answer),
      });
      // Cuenta pendiente: NO inicia sesión directa; un administrador la
      // activa desde Control de usuarios y entonces podrá entrar.
      setNotice(t.login.noticePending);
      setMode("login");
      setUsername("");
      setPassword("");
      setAnswer("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.login.errorCreate);
      loadChallenge();
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-3 text-[15px] text-zinc-100 placeholder-zinc-500 outline-none transition-colors hover:border-zinc-600 focus:border-emerald-500";

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <SkipLink label={t.shell.skipLink} />
      <div className="mb-8 flex flex-col items-center text-center">
        <span aria-hidden="true" className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white shadow-lg shadow-emerald-950/50">
          P
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-emerald-400">
          {t.header.brand}
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
          {mode === "login" ? t.login.welcome : t.login.createAccount}
        </h1>
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-zinc-400">
          {mode === "login" ? t.login.subtitleLogin : t.login.subtitleRegister}
        </p>
      </div>

      <form
        id="contenido"
        onSubmit={mode === "login" ? onSubmit : onRegister}
        className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl sm:p-8"
      >
        <label className="mb-4 block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-300">{t.login.userLabel}</span>
          <input
            className={inputCls}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder={t.login.userPlaceholder}
            required
          />
        </label>
        <label className="mb-5 block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-300">{t.login.passwordLabel}</span>
          <input
            type="password"
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder={t.login.passwordPlaceholder}
            minLength={mode === "register" ? 12 : 1}
            required
          />
          {mode === "register" && (
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{t.login.passwordMinHint}</p>
          )}
        </label>

        {mode === "register" && (
          <div className="mb-5">
            <span className="mb-1.5 block text-sm font-medium text-zinc-300">
              {t.login.verificationLabel}
            </span>
            <p className="mb-2 text-sm text-zinc-200">
              {challenge ? challenge.question : t.login.verificationLoading}
            </p>
            <div className="flex gap-2">
              <input aria-label={t.login.answerPlaceholder}
                className={inputCls}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                inputMode="numeric"
                required
                autoComplete="off"
                placeholder={t.login.answerPlaceholder}
              />
              <button
                type="button"
                onClick={loadChallenge}
                className="min-h-[44px] shrink-0 rounded-xl border border-zinc-700 px-3 py-2.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              >
                {t.login.anotherQuestion}
              </button>
            </div>
          </div>
        )}

        {sessionExpired && mode === "login" && (
          <p role="status" className="mb-5 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-sm leading-relaxed text-amber-300">
            {t.reliability.sessionExpired}
          </p>
        )}

        {notice && (
          <p role="status" className="mb-5 rounded-xl bg-emerald-500/10 px-3.5 py-2.5 text-sm leading-relaxed text-emerald-300">
            {notice}
          </p>
        )}

        {error && (
          <p role="alert" className="mb-5 rounded-xl bg-red-500/10 px-3.5 py-2.5 text-sm leading-relaxed text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-emerald-600 px-3 py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {loading ? t.login.processing : mode === "login" ? t.login.loginSubmit : t.login.createSubmit}
        </button>

        <p className="mt-5 text-center text-sm text-zinc-500">
          {mode === "login" ? (
            <>
              {t.login.noAccount}{" "}
              <button type="button" onClick={() => switchMode("register")} className="inline-block min-h-[44px] px-2 py-2.5 font-semibold text-emerald-400 underline-offset-4 hover:underline">
                {t.login.registerLink}
              </button>
            </>
          ) : (
            <>
              {t.login.hasAccount}{" "}
              <button type="button" onClick={() => switchMode("login")} className="inline-block min-h-[44px] px-2 py-2.5 font-semibold text-emerald-400 underline-offset-4 hover:underline">
                {t.login.loginSubmit}
              </button>
            </>
          )}
        </p>
      </form>

    </main>
  );
}

// useSearchParams exige un límite Suspense en el prerender estático.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}
