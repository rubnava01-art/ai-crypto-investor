"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken, ApiError } from "../../lib/api";
import { useLanguage } from "../../lib/i18n";

/** Login restyled (paquete 2026-10-28): clean and minimal, inspired by
 * claude.ai — one centered card, generous spacing, no clutter.
 * Cuentas por aprobar (2026-10-30): el registro ya NO inicia sesión
 * directo — la cuenta queda pendiente hasta que un administrador la
 * active desde el módulo Control de usuarios; el login de una cuenta
 * pendiente responde 403 con el aviso en español. */
export default function LoginPage() {
  const router = useRouter();
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
      router.replace("/");
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
    "w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 text-[15px] text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-emerald-500";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white shadow-lg shadow-emerald-950/50">
          P
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-emerald-400">
          {t.header.brand}
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-100">
          {mode === "login" ? t.login.welcome : t.login.createAccount}
        </h1>
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-zinc-400">
          {mode === "login" ? t.login.subtitleLogin : t.login.subtitleRegister}
        </p>
      </div>

      <form
        onSubmit={mode === "login" ? onSubmit : onRegister}
        className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-xl sm:p-8"
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
            minLength={4}
            required
          />
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
                className="shrink-0 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              >
                {t.login.anotherQuestion}
              </button>
            </div>
          </div>
        )}

        {notice && (
          <p role="status" className="mb-5 rounded-xl bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300">
            {notice}
          </p>
        )}

        {error && (
          <p role="alert" className="mb-5 rounded-xl bg-red-500/10 px-3.5 py-2.5 text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-emerald-600 px-3 py-2.5 text-[15px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {loading ? t.login.processing : mode === "login" ? t.login.loginSubmit : t.login.createSubmit}
        </button>

        <p className="mt-5 text-center text-sm text-zinc-500">
          {mode === "login" ? (
            <>
              {t.login.noAccount}{" "}
              <button type="button" onClick={() => switchMode("register")} className="font-semibold text-emerald-400 hover:underline">
                {t.login.registerLink}
              </button>
            </>
          ) : (
            <>
              {t.login.hasAccount}{" "}
              <button type="button" onClick={() => switchMode("login")} className="font-semibold text-emerald-400 hover:underline">
                {t.login.loginSubmit}
              </button>
            </>
          )}
        </p>
      </form>

    </main>
  );
}
