// Formulario de contacto público + banda de Servicios (2026-11-25, plan
// servicios-calc). Lógica pura y testeable, sin React ni red:
// - Servicios que acepta POST /api/contacto/mensajes (contrato backend).
// - Preselección por ?servicio= (el componente la lee con
//   window.location.search para evitar el Suspense de useSearchParams).
// - Validación en cliente con los mismos límites del contrato
//   (nombre 1-100, email válido, mensaje 1-2000); los errores salen
//   como CÓDIGOS y el componente los mapea a cadenas i18n
//   (contacto.formErr*), así la lógica no depende del idioma.
// - Honeypot `website`: si viene relleno es un bot — el componente
//   finge éxito sin llamar al API (nunca se revela el honeypot).
import type { ContactoServicio } from "./api/types";

export type { ContactoServicio } from "./api/types";

/** Servicios en el orden de la banda (HerramientasSection). */
export const CONTACTO_SERVICIOS: ContactoServicio[] = ["camisetas", "publicitario", "marketing", "otro"];

const SERVICIO_SET = new Set<string>(CONTACTO_SERVICIOS);

/** Href de cada CTA «Pide tu cotización» de la banda de Servicios:
 * /contacto con el servicio preseleccionado. Fuente única — la banda
 * y los tests leen de aquí, no de literales sueltos. */
export const SERVICIO_CONTACTO_HREF: Record<ContactoServicio, string> = {
  camisetas: "/contacto?servicio=camisetas",
  publicitario: "/contacto?servicio=publicitario",
  marketing: "/contacto?servicio=marketing",
  otro: "/contacto?servicio=otro",
};

/** Servicios con CTA propio en la banda (sin «otro»: solo se llega a
 * él desde el select del formulario). */
export const SERVICIOS_BANDA: ContactoServicio[] = ["camisetas", "publicitario", "marketing"];

/** ?servicio= válido → servicio; ausente, inválido o repetido → null
 * (el formulario cae al placeholder «Elige un servicio»). Case
 * sensitive: el contrato solo acepta minúsculas. */
export function parseServicioParam(search: string | null | undefined): ContactoServicio | null {
  if (!search) return null;
  let value: string | null = null;
  try {
    value = new URLSearchParams(search).get("servicio");
  } catch {
    return null;
  }
  if (value !== null && SERVICIO_SET.has(value)) return value as ContactoServicio;
  return null;
}

export interface ContactoFormValues {
  nombre: string;
  email: string;
  servicio: ContactoServicio | "";
  mensaje: string;
  /** Honeypot anti-bots (campo oculto `website`). */
  website: string;
}

/** Códigos de error por campo (el componente los traduce con
 * contacto.formErr*). */
export type ContactoFormErrorCode = "required" | "tooLong" | "invalidEmail";
export type ContactoFormErrors = Partial<
  Record<"nombre" | "email" | "servicio" | "mensaje", ContactoFormErrorCode>
>;

export const CONTACTO_NOMBRE_MAX = 100;
export const CONTACTO_MENSAJE_MAX = 2000;
/** Email: formato + tope práctico 254 (RFC 5321); el contrato solo
 * exige «email válido». */
export const CONTACTO_EMAIL_MAX = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validación en cliente, mismos límites que el contrato del backend.
 * No valida el honeypot: un bot no recibe errores de campo, solo el
 * éxito fingido. */
export function validateContactoForm(values: ContactoFormValues): ContactoFormErrors {
  const errors: ContactoFormErrors = {};
  const nombre = values.nombre.trim();
  if (!nombre) errors.nombre = "required";
  else if (nombre.length > CONTACTO_NOMBRE_MAX) errors.nombre = "tooLong";
  const email = values.email.trim();
  if (!email) errors.email = "required";
  else if (email.length > CONTACTO_EMAIL_MAX || !EMAIL_RE.test(email)) errors.email = "invalidEmail";
  if (!values.servicio) errors.servicio = "required";
  const mensaje = values.mensaje.trim();
  if (!mensaje) errors.mensaje = "required";
  else if (mensaje.length > CONTACTO_MENSAJE_MAX) errors.mensaje = "tooLong";
  return errors;
}

/** Honeypot rellenado → bot: no se envía nada al API. */
export function isHoneypotFilled(website: string): boolean {
  return website.trim() !== "";
}
