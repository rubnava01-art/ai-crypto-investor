// Barril del cliente API (Fase 4): los métodos viven divididos por dominio en
// lib/api/*.ts y se re-exportan aquí como un único objeto `api`, sin cambios
// en los call sites. Los tipos viven en lib/api/types.ts y el fetch central
// (timeout, token, 401, reintentos) en lib/api/client.ts.
export * from "./api/types";
export * from "./api/client";
export * from "./api/market";
export { guestApi, GUEST_MODULES } from "./api/guest";
export type { GuestTokenResponse } from "./api/guest";
import { systemApi } from "./api/system";
import { usersApi } from "./api/users";
import { crmApi } from "./api/crm";
import { academyApi } from "./api/academy";
import { crearApi } from "./api/crear";
import { espacioApi } from "./api/espacio";
import { facturasApi } from "./api/facturas";
import { marketApi } from "./api/market";
import { clasesApi } from "./api/clases";
import { correosApi } from "./api/correos";
import { contactoApi } from "./api/contacto";
import { referidosApi } from "./api/referidos";
import { businessApi } from "./api/business";
import { perfilApi } from "./api/perfil";
import { misDatosApi } from "./api/mis_datos";
import { suscripcionesApi } from "./api/suscripciones";
import { chatApi } from "./api/chat";
import { recomendacionesApi } from "./api/recomendaciones";
import { inicioApi } from "./api/inicio";
import { inventarioApi } from "./api/inventario";
import { desarrolloApi } from "./api/desarrollo";
import { tendenciasApi } from "./api/tendencias";
import { auditorApi } from "./api/auditor";
import { analizadorApi } from "./api/analizador";
import { privacidadApi } from "./api/privacidad";
import { marketingApi } from "./api/marketing";
import { portalApi } from "./api/portal";
import { contenidoApi } from "./api/contenido";
import { biApi } from "./api/bi";
import { accesoApi } from "./api/acceso";
import { guestApi } from "./api/guest";
import { hoyApi } from "./api/hoy";

export const api = {
  ...systemApi,
  ...marketApi,
  ...usersApi,
  ...crmApi,
  ...academyApi,
  ...crearApi,
  ...espacioApi,
  ...facturasApi,
  ...clasesApi,
  ...correosApi,
  ...contactoApi,
  ...referidosApi,
  ...businessApi,
  ...perfilApi,
  ...misDatosApi,
  ...suscripcionesApi,
  ...chatApi,
  ...recomendacionesApi,
  ...inicioApi,
  ...inventarioApi,
  ...desarrolloApi,
  ...tendenciasApi,
  ...auditorApi,
  ...analizadorApi,
  ...privacidadApi,
  ...marketingApi,
  ...portalApi,
  ...contenidoApi,
  ...biApi,
  ...accesoApi,
  ...guestApi,
  ...hoyApi,
};
