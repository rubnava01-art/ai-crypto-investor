"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken, ApiError } from "../../lib/api";

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

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={mode === "login" ? onSubmit : onRegister}
        className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/70 p-6"
      >
        <h1 className="mb-1 text-xl font-bold tracking-tight">AI CRYPTO INVESTOR</h1>
        <p className="mb-6 text-sm text-zinc-400">
          {mode === "login"
            ? "Sign in to the dashboard (demo mode)."
            : "Crea tu cuenta. Las cuentas nuevas entran como Prueba (solo ver y probar); un administrador puede subirte de rol."}
        </p>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-400">
            Username
          </span>
          <input
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-400">
            Password
          </span>
          <input
            type="password"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={4}
          />
        </label>

        {mode === "register" && (
          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-400">
              Verificación: demuestra que no eres una máquina
            </span>
            <span className="mb-1 block text-sm text-zinc-200">
              {challenge ? challenge.question : "Cargando verificación…"}
            </span>
            <div className="flex gap-2">
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
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
                className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Otra pregunta
              </button>
            </div>
          </label>
        )}

        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {loading ? "Procesando…" : mode === "login" ? "Sign in" : "Crear cuenta"}
        </button>
        <p className="mt-4 text-center text-xs text-zinc-500">
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
        <p className="mt-2 text-center text-xs text-zinc-500">
          Dev login: <code className="text-zinc-400">admin</code> / <code className="text-zinc-400">admin</code> (super admin) ·{" "}
          <code className="text-zinc-400">prueba</code> / <code className="text-zinc-400">prueba</code> (solo ver y probar)
        </p>
      </form>
    </main>
  );
}
