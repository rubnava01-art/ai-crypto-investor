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
  | "tendencias"
  | "auditor"
  | "privacidad"
  | "inventario"
  | "perfil"
  | "usuarios";

export type Dictionary = {
  header: {
    brand: string;
    navAria: string;
    language: string;
  };
  nav: Record<NavKey, { label: string; hint: string }>;
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
  reliability: Record<string, string>;
};
