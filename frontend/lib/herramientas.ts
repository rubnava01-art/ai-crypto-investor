// Catálogo de herramientas vendibles — TBT-Herramientas, FASE 2 (2026-11-24).
// Módulo PURO (sin React ni imports de componentes): lo consumen el
// componente <HerramientasSection /> y el test lib/herramientas.test.ts.
//
// CORTE DE LANZAMIENTO (A-4): SOLO las 26 herramientas con plan asignado
// por PLAN_FEATURE_KEYS (auditoría Agente 1, tabla §3). Las 11 «plan por
// confirmar» NO aparecen en v1; nunca Ajustador, Terminal, Control de
// usuarios, Privacidad, Perfil ni Chat.
// - featureKey: la función de PLAN_FEATURE_KEYS que cubre la herramienta;
//   el plan mínimo que la incluye se DERIVA por código en el componente
//   (mismo cálculo acumulativo que PlanesCompare), nunca se escribe a mano.
// - href: ruta real de la herramienta; con ancla (#...) cuando la
//   herramienta vive dentro de una página con secciones. Todas las rutas
//   existen como app/<ruta>/page.tsx y todas las anclas existen en su
//   página (lo verifica lib/herramientas.test.ts).
// - free: las 2 de acceso libre (calculadora y educación Bitcoin, 100 %
//   navegador): su CTA es «Pruébala sin cuenta» con ancla directa, sin
//   pasar por /login. Ojo: /estudiar vive tras ModuleShell, que redirige
//   a /login sin token y NO preserva el fragmento (#...): un visitante
//   sin sesión aterriza en /login y, tras entrar, en /estudiar (arriba).
//   Es la limitación conocida del gancho en v1; el ancla directa es lo
//   que decidió el plan conjunto (A-1/A-4).

export const HERRAMIENTA_CATEGORIES = ["invierte", "aprende", "crea", "gestiona"] as const;
export type HerramientaCategoria = (typeof HERRAMIENTA_CATEGORIES)[number];

export type HerramientaId =
  | "invertir"
  | "precios"
  | "academia"
  | "manuales"
  | "juego"
  | "videos"
  | "calculadora"
  | "conversor"
  | "grafica"
  | "indicadores"
  | "bitcoin"
  | "rentabilidad"
  | "copies"
  | "logo"
  | "mockup"
  | "tendencias"
  | "crm"
  | "facturas"
  | "inventario"
  | "correos"
  | "referidos"
  | "talento"
  | "riesgos"
  | "planillas"
  | "analisis"
  | "espacio";

export interface HerramientaDef {
  id: HerramientaId;
  categoria: HerramientaCategoria;
  /** Función de PLAN_FEATURE_KEYS que cubre la herramienta. */
  featureKey: string;
  /** Ruta (o ruta + ancla) real de la herramienta. */
  href: string;
  /** Acceso libre sin cuenta (gancho v1: solo calculadora y bitcoin). */
  free?: boolean;
}

export const HERRAMIENTAS: HerramientaDef[] = [
  // Invierte — Crecimiento (fInvertir).
  { id: "invertir", categoria: "invierte", featureKey: "fInvertir", href: "/" },
  { id: "precios", categoria: "invierte", featureKey: "fInvertir", href: "/" },
  // Aprende — Crecimiento (fEstudiar).
  { id: "academia", categoria: "aprende", featureKey: "fEstudiar", href: "/estudiar#estudiar-academia" },
  { id: "manuales", categoria: "aprende", featureKey: "fEstudiar", href: "/estudiar#estudiar-manuales" },
  { id: "juego", categoria: "aprende", featureKey: "fEstudiar", href: "/estudiar#estudiar-juego" },
  { id: "videos", categoria: "aprende", featureKey: "fEstudiar", href: "/estudiar#estudiar-videos" },
  { id: "calculadora", categoria: "aprende", featureKey: "fEstudiar", href: "/estudiar#herramienta-calculadora", free: true },
  { id: "conversor", categoria: "aprende", featureKey: "fEstudiar", href: "/estudiar#herramienta-conversor" },
  { id: "grafica", categoria: "aprende", featureKey: "fEstudiar", href: "/estudiar#herramienta-grafica" },
  { id: "indicadores", categoria: "aprende", featureKey: "fEstudiar", href: "/estudiar#herramienta-indicadores" },
  { id: "bitcoin", categoria: "aprende", featureKey: "fEstudiar", href: "/estudiar#herramienta-bitcoin", free: true },
  // Calculadora de rentabilidad (2026-11-25, plan servicios-calc D-2):
  // con cuenta en v1 (free: false) — el camino libre por ancla directa
  // pierde el fragmento tras el login (limitación H-08); el CTA «Probar»
  // va a /login?next=/estudiar%23herramienta-rentabilidad y aterriza
  // en la herramienta gracias al ?next= enhebrado.
  { id: "rentabilidad", categoria: "aprende", featureKey: "fEstudiar", href: "/estudiar#herramienta-rentabilidad", free: false },
  // Crea — Crecimiento (fCrear).
  { id: "copies", categoria: "crea", featureKey: "fCrear", href: "/crear#crear-copies" },
  { id: "logo", categoria: "crea", featureKey: "fCrear", href: "/crear" },
  { id: "mockup", categoria: "crea", featureKey: "fCrear", href: "/crear" },
  { id: "tendencias", categoria: "crea", featureKey: "fCrear", href: "/crear#crear-tendencias" },
  // Gestiona — Esencial (fCrm, fFacturas, fInventario, fCorreos).
  { id: "crm", categoria: "gestiona", featureKey: "fCrm", href: "/crm" },
  { id: "facturas", categoria: "gestiona", featureKey: "fFacturas", href: "/facturas" },
  { id: "inventario", categoria: "gestiona", featureKey: "fInventario", href: "/inventario" },
  { id: "correos", categoria: "gestiona", featureKey: "fCorreos", href: "/correos" },
  // Gestiona — Negocio Total (fReferidos, fTalento, fRiesgos, fPlanillas, fAnalisis).
  { id: "referidos", categoria: "gestiona", featureKey: "fReferidos", href: "/referidos" },
  { id: "talento", categoria: "gestiona", featureKey: "fTalento", href: "/talento" },
  { id: "riesgos", categoria: "gestiona", featureKey: "fRiesgos", href: "/riesgos" },
  { id: "planillas", categoria: "gestiona", featureKey: "fPlanillas", href: "/planillas" },
  { id: "analisis", categoria: "gestiona", featureKey: "fAnalisis", href: "/analisis" },
  // Gestiona — Crecimiento (fEspacio): en Gestiona por descarte (auditoría §3).
  { id: "espacio", categoria: "gestiona", featureKey: "fEspacio", href: "/espacio" },
];

/** Evento para abrir el Asistente flotante desde la sección (lo escucha
 * AsistenteChat; el chat ya existe en el layout raíz, no se crea otro). */
export const OPEN_ASISTENTE_EVENT = "growbusiness:open-asistente";
