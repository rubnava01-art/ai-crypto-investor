// Tipos del diccionario (extraídos de lib/i18n.tsx en Fase 4, sin cambios
// en las cadenas existentes). Las secciones son Record<string,string> salvo
// header/nav/common, como antes; `reliability` agrupa las cadenas nuevas
// de fiabilidad (Fase 4: errores mapeados, cargar más, confirmaciones).

export type Lang = "es" | "en";

export type NavKey =
  | "inicio"
  | "invertir"
  | "estudiar"
  | "crear"
  | "analizador"
  | "crm"
  | "referidos"
  | "business"
  | "espacio"
  | "facturas"
  | "correos"
  | "chat"
  | "recomendaciones"
  | "desarrollo"
  | "talento"
  | "riesgos"
  | "planillas"
  | "analisis"
  | "tendencias"
  | "auditor"
  | "privacidad"
  | "inventario"
  | "perfil"
  | "usuarios"
  | "ajustador"
  | "terminal"
  | "flujos"
  | "planes";

export type Dictionary = {
  header: {
    brand: string;
    tagline: string;
    navAria: string;
    language: string;
  };
  /** Entradas del menú + cadena neutra mientras /me resuelve (corrección
   * QA 2026-11-10 nº 1): `checkingRole` no es una entrada de módulo, por
   * eso va como campo aparte del Record de NavKey. */
  nav: Record<NavKey, { label: string; hint: string }> & { checkingRole: string };
  /** Etiquetas de las familias de navegación agrupada (Fase 5, F1). */
  navGroups: Record<string, string>;
  common: {
    loading: string;
    save: string;
    cancel: string;
    close: string;
    edit: string;
    delete: string;
    create: string;
    back: string;
    logout: string;
    refresh: string;
    refreshing: string;
  };
  // Slots de traducción total (2026-10-30): cada grupo de trabajo rellena
  // SOLO su marcador con `nombre: Record<string, string>;` por namespace.
  login: Record<string, string>;
  perfil: Record<string, string>;
  shell: Record<string, string>;
  footer: Record<string, string>;
  misc: Record<string, string>;
  dashboard: Record<string, string>;
  invertir: Record<string, string>;
  market: Record<string, string>;
  ai: Record<string, string>;
  crm: Record<string, string>;
  referidos: Record<string, string>;
  business: Record<string, string>;
  facturas: Record<string, string>;
  correos: Record<string, string>;
  usuarios: Record<string, string>;
  crear: Record<string, string>;
  logo: Record<string, string>;
  mockup: Record<string, string>;
  academy: Record<string, string>;
  clases: Record<string, string>;
  analizador: Record<string, string>;
  social: Record<string, string>;
  tendencias: Record<string, string>;
  auditor: Record<string, string>;
  desarrollo: Record<string, string>;
  recomendaciones: Record<string, string>;
  chat: Record<string, string>;
  espacio: Record<string, string>;
  ambient: Record<string, string>;
  inicio: Record<string, string>;
  inventario: Record<string, string>;
  privacidad: Record<string, string>;
  // Secciones nuevas (frontend empresa/análisis): mismo patrón Record.
  talento: Record<string, string>;
  riesgos: Record<string, string>;
  planillas: Record<string, string>;
  analisis: Record<string, string>;
  // Manuales de Estudiar: mismo patrón Record.
  manuales: Record<string, string>;
  juego: Record<string, string>;
  // Ajustador (tablero de mejora) y videos educativos: mismo patrón.
  ajustador: Record<string, string>;
  videos: Record<string, string>;
  // Flujos (constructor visual de automatizaciones, solo localStorage).
  flujos: Record<string, string>;
  // Planes (precios de suscripción, aprobados por Rubén 2026-11-06).
  planes: Record<string, string>;
  // Landing pública, menú público y página de contacto (2026-11-12).
  landing: Record<string, string>;
  publicNav: Record<string, string>;
  contacto: Record<string, string>;
  // Gestos de Estudiar (swipe entre secciones y manuales): mismo patrón.
  estudiarGestos: Record<string, string>;
  reliability: Record<string, string>;
  // Terminal (consola simulada, solo admin): mismo patrón.
  terminal: Record<string, string>;
};
