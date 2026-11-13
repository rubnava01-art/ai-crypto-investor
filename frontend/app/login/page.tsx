"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, getToken, setToken, ApiError } from "../../lib/api";
import { safeNext } from "../../lib/session";
import { isPlanKey, planNameForKey, type PlanKey } from "../../components/PlanesPanel";
import { useLanguage } from "../../lib/i18n";
import { usePrefersReducedMotion } from "../../lib/useSwipeNav";
import { PublicNav } from "../../components/PublicNav";
import { SkipLink } from "../../components/ui";

/** Login restyled (paquete 2026-10-28): clean and minimal, inspired by
 * claude.ai — one centered card, generous spacing, no clutter.
 * Intro animado (2026-11-05, v2 más visible): entrada escalonada de
 * marca, título y formulario con subida de 24px + leve escala; con
 * movimiento reducido no se anima nada (ver globals.css). Formulario
 * pro: iconos en los campos, mostrar/ocultar contraseña, botón con
 * gradiente y spinner al procesar, línea de acento en la tarjeta.
 * Metro azul/blanco (2026-11-05, v3): fondo azul fuerte plano con
 * mosaicos estilo Metro, tarjeta blanca de esquinas rectas, logo NEST
 * (public/nest-logo.svg: marca + N3ST, trazos blancos) en el encabezado.
 * Dentro de la web (2026-11-12): la página usa PublicNav como
 * encabezado, el mismo menú público de la landing (Inicio, Contacto,
 * Registrarse, Login), para que el login no se sienta como otro sitio.
 * Pestañas Entrar/Registrarse encima del formulario (mismo switchMode)
 * y aviso de cuenta pendiente en el modo registro.
 * Cuentas por aprobar (2026-10-30): el registro ya NO inicia sesión
 * directo — la cuenta queda pendiente hasta que un administrador la
 * active desde el módulo Control de usuarios; el login de una cuenta
 * pendiente responde 403 con el aviso en español.
 * 2026-11-13: destino ?next= validado en lib/session.ts (A4); con
 * sesión válida se redirige fuera de /login salvo expired=1 (A5); el
 * plan elegido en las tarjetas (?plan=) se conserva, se muestra y se
 * envía en el registro (A2); el aviso post-registro es honesto — sin
 * plazo inventado y con enlace a /contacto (A3); el cambio de modo ya
 * no borra las credenciales escritas (M12). */
function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Fase 4 (FE7): volver al destino preservado (?next=) tras el login y
  // avisar cuando la llegada es por sesión expirada (?expired=1). Solo se
  // aceptan destinos internos validados (lib/session.ts): sin backslash,
  // sin slashes codificados y nunca el propio /login.
  const nextParam = searchParams.get("next");
  const nextDest = safeNext(nextParam);
  const sessionExpired = searchParams.get("expired") === "1";
  const { t } = useLanguage();
  // A2: plan elegido en las tarjetas de PlanesPanel (?plan=esencial |
  // crecimiento | total). Un valor desconocido se ignora, no se inventa.
  const planParam = searchParams.get("plan");
  const plan: PlanKey | null = isPlanKey(planParam) ? planParam : null;
  const planName = plan ? planNameForKey(t, plan) : null;
  // Intro animado: con movimiento reducido no se aplica ninguna clase de
  // animación; la media query de globals.css es la red de seguridad.
  const reducedMotion = usePrefersReducedMotion();
  const introCls = reducedMotion ? undefined : "login-intro";
  const introStyle = (delayMs: number): CSSProperties | undefined =>
    reducedMotion ? undefined : ({ "--login-delay": `${delayMs}ms` } as CSSProperties);
  // ?mode=register preselecciona el modo registro (enlace "Registrarse"
  // del menú público, /login?mode=register). La inicialización perezosa
  // cubre la llegada directa; el efecto de abajo cubre el cambio de
  // parámetro navegando dentro de /login sin remontar la página.
  const [mode, setMode] = useState<"login" | "register">(() =>
    searchParams.get("mode") === "register" ? "register" : "login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [registeredPlan, setRegisteredPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<{ challenge_id: string; question: string } | null>(null);
  const [answer, setAnswer] = useState("");

  // A5: con sesión válida, /login no es destino — volver al destino
  // pedido (o al dashboard). Con expired=1 NO se redirige: el aviso de
  // sesión expirada debe seguir visible y el token ya no vale.
  useEffect(() => {
    if (!sessionExpired && getToken()) router.replace(nextDest);
  }, [sessionExpired, nextDest, router]);

  const loadChallenge = useCallback(async () => {
    try {
      setChallenge(await api.registerChallenge());
    } catch {
      setChallenge(null);
    }
  }, []);

  // Precargar el reto anti-bots al montar la página, no solo al cambiar a
  // "registro": así el primer clic en "Crear cuenta" ya tiene la pregunta
  // (o un spinner) en vez de texto plano. El reto NO se cachea en cliente:
  // cada llamada pide uno nuevo al servidor (B3) y un registro fallido lo
  // renueva.
  useEffect(() => {
    loadChallenge();
  }, [loadChallenge]);

  // M12: cambiar de modo ya NO borra el usuario ni la contraseña: si el
  // usuario escribió sus credenciales en "Entrar" y toca "Registrarse"
  // por error, no lo pierde todo. Solo se limpian error, aviso y respuesta.
  const switchMode = useCallback((m: "login" | "register") => {
    setMode(m);
    setError(null);
    setNotice(null);
    setRegisteredPlan(null);
    setShowPassword(false);
    setAnswer("");
    if (m === "register") loadChallenge();
  }, [loadChallenge]);

  useEffect(() => {
    if (searchParams.get("mode") === "register" && mode !== "register") {
      switchMode("register");
    }
  }, [searchParams, mode, switchMode]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setRegisteredPlan(null);
    setLoading(true);
    try {
      // M6: el login también recorta el usuario (el registro ya lo hacía):
      // " ruben " no debe fallar cuando la cuenta es "ruben".
      const res = await api.login(username.trim(), password);
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
    setRegisteredPlan(null);
    // M6: la respuesta matemática debe ser un entero. Sin esto, Number(" ")
    // es 0, "1e2" es 100 y "abc" es NaN (null en JSON → 422 crudo).
    const trimmedAnswer = answer.trim();
    if (!/^-?\d+$/.test(trimmedAnswer)) {
      setError(t.login.errorAnswerInvalid);
      return;
    }
    setLoading(true);
    try {
      if (!challenge) throw new Error(t.login.errorChallenge);
      await api.register({
        username: username.trim(),
        password,
        challenge_id: challenge.challenge_id,
        answer: Number(trimmedAnswer),
        // A2: la elección de plan viaja al backend (requested_plan) para
        // que el admin la vea en los pendientes. Sin plan, no se envía.
        ...(plan ? { plan } : {}),
      });
      // Cuenta pendiente: NO inicia sesión directa; un administrador la
      // activa desde Control de usuarios y entonces podrá entrar.
      setNotice(t.login.noticePending);
      setRegisteredPlan(planName);
      setMode("login");
      setPassword("");
      setAnswer("");
    } catch (err) {
      // M6: el 422 del reto (respuesta no entera o reto vencido) se muestra
      // con texto i18n, no con el detalle crudo del backend.
      if (err instanceof ApiError && err.status === 422) {
        setError(t.login.errorAnswerInvalid);
      } else {
        setError(err instanceof ApiError ? err.message : t.login.errorCreate);
      }
      loadChallenge();
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "w-full rounded-none border border-zinc-300 bg-white px-3.5 py-3 text-[15px] text-zinc-900 placeholder-zinc-400 outline-none transition hover:border-zinc-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30";

  return (
    <div className="flex min-h-dvh flex-col bg-blue-700">
      <PublicNav variant="onBlue" />
      <main data-login className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-12">
      <SkipLink label={t.shell.skipLink} />
      {/* Mosaicos estilo Metro: cuadrados planos blancos semitransparentes,
       * decorativos, sin movimiento. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-10 -top-10 h-44 w-44 bg-white/10" />
        <div className="absolute right-6 top-16 h-20 w-20 bg-white/10" />
        <div className="absolute bottom-24 left-8 h-16 w-16 bg-white/[0.07]" />
        <div className="absolute -bottom-8 -right-8 h-40 w-40 bg-white/[0.07]" />
        <div className="absolute bottom-10 right-24 h-10 w-10 bg-white/10" />
      </div>
      <div className="relative mb-7 flex flex-col items-center text-center">
        {/* Logo NEST: marca + N3ST en trazos blancos sobre el azul fuerte.
         * Recorte de presentación del logo original (sin el lema ni el
         * katakana, que no se leen a este tamaño). */}
        <img
          src="/nest-logo.svg"
          alt="NEST"
          width={176}
          height={122}
          fetchPriority="high"
          className={`mb-5 h-auto w-44${reducedMotion ? "" : " login-intro-badge"}`}
        />
        <h1 className={`text-2xl font-bold tracking-tight text-white sm:text-3xl${introCls ? " login-intro" : ""}`} style={introStyle(150)}>
          {mode === "login" ? t.login.welcome : t.login.createAccount}
        </h1>
        <p className={`mt-1 max-w-xs text-sm leading-relaxed text-blue-100${introCls ? " login-intro" : ""}`} style={introStyle(250)}>
          {mode === "login" ? t.login.subtitleLogin : t.login.subtitleRegister}
        </p>
        {mode === "register" && planName && (
          <p className="mt-2 rounded-none bg-white/15 px-3 py-1.5 text-sm font-semibold text-white">
            {t.login.pendingPlan.replace("{plan}", planName)}
          </p>
        )}
      </div>

      <form
        id="contenido"
        onSubmit={mode === "login" ? onSubmit : onRegister}
        style={introStyle(350)}
        className={`relative w-full max-w-sm overflow-hidden rounded-none border-0 bg-white p-6 shadow-2xl shadow-blue-900/40 sm:p-8${introCls ? " login-intro" : ""}`}
      >
        {/* Barra superior azul sólida: detalle Metro de la tarjeta. */}
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-blue-600" />
        {/* Pestañas Entrar / Registrarse: el mismo cambio de modo que el
         * enlace de abajo, visible desde arriba para que el acceso se
         * entienda de un vistazo. M12: dos botones simples con
         * aria-pressed en vez de un tablist incompleto (sin tabpanel ni
         * navegación con flechas). */}
        <div className="mb-5 grid grid-cols-2 gap-1 bg-zinc-100 p-1">
          <button
            type="button"
            aria-pressed={mode === "login"}
            onClick={() => switchMode("login")}
            className={`min-h-[44px] px-3 py-2.5 text-sm font-semibold transition ${mode === "login" ? "bg-white text-blue-700 shadow-sm" : "text-zinc-500 hover:text-zinc-700"}`}
          >
            {t.login.modeLoginTab}
          </button>
          <button
            type="button"
            aria-pressed={mode === "register"}
            onClick={() => switchMode("register")}
            className={`min-h-[44px] px-3 py-2.5 text-sm font-semibold transition ${mode === "register" ? "bg-white text-blue-700 shadow-sm" : "text-zinc-500 hover:text-zinc-700"}`}
          >
            {t.login.modeRegisterTab}
          </button>
        </div>
        <label className="mb-4 block">
          <span className="mb-1.5 block text-sm font-semibold text-zinc-700">{t.login.userLabel}</span>
          <span className="relative block">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" strokeWidth={1.5} stroke="currentColor" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
            <input
              className={`${inputCls} pl-11`}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder={t.login.userPlaceholder}
              maxLength={64}
              required
            />
          </span>
        </label>
        <label className="mb-5 block">
          <span className="mb-1.5 block text-sm font-semibold text-zinc-700">{t.login.passwordLabel}</span>
          <span className="relative block">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" strokeWidth={1.5} stroke="currentColor" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            <input
              type={showPassword ? "text" : "password"}
              className={`${inputCls} pl-11 pr-12`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder={t.login.passwordPlaceholder}
              minLength={12}
              maxLength={128}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t.login.hidePassword : t.login.showPassword}
              className="absolute right-1.5 top-1/2 flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-none text-zinc-500 hover:text-blue-700"
            >
              {showPassword ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.01 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.01-9.963-7.178Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              )}
            </button>
          </span>
          {/* M12: la misma pista en ambos modos (todas las contraseñas
              de la plataforma tienen al menos 12 caracteres). */}
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{t.login.passwordMinHint}</p>
        </label>

        {mode === "register" && (
          <div className="mb-5">
            <span className="mb-1.5 block text-sm font-semibold text-zinc-700">
              {t.login.verificationLabel}
            </span>
            {challenge ? (
              <p className="mb-2 text-sm text-zinc-900">{challenge.question}</p>
            ) : (
              <p role="status" className="mb-2 flex items-center gap-2 text-sm text-zinc-500">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4 animate-spin">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
                </svg>
                {t.login.verificationLoading}
              </p>
            )}
            <div className="flex gap-2">
              <input aria-label={t.login.answerPlaceholder}
                className={inputCls}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                inputMode="numeric"
                maxLength={10}
                required
                autoComplete="off"
                placeholder={t.login.answerPlaceholder}
              />
              <button
                type="button"
                onClick={loadChallenge}
                className="min-h-[44px] shrink-0 rounded-none border border-zinc-300 px-3 py-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
              >
                {t.login.anotherQuestion}
              </button>
            </div>
          </div>
        )}

        {mode === "register" && (
          <p className="mb-5 rounded-none bg-blue-50 px-3.5 py-2.5 text-sm leading-relaxed text-blue-800 ring-1 ring-blue-200">
            {t.login.registerPendingNote}
          </p>
        )}

        {/* M10: el aviso de sesión expirada se muestra en ambos modos. */}
        {sessionExpired && (
          <p role="status" className="mb-5 rounded-none bg-amber-50 px-3.5 py-2.5 text-sm leading-relaxed text-amber-700 ring-1 ring-amber-200">
            {t.reliability.sessionExpired}
          </p>
        )}

        {notice && (
          <div role="status" className="mb-5 rounded-none bg-emerald-50 px-3.5 py-2.5 text-sm leading-relaxed text-emerald-700 ring-1 ring-emerald-200">
            <p>{notice}</p>
            {registeredPlan && (
              <p className="mt-1 font-semibold">{t.login.pendingPlan.replace("{plan}", registeredPlan)}</p>
            )}
            {/* A3: qué pasa ahora, sin inventar plazo ni contacto: la
                activación la revisa un administrador y no hay un plazo
                publicado; la página de contacto es el siguiente paso. */}
            <p className="mt-1">{t.login.pendingNext}</p>
            <p className="mt-2">
              <Link href="/contacto" className="font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-900">
                {t.login.contactLink}
              </Link>
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="mb-5 rounded-none bg-red-50 px-3.5 py-2.5 text-sm leading-relaxed text-red-700 ring-1 ring-red-200">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || (mode === "register" && !challenge)}
          className="flex w-full items-center justify-center gap-2 rounded-none bg-blue-600 px-3 py-3 text-[15px] font-bold uppercase tracking-wide text-white transition hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50"
        >
          {loading && (
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5 animate-spin">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
            </svg>
          )}
          {loading ? t.login.processing : mode === "login" ? t.login.loginSubmit : t.login.createSubmit}
        </button>

        <p className="mt-5 text-center text-sm text-zinc-500">
          {mode === "login" ? (
            <>
              {t.login.noAccount}{" "}
              <button type="button" onClick={() => switchMode("register")} className="inline-block min-h-[44px] px-2 py-2.5 font-semibold text-blue-700 underline-offset-4 hover:underline">
                {t.login.registerLink}
              </button>
            </>
          ) : (
            <>
              {t.login.hasAccount}{" "}
              <button type="button" onClick={() => switchMode("login")} className="inline-block min-h-[44px] px-2 py-2.5 font-semibold text-blue-700 underline-offset-4 hover:underline">
                {t.login.loginSubmit}
              </button>
            </>
          )}
        </p>
      </form>

      <p className={`mt-6 flex items-center justify-center gap-1.5 text-xs font-medium text-blue-100${introCls ? " login-intro" : ""}`} style={introStyle(450)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" strokeWidth={1.5} stroke="currentColor" className="h-3.5 w-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
        {t.header.brand} · {t.login.secureNote}
      </p>

      </main>
    </div>
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
