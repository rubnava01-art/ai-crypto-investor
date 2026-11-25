"use client";

// Formulario público de contacto (2026-11-25, plan servicios-calc).
// POST /api/contacto/mensajes SIN auth (contrato backend): nombre,
// correo, servicio, mensaje + honeypot `website` (visualmente oculto,
// aria-hidden, tabIndex -1: si viene relleno es un bot y se finge el
// éxito sin llamar al API). Validación en cliente con los mismos
// límites del contrato + mapeo de errores del servidor (422 →
// validación, 429 → espera con los segundos de Retry-After), todo en
// español. Doble envío bloqueado (busy), estado de éxito sin plazos
// ni promesas. Preselección por ?servicio= vía useEffect +
// window.location.search (evita el Suspense de useSearchParams);
// valor inválido o ausente → placeholder «Elige un servicio».
// Accesibilidad: etiquetas visibles (Field), aria-invalid +
// aria-describedby por campo, errores con role="alert", éxito con
// role="status", objetivos táctiles 44 px (patrón del lote).
import { useEffect, useState } from "react";
import { ApiError, api } from "../lib/api";
import { useLanguage } from "../lib/i18n";
import {
  CONTACTO_MENSAJE_MAX,
  CONTACTO_NOMBRE_MAX,
  CONTACTO_SERVICIOS,
  isHoneypotFilled,
  parseServicioParam,
  validateContactoForm,
  type ContactoFormErrorCode,
  type ContactoFormErrors,
  type ContactoServicio,
} from "../lib/contacto";
import { Field } from "./ui";

const inputCls =
  "mt-1 w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60";
const inputErrCls = "border-red-500 focus:border-red-500 focus-visible:ring-red-500/60";

const SERVICE_LABEL_KEY: Record<ContactoServicio, string> = {
  camisetas: "formServiceCamisetas",
  publicitario: "formServicePublicitario",
  marketing: "formServiceMarketing",
  otro: "formServiceOtro",
};

export function ContactoForm() {
  const { t } = useLanguage();
  const c = t.contacto;
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [servicio, setServicio] = useState<ContactoServicio | "">("");
  const [mensaje, setMensaje] = useState("");
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<ContactoFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Preselección por ?servicio= (solo al montar: el usuario manda
  // después; no se re-aplica si cambia la query navegando).
  useEffect(() => {
    const pre = parseServicioParam(window.location.search);
    if (pre) setServicio(pre);
  }, []);

  const errText = (code: ContactoFormErrorCode): string =>
    code === "required" ? c.formErrRequired : code === "tooLong" ? c.formErrTooLong : c.formErrInvalidEmail;

  const resetForm = () => {
    setNombre("");
    setEmail("");
    setServicio("");
    setMensaje("");
    setWebsite("");
    setErrors({});
    setSubmitError(null);
    setSent(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const values = { nombre, email, servicio, mensaje, website };
    const validation = validateContactoForm(values);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      setSubmitError(c.formErrValidation);
      return;
    }
    setSubmitError(null);
    // Honeypot relleno → bot: éxito fingido, sin llamada al API y sin
    // revelar que existe el honeypot.
    if (isHoneypotFilled(website)) {
      setSent(true);
      return;
    }
    setBusy(true);
    try {
      await api.createContactoMensaje({
        nombre: nombre.trim(),
        email: email.trim(),
        servicio: servicio as ContactoServicio,
        mensaje: mensaje.trim(),
        website: website || undefined,
      });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setSubmitError(c.formErrValidation);
      } else if (err instanceof ApiError && err.status === 429) {
        const s = err.retryAfter ?? 60;
        setSubmitError(c.formErrTooMany.replace("{s}", String(s)));
      } else {
        setSubmitError(err instanceof ApiError && err.message ? err.message : c.formErrSend);
      }
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <section aria-label={c.formTitle} className="mt-8 rounded-xl border border-emerald-800/60 bg-emerald-500/10 p-5 sm:p-6">
        <div role="status">
          <h2 className="text-lg font-bold text-zinc-50">{c.formSuccessTitle}</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">{c.formSuccessBody}</p>
        </div>
        <button
          type="button"
          onClick={resetForm}
          className="mt-5 inline-flex min-h-[44px] items-center rounded-lg border border-zinc-700 px-5 py-3 text-sm font-bold text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
        >
          {c.formSendAnother}
        </button>
      </section>
    );
  }

  return (
    <section aria-label={c.formTitle} className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
      <h2 className="text-lg font-bold text-zinc-50">{c.formTitle}</h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{c.formIntro}</p>
      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <Field label={c.formNameLabel}>
          <input
            id="contacto-nombre"
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder={c.formNamePlaceholder}
            maxLength={CONTACTO_NOMBRE_MAX}
            autoComplete="name"
            aria-invalid={!!errors.nombre}
            aria-describedby={errors.nombre ? "contacto-nombre-error" : undefined}
            className={`${inputCls} ${errors.nombre ? inputErrCls : ""}`}
          />
          {errors.nombre && (
            <p id="contacto-nombre-error" role="alert" className="mt-1 text-sm text-red-400">
              {errText(errors.nombre)}
            </p>
          )}
        </Field>
        <Field label={c.formEmailLabel}>
          <input
            id="contacto-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={c.formEmailPlaceholder}
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "contacto-email-error" : undefined}
            className={`${inputCls} ${errors.email ? inputErrCls : ""}`}
          />
          {errors.email && (
            <p id="contacto-email-error" role="alert" className="mt-1 text-sm text-red-400">
              {errText(errors.email)}
            </p>
          )}
        </Field>
        <Field label={c.formServiceLabel}>
          <select
            id="contacto-servicio"
            value={servicio}
            onChange={(e) => setServicio(e.target.value as ContactoServicio | "")}
            aria-invalid={!!errors.servicio}
            aria-describedby={errors.servicio ? "contacto-servicio-error" : undefined}
            className={`${inputCls} ${errors.servicio ? inputErrCls : ""}`}
          >
            <option value="">{c.formServicePlaceholder}</option>
            {CONTACTO_SERVICIOS.map((s) => (
              <option key={s} value={s}>
                {c[SERVICE_LABEL_KEY[s]]}
              </option>
            ))}
          </select>
          {errors.servicio && (
            <p id="contacto-servicio-error" role="alert" className="mt-1 text-sm text-red-400">
              {errText(errors.servicio)}
            </p>
          )}
        </Field>
        <Field label={c.formMessageLabel}>
          <textarea
            id="contacto-mensaje"
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            placeholder={c.formMessagePlaceholder}
            rows={5}
            maxLength={CONTACTO_MENSAJE_MAX}
            aria-invalid={!!errors.mensaje}
            aria-describedby={errors.mensaje ? "contacto-mensaje-error" : undefined}
            className={`${inputCls} ${errors.mensaje ? inputErrCls : ""}`}
          />
          {errors.mensaje && (
            <p id="contacto-mensaje-error" role="alert" className="mt-1 text-sm text-red-400">
              {errText(errors.mensaje)}
            </p>
          )}
        </Field>
        {/* Honeypot anti-bots: fuera de la vista y del tabulador; los
            lectores de pantalla lo ignoran (aria-hidden). */}
        <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-0 overflow-hidden">
          <label htmlFor="contacto-website">
            Website
            <input
              id="contacto-website"
              name="website"
              type="text"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
            />
          </label>
        </div>
        {submitError && (
          <p role="alert" className="text-sm text-red-400">
            {submitError}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 sm:w-auto"
        >
          {busy ? c.formSending : c.formSubmit}
        </button>
      </form>
    </section>
  );
}
