"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { api, getToken, setToken, logout, ApiError } from "../../lib/api";
import { isTokenExpired, safeNext } from "../../lib/session";
import { setSessionCookie } from "../../lib/sessionCookie";
import { passwordStrength } from "../../lib/passwordStrength";
import { isPlanKey, planNameForKey, type PlanKey } from "../../lib/planes";
import { useLanguage } from "../../lib/i18n";
import { usePrefersReducedMotion } from "../../lib/useSwipeNav";
import { PublicNav } from "../../components/PublicNav";
import { GuestTrialButton } from "../../components/GuestTrial";
import { ColdStartNotice } from "../../components/ColdStartNotice";
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
  // Medidor de seguridad (2026-11-17, solo registro): pista visual, no
  // bloquea nada — el backend sigue exigiendo ≥12 caracteres. Se calcula
  // en cada render: es una función pura y barata.
  const strength = passwordStrength(password);
  const strengthLabelText =
    strength.level === "weak" ? t.login.strengthWeak
    : strength.level === "fair" ? t.login.strengthFair
    : strength.level === "good" ? t.login.strengthGood
    : t.login.strengthStrong;
  const strengthBarCls =
    strength.level === "weak" ? "bg-red-500"
    : strength.level === "fair" ? "bg-amber-500"
    : strength.level === "good" ? "bg-lime-500"
    : "bg-emerald-600";
  const strengthTextCls =
    strength.level === "weak" ? "text-red-700"
    : strength.level === "fair" ? "text-amber-700"
    : strength.level === "good" ? "text-lime-700"
    : "text-emerald-700";
  const [challenge, setChallenge] = useState<{ challenge_id: string; question: string } | null>(null);
  const [answer, setAnswer] = useState("");
  // Fase 2 mejoras-v1, tarea 1: aceptación de los textos legales al
  // registrarse (checkbox obligatorio; el backend lo exige con 422 y
  // guarda la fecha). Sin marcarlo no se envía el registro.
  const [termsAccepted, setTermsAccepted] = useState(false);
  // F1 (correcciones Fase 1 mejoras-v1): segundo paso del login (2FA).
  // Cuando la contraseña es correcta pero falta el código, el backend
  // responde 401 "Se requiere el código…": se muestra este campo y el
  // reenvío usa la contraseña ya escrita, sin pedirla de nuevo.
  const [totpCode, setTotpCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  // Correo sin verificar (403 con "verific" en el detalle): aviso +
  // botón de reenvío del enlace, distinto de la cuenta pendiente.
  const [isEmailUnverified, setIsEmailUnverified] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  // F1-7: si la carga del reto falla se muestra el error con reintento,
  // en vez de dejar el botón deshabilitado sin explicación.
  const [challengeError, setChallengeError] = useState(false);
  // F1-3: error estructurado del login — el mensaje i18n preciso, si el
  // fallo admite reintento y, en 429, hasta cuándo (cuenta atrás).
  const [canRetryLogin, setCanRetryLogin] = useState(false);
  const [isPendingAccount, setIsPendingAccount] = useState(false);
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const lastLoginRef = useRef<{ username: string; password: string } | null>(null);
  // F1-4: segundos de espera del login en curso (ColdStartNotice, ~5 s).
  const [loginElapsed, setLoginElapsed] = useState(0);
  useEffect(() => {
    if (!loading) {
      setLoginElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setLoginElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);
  // Cuenta atrás del 429: tictac de 1 s hasta que se cumple el plazo.
  useEffect(() => {
    if (rateLimitUntil == null) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [rateLimitUntil]);
  const rateRemaining = rateLimitUntil == null ? 0 : Math.max(0, Math.ceil((rateLimitUntil - nowMs) / 1000));
  useEffect(() => {
    if (rateLimitUntil != null && rateRemaining === 0) {
      setRateLimitUntil(null);
      // Plazo cumplido: el reintento ya vale y el mensaje deja de
      // mostrar segundos viejos.
      setCanRetryLogin(true);
      setError(t.login.errorTooManyAttemptsNoWait);
    }
  }, [rateLimitUntil, rateRemaining, t]);

  // A5: con sesión válida, /login no es destino — volver al destino
  // pedido (o al dashboard). Con expired=1 NO se redirige: el aviso de
  // sesión expirada debe seguir visible y el token ya no vale.
  // F8 (2026-11-23, B4): un token caducado es como no tener token — se
  // borra y NO se redirige al dashboard (evita el rebote dashboard →
  // 401 → /login).
  // F1-6 (chat-potencia 2026-11-24): antes de redirigir, el token se
  // valida contra el servidor con GET /api/auth/me (memo 60 s): un token
  // revocado pero no caducado ya no rebota a / y de vuelta a /login.
  useEffect(() => {
    if (sessionExpired) return;
    const token = getToken();
    if (!token) return;
    if (isTokenExpired(token)) {
      logout();
      return;
    }
    let cancelled = false;
    api.me().then(() => {
      if (!cancelled) router.replace(nextDest);
    }).catch((err) => {
      if (cancelled) return;
      // Token inválido/revocado: se borra y se queda en /login. Un fallo
      // de red también se queda: el usuario entra a mano con el formulario.
      if (err instanceof ApiError && err.status === 401) logout();
    });
    return () => {
      cancelled = true;
    };
  }, [sessionExpired, nextDest, router]);

  const loadChallenge = useCallback(async () => {
    setChallengeError(false);
    try {
      setChallenge(await api.registerChallenge());
    } catch {
      setChallenge(null);
      setChallengeError(true);
    }
  }, []);

  // F1-1: el reto de registro solo se pide en modo registro — en modo
  // Entrar no se usa y su GET era un viaje innecesario por visita. Al
  // cambiar a registro, switchMode lo pide (abajo).
  useEffect(() => {
    if (mode === "register") loadChallenge();
    // Solo al montar: el cambio de modo lo cubre switchMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setNeedsTotp(false);
    setTotpCode("");
    setIsEmailUnverified(false);
    setResendMsg(null);
    if (m === "register") loadChallenge();
  }, [loadChallenge]);

  useEffect(() => {
    if (searchParams.get("mode") === "register" && mode !== "register") {
      switchMode("register");
    }
  }, [searchParams, mode, switchMode]);

  // F1-2: validación temprana en cliente, antes de gastar un POST:
  // usuario vacío tras recortar y clave de menos de 12 caracteres.
  function validateCredentials(user: string, pass: string): string | null {
    if (!user.trim()) return t.login.errorUserEmpty;
    if (pass.length < 12) return t.login.errorPasswordShort;
    return null;
  }

  function clearLoginError() {
    setError(null);
    setCanRetryLogin(false);
    setIsPendingAccount(false);
    setRateLimitUntil(null);
    setNeedsTotp(false);
    setIsEmailUnverified(false);
    setResendMsg(null);
  }

  // F1-3: el error del login se mapea por estado a un mensaje i18n
  // preciso; el detail crudo del backend nunca se muestra. Red/timeout
  // y 429 admiten reintento; 401/403 no (repetir no ayudaría).
  // 3.4 (plan Gemini, 2026-11-26): red/timeout NO usa el mensaje
  // genérico de "sin conexión" ni se confunde con credenciales: el
  // servidor puede estar despertando (arranque en frío) y el mensaje
  // lo dice y pide reintentar en unos segundos. El ColdStartNotice ya
  // avisa durante la espera (≥5 s); este mensaje cubre el fallo
  // posterior a la espera, sin duplicar el aviso.
  // F1 (correcciones Fase 1): el 401 distingue el segundo paso del
  // 2FA (falta el código / código incorrecto: se muestra el campo y se
  // reintenta sin reescribir la contraseña) y el 403 distingue el
  // correo sin verificar de la cuenta pendiente.
  function loginErrorFrom(err: unknown): {
    message: string;
    canRetry: boolean;
    pending?: boolean;
    retryAfter?: number | null;
    needsTotp?: boolean;
    emailUnverified?: boolean;
  } {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        const detail = err.detail ?? "";
        if (detail.includes("dos pasos")) {
          return { message: t.login.errorTotpRequired, canRetry: false, needsTotp: true };
        }
        if (detail.includes("Código de verificación incorrecto")) {
          return { message: t.login.errorTotpWrong, canRetry: false, needsTotp: true };
        }
        return { message: t.login.errorWrongCredentials, canRetry: false };
      }
      if (err.status === 403) {
        if ((err.detail ?? "").includes("verific")) {
          return { message: t.login.errorEmailUnverified, canRetry: false, emailUnverified: true };
        }
        return { message: t.login.errorPending, canRetry: false, pending: true };
      }
      if (err.status === 429) {
        const seconds = err.retryAfter;
        return {
          message:
            seconds != null
              ? t.login.errorTooManyAttempts.replace("{seconds}", String(seconds))
              : t.login.errorTooManyAttemptsNoWait,
          canRetry: seconds == null,
          retryAfter: seconds ?? null,
        };
      }
      if (err.key === "network") return { message: t.login.errorServerWaking, canRetry: true };
      if (err.key === "timeout") return { message: t.login.errorServerWaking, canRetry: true };
      if (err.status >= 500) return { message: t.login.errorLogin, canRetry: true };
    }
    return { message: t.login.errorLogin, canRetry: false };
  }

  async function attemptLogin(user: string, pass: string, totp?: string) {
    setLoading(true);
    try {
      // M6: el login también recorta el usuario (el registro ya lo hacía):
      // " ruben " no debe fallar cuando la cuenta es "ruben".
      const res = await api.login(user.trim(), pass, totp);
      setNeedsTotp(false);
      setToken(res.access_token);
      // Corrección QA H2: marca no sensible para que el servidor sirva
      // la cáscara del dashboard en la raíz en vez de la landing. Si la
      // validación /me luego da 401, logout() la borra.
      setSessionCookie();
      // F1-6: validar el token recién emitido con /me antes de redirigir.
      try {
        await api.me();
        router.replace(nextDest);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          setError(t.login.errorLogin);
        } else {
          // Fallo de red validando: el login tuvo éxito y el token es
          // nuevo; redirigir igual en vez de dejar al usuario atascado.
          router.replace(nextDest);
        }
      }
    } catch (err) {
      const mapped = loginErrorFrom(err);
      setError(mapped.message);
      setCanRetryLogin(mapped.canRetry);
      setIsPendingAccount(mapped.pending ?? false);
      setNeedsTotp(mapped.needsTotp ?? false);
      setIsEmailUnverified(mapped.emailUnverified ?? false);
      if (mapped.retryAfter != null) {
        setRateLimitUntil(Date.now() + mapped.retryAfter * 1000);
        setNowMs(Date.now());
      }
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // El paso 2FA no borra el código ya escrito al reenviar: se guarda
    // antes de limpiar el error (clearLoginError resetea needsTotp).
    const totpStep = needsTotp;
    const code = totpCode.trim();
    clearLoginError();
    setNotice(null);
    setRegisteredPlan(null);
    const validationError = validateCredentials(username, password);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (totpStep && !code) {
      setNeedsTotp(true);
      setError(t.login.errorTotpRequired);
      return;
    }
    lastLoginRef.current = { username, password };
    await attemptLogin(username, password, totpStep ? code : undefined);
  }

  // Reintento del login (F1-3): reenvía las credenciales ya escritas, sin
  // que el usuario las reescriba. Solo existe tras red/timeout/429/5xx.
  async function retryLogin() {
    const last = lastLoginRef.current;
    if (!last) return;
    // Sin guarda de `loading`: el reintento del ColdStartNotice existe
    // justo para una petición colgada; el botón de error ya se deshabilita
    // mientras carga.
    clearLoginError();
    await attemptLogin(last.username, last.password, totpCode.trim() || undefined);
  }

  // Reenvío del enlace de verificación (correo sin verificar): el
  // backend responde siempre 200 genérico, exista o no la cuenta.
  async function resendVerificationLink() {
    setResendMsg(null);
    setResendBusy(true);
    try {
      await api.resendVerification(username.trim());
      setResendMsg(t.login.resendSent);
    } catch {
      setError(t.login.resendFailed);
    } finally {
      setResendBusy(false);
    }
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    clearLoginError();
    setNotice(null);
    setRegisteredPlan(null);
    const validationError = validateCredentials(username, password);
    if (validationError) {
      setError(validationError);
      return;
    }
    // M6: la respuesta matemática debe ser un entero. Sin esto, Number(" ")
    // es 0, "1e2" es 100 y "abc" es NaN (null en JSON → 422 crudo).
    const trimmedAnswer = answer.trim();
    if (!/^-?\d+$/.test(trimmedAnswer)) {
      setError(t.login.errorAnswerInvalid);
      return;
    }
    // Fase 2 mejoras-v1, tarea 1: sin aceptar los textos legales no hay
    // registro (el backend también lo exige: 422).
    if (!termsAccepted) {
      setError(t.login.errorTermsRequired);
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
        terms_accepted: true,
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
      // S-1 (chat-potencia): el registro ya no devuelve 409 — el backend
      // responde con el mismo cuerpo en duplicado y nuevo, así que la
      // rama 409 era código muerto y se elimina. Un 422 del reto se
      // muestra con texto i18n, no con el detalle crudo del backend.
      if (err instanceof ApiError && err.status === 422) {
        setError(t.login.errorAnswerInvalid);
      } else {
        setError(t.login.errorCreate);
      }
      loadChallenge();
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "w-full rounded-none border border-zinc-300 bg-white px-3.5 py-3 text-[15px] text-zinc-900 placeholder-zinc-600 outline-none transition hover:border-zinc-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30";

  return (
    <div className="flex min-h-dvh flex-col bg-blue-700">
      <PublicNav variant="onBlue" />
      <main data-login id="contenido" tabIndex={-1} className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-12 outline-none">
      {/* SkipLink a <main> (a11y): antes apuntaba al <form>. */}
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
        <Image
          src="/nest-logo.svg"
          alt="NEST"
          width={176}
          height={122}
          priority
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
            className={`min-h-[44px] px-3 py-2.5 text-sm font-semibold transition ${mode === "login" ? "bg-white text-blue-700 shadow-sm" : "text-zinc-600 hover:text-zinc-700"}`}
          >
            {t.login.modeLoginTab}
          </button>
          <button
            type="button"
            aria-pressed={mode === "register"}
            onClick={() => switchMode("register")}
            className={`min-h-[44px] px-3 py-2.5 text-sm font-semibold transition ${mode === "register" ? "bg-white text-blue-700 shadow-sm" : "text-zinc-600 hover:text-zinc-700"}`}
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
              // Acceso (2026-11-24): el cursor ya está en el usuario al
              // abrir el login — un toque menos en móvil, donde Rubén
              // trabaja. Solo al montar: cambiar de pestaña no remonta
              // el campo y no roba el foco.
              autoFocus
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
              className="absolute right-1.5 top-1/2 flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-none text-zinc-600 hover:text-blue-700"
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
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">{t.login.passwordMinHint}</p>
        </label>

        {/* F1 (correcciones Fase 1): segundo paso del login (2FA). Solo
            aparece cuando la contraseña ya fue correcta y falta el
            código: la contraseña no se pide de nuevo, el reenvío usa
            la ya escrita. Vale el TOTP de la app o un código de
            recuperación (XXXX-XXXX). */}
        {mode === "login" && needsTotp && (
          <label className="mb-5 block">
            <span className="mb-1.5 block text-sm font-semibold text-zinc-700">{t.login.totpLabel}</span>
            <input
              className={inputCls}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              autoComplete="one-time-code"
              placeholder={t.login.totpPlaceholder}
              maxLength={16}
              required
              autoFocus
            />
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">{t.login.totpHint}</p>
            <button
              type="button"
              onClick={() => {
                setNeedsTotp(false);
                setTotpCode("");
                setError(null);
              }}
              className="mt-1 inline-block min-h-[44px] px-2 py-2.5 text-sm font-semibold text-blue-700 underline-offset-4 hover:underline"
            >
              {t.login.totpBack}
            </button>
          </label>
        )}

        {/* Medidor de seguridad (solo registro y con algo escrito): 4
            segmentos + etiqueta; no bloquea el envío. */}
        {mode === "register" && password.length > 0 && (
          <div className="mb-5 -mt-3" aria-live="polite">
            <div className="flex gap-1" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={`h-1.5 flex-1 rounded-full ${i < strength.segments ? strengthBarCls : "bg-zinc-200"}`} />
              ))}
            </div>
            <p className={`mt-1.5 text-xs font-semibold ${strengthTextCls}`}>
              {t.login.strengthLabel}: {strengthLabelText}
            </p>
          </div>
        )}

        {mode === "register" && (
          <div className="mb-5">
            <span className="mb-1.5 block text-sm font-semibold text-zinc-700">
              {t.login.verificationLabel}
            </span>
            {challenge ? (
              <p className="mb-2 text-sm text-zinc-900">{challenge.question}</p>
            ) : challengeError ? (
              <div className="mb-2">
                <p role="alert" className="text-sm leading-relaxed text-red-700">{t.login.errorChallenge}</p>
                <button
                  type="button"
                  onClick={loadChallenge}
                  className="mt-2 inline-flex min-h-[44px] items-center rounded-none border border-zinc-300 px-3 py-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                >
                  {t.login.retry}
                </button>
              </div>
            ) : (
              <p role="status" className="mb-2 flex items-center gap-2 text-sm text-zinc-600">
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
          <label className="mb-5 flex cursor-pointer items-start gap-2.5 text-sm leading-relaxed text-zinc-700">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              required
              className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700"
            />
            <span>
              {t.login.termsAcceptPrefix}{" "}
              <Link href="/legal/terminos" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800">
                {t.login.termsLink}
              </Link>{" "}
              {t.login.termsAcceptMiddle}{" "}
              <Link href="/legal/privacidad" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800">
                {t.login.privacyLink}
              </Link>
            </span>
          </label>
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
          <div role="alert" className="mb-5 rounded-none bg-red-50 px-3.5 py-2.5 ring-1 ring-red-200">
            <p className="text-sm leading-relaxed text-red-700">{error}</p>
            {isPendingAccount && (
              <p className="mt-2">
                <Link href="/contacto" className="text-sm font-semibold text-red-800 underline underline-offset-2 hover:text-red-900">
                  {t.login.contactLink}
                </Link>
              </p>
            )}
            {isEmailUnverified && (
              <p className="mt-2">
                <button
                  type="button"
                  onClick={resendVerificationLink}
                  disabled={resendBusy}
                  className="inline-flex min-h-[44px] items-center rounded-none border border-red-300 px-3 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  {resendBusy ? t.login.resending : t.login.resendVerification}
                </button>
                {resendMsg && (
                  <span role="status" className="mt-2 block text-sm leading-relaxed text-emerald-700">{resendMsg}</span>
                )}
              </p>
            )}
            {/* F1-3: reintento sin reescribir credenciales (red, timeout,
                429 cumplido, 5xx). En 429 con cuenta atrás, el botón
                aparece cuando el plazo termina. */}
            {canRetryLogin && rateRemaining === 0 && (
              <button
                type="button"
                onClick={retryLogin}
                disabled={loading}
                className="mt-2 inline-flex min-h-[44px] items-center rounded-none border border-red-300 px-3 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                {t.login.retryLogin}
              </button>
            )}
          </div>
        )}

        {/* F1-4: aviso de arranque en frío a partir de ~5 s de espera. */}
        <ColdStartNotice
          loading={loading}
          elapsedSeconds={loginElapsed}
          onRetry={mode === "login" ? retryLogin : undefined}
        />

        <button
          type="submit"
          disabled={loading || (mode === "register" && !challenge) || rateRemaining > 0}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-none bg-blue-600 px-3 py-3 text-[15px] font-bold uppercase tracking-wide text-white transition hover:bg-blue-700 motion-safe:active:scale-[0.99] disabled:opacity-50"
        >
          {loading && (
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5 animate-spin">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
            </svg>
          )}
          {loading
            ? t.login.processing
            : mode === "login"
              ? needsTotp
                ? t.login.totpSubmit
                : t.login.loginSubmit
              : t.login.createSubmit}
        </button>

        <p className="mt-5 text-center text-sm text-zinc-600">
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

      {/* H-01 (QA TBT-Herramientas, 2026-11-24): vía de invitado en
          /login — el visitante que llegó desde «Pruébala sin cuenta»
          entra sin cuenta y sin volver al héroe; el botón enhebra
          ?next= (validado, con fragmento) y cae a /inicio sin destino
          válido. No toca el flujo entrar/registrarse de arriba. */}
      <div className={`relative mt-6 flex w-full max-w-sm justify-center${introCls ? " login-intro" : ""}`} style={introStyle(400)}>
        <GuestTrialButton />
      </div>

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
