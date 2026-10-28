"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken, ApiError } from "../../lib/api";

/** Login restyled (paquete 2026-10-28): clean and minimal, inspired by
 * claude.ai — one centered card, generous spacing, no clutter. ALL auth
 * logic is unchanged: username/password login, public registration with
 * the one-time server math challenge + per-IP rate limit, new accounts
 * always prueba, super_admin tier rules untouched. */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    setUsername(m === "login" ? "admin" : "");
    setPassword("");
    setAnswer("");
    if (m === "register") loadChallenge();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.login(username, password);
      setToken(res.access_token);
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (!challenge) throw new Error("No se pudo cargar la verificación. Inténtalo de nuevo.");
      await api.register({
        username: username.trim(),
        password,
        challenge_id: challenge.challenge_id,
        answer: Number(answer),
      });
      // La cuenta nueva entra como Prueba: inicia sesión con ella directamente.
      const res = await api.login(username.trim(), password);
      setToken(res.access_token);
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la cuenta.");
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
          Plataforma unificada
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-100">
          {mode === "login" ? "Bienvenido" : "Crea tu cuenta"}
        </h1>
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-zinc-400">
          {mode === "login"
            ? "Inicia sesión para entrar a tus módulos."
            : "Las cuentas nuevas entran como Prueba (solo ver y probar); un administrador puede subirte de rol."}
        </p>
      </div>

      <form
        onSubmit={mode === "login" ? onSubmit : onRegister}
        className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-xl sm:p-8"
      >
        <label className="mb-4 block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-300">Usuario</span>
          <input
            className={inputCls}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="Tu usuario"
            required
          />
        </label>
        <label className="mb-5 block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-300">Contraseña</span>
          <input
            type="password"
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="Tu contraseña"
            minLength={4}
            required
          />
        </label>

        {mode === "register" && (
          <div className="mb-5">
            <span className="mb-1.5 block text-sm font-medium text-zinc-300">
              Verificación: demuestra que no eres una máquina
            </span>
            <p className="mb-2 text-sm text-zinc-200">
              {challenge ? challenge.question : "Cargando verificación…"}
            </p>
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                inputMode="numeric"
                required
                autoComplete="off"
                placeholder="Tu respuesta"
              />
              <button
                type="button"
                onClick={loadChallenge}
                className="shrink-0 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              >
                Otra pregunta
              </button>
            </div>
          </div>
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
          {loading ? "Procesando…" : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
        </button>

        <p className="mt-5 text-center text-sm text-zinc-500">
          {mode === "login" ? (
            <>
              ¿No tienes cuenta?{" "}
              <button type="button" onClick={() => switchMode("register")} className="font-semibold text-emerald-400 hover:underline">
                Regístrate
              </button>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{" "}
              <button type="button" onClick={() => switchMode("login")} className="font-semibold text-emerald-400 hover:underline">
                Inicia sesión
              </button>
            </>
          )}
        </p>
      </form>

      <p className="mt-6 text-center text-xs leading-relaxed text-zinc-600">
        Cuentas de prueba: <code className="text-zinc-500">admin</code> / <code className="text-zinc-500">admin</code> (super admin) ·{" "}
        <code className="text-zinc-500">prueba</code> / <code className="text-zinc-500">prueba</code> (solo ver y probar)
      </p>
    </main>
  );
}
