"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { isGuest } from "../lib/api/client";
import { GUEST_MODULES } from "../lib/api/guest";
import { useLanguage, type NavKey } from "../lib/i18n";

/** Small professional stroke icons (currentColor, 16px) — no emoji, no images. */
function Icon({ d, children }: { d?: string; children?: React.ReactNode }) {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}

export const MODULES = [
  {
    href: "/inicio",
    label: "Inicio",
    hint: "Noticias y comentarios",
    icon: <Icon d="M3 12l9-9 9 9M5 10v10h14V10M9 20v-6h6v6" />,
  },
  {
    href: "/",
    label: "Invertir",
    hint: "Trading y mercados",
    icon: <Icon d="M3 17l6-6 4 4 8-8" />,
  },
  {
    href: "/estudiar",
    label: "Estudiar",
    hint: "Academia",
    icon: <Icon d="M2 5h6a4 4 0 0 1 4 4v15H6a4 4 0 0 1-4-4V5zM22 5h-6a4 4 0 0 0-4 4v15h6a4 4 0 0 0 4-4V5z" />,
  },
  {
    href: "/crear",
    label: "Crear",
    hint: "Forge · copies · tendencias",
    icon: <Icon d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />,
  },
  {
    href: "/analizador",
    label: "Analizador IA",
    hint: "¿Contenido creado con IA?",
    icon: <Icon d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />,
  },
  {
    href: "/crm",
    label: "Gestor de Clientes",
    hint: "Contactos y clientes",
    icon: (
      <Icon>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </Icon>
    ),
  },
  {
    href: "/referidos",
    label: "Referidos",
    hint: "Campañas con recompensas",
    icon: (
      <Icon>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4" />
      </Icon>
    ),
  },
  {
    href: "/business",
    label: "Business",
    hint: "Marketing · Ventas · Legal · Admin",
    icon: <Icon d="M20 7H4a2 2 0 0 1 0-4h16a2 2 0 0 1 0 4zM4 7v13h16V7M9 7v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />,
  },
  {
    href: "/espacio",
    label: "Espacio",
    hint: "Meditación · revelaciones",
    icon: <Icon d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />,
  },
  {
    href: "/facturas",
    label: "Facturas",
    hint: "Facturas · materiales",
    icon: <Icon d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2H4zM8 7h8M8 11h8" />,
  },
  {
    href: "/correos",
    label: "Correos",
    hint: "Plantillas · CRM · registro",
    icon: <Icon d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6" />,
  },
  {
    href: "/chat",
    label: "Chat",
    hint: "Chat en vivo",
    icon: <Icon d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 21l2-5.6A8.5 8.5 0 1 1 21 11.5z" />,
  },
  {
    href: "/recomendaciones",
    label: "Recomendaciones",
    hint: "Cursos y herramientas",
    icon: <Icon d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2z" />,
  },
  {
    href: "/desarrollo",
    label: "Desarrollo digital",
    hint: "Adaptación digital para empresas",
    icon: <Icon d="M5 21V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v17M9 21v-4h6v4M9 10h.01M15 10h.01M12 7v0" />,
  },
  {
    href: "/talento",
    label: "Talento humano",
    hint: "Equipo · roles · personas",
    icon: (
      <Icon>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </Icon>
    ),
  },
  {
    href: "/riesgos",
    label: "Gestión de Riesgos",
    hint: "Riesgos · controles · planes",
    icon: (
      <Icon>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M12 8v4M12 16h.01" />
      </Icon>
    ),
  },
  {
    href: "/planillas",
    label: "Planillas",
    hint: "Pagos y registros del equipo",
    icon: (
      <Icon>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M9 13h6M9 17h4" />
      </Icon>
    ),
  },
  {
    href: "/analisis",
    label: "Análisis de datos",
    hint: "Datos · reportes · decisiones",
    icon: <Icon d="M3 3v18h18M7 15v-4M12 15V7M17 15v-7" />,
  },
  {
    href: "/tendencias",
    label: "Tendencias",
    hint: "Palabras · campañas · anuncios",
    icon: <Icon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" />,
  },
  {
    href: "/auditor",
    label: "Auditor web",
    hint: "Velocidad · SEO de una página",
    icon: (
      <Icon>
        <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
        <path d="M12 12l4-4" />
      </Icon>
    ),
  },
  {
    href: "/privacidad",
    label: "Privacidad",
    hint: "Políticas · datos · cumplimiento",
    icon: <Icon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  },
  {
    href: "/inventario",
    label: "Inventario",
    hint: "Control de stock",
    icon: <Icon d="M20 7H4a2 2 0 0 1 0-4h16a2 2 0 0 1 0 4zM4 7v13h16V7M9 7v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M9 13h6M9 17h4" />,
  },
  {
    href: "/perfil",
    label: "Mi perfil",
    hint: "Foto y datos del usuario",
    icon: (
      <Icon>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a8 8 0 0 1 16 0v1" />
      </Icon>
    ),
  },
  {
    href: "/usuarios",
    label: "Control de usuarios",
    hint: "Aprobar cuentas · roles · claves",
    adminOnly: true,
    icon: (
      <Icon>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6M22 11h-6" />
      </Icon>
    ),
  },
  {
    href: "/ajustador",
    label: "Ajustador",
    hint: "Mejora continua · agentes",
    adminOnly: true,
    icon: (
      <Icon>
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </Icon>
    ),
  },
  {
    href: "/terminal",
    label: "Terminal",
    hint: "Consola de pruebas",
    adminOnly: true,
    icon: (
      <Icon>
        <path d="M4 17l6-6-6-6" />
        <path d="M12 19h8" />
      </Icon>
    ),
  },
  {
    href: "/flujos",
    label: "Flujos",
    hint: "Automatizaciones",
    icon: (
      <Icon>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="12" cy="18" r="2.5" />
        <path d="M8.2 7.2l2.4 8.4M15.8 7.2l-2.4 8.4M8.5 6h7" />
      </Icon>
    ),
  },
  {
    href: "/planes",
    label: "Planes",
    hint: "Precios y prueba gratis",
    icon: (
      <Icon>
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <circle cx="7" cy="7" r="1.5" />
      </Icon>
    ),
  },
  {
    // Ruta propia 2026-11-23: antes el portal solo vivía dentro de
    // /business y el cliente vinculado no tenía "business" en sus
    // módulos, así que no podía llegar a su portal desde el menú.
    href: "/portal",
    label: "Portal cliente",
    hint: "Tus facturas · citas · contenido",
    icon: (
      <Icon>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8.5" cy="11" r="2" />
        <path d="M14 9.5h4M14 13.5h4M5.5 16.5h5" />
      </Icon>
    ),
  },
];

// Clave del diccionario ES/EN por ruta (lib/i18n): la etiqueta y la
// descripción visibles salen de ahí, no de los textos fijos de MODULES
// (que quedan como respaldo si una ruta no tiene entrada).
export const KEY_BY_HREF: Record<string, NavKey> = {
  "/inicio": "inicio",
  "/": "invertir",
  "/estudiar": "estudiar",
  "/crear": "crear",
  "/analizador": "analizador",
  "/crm": "crm",
  "/referidos": "referidos",
  "/business": "business",
  "/espacio": "espacio",
  "/facturas": "facturas",
  "/correos": "correos",
  "/chat": "chat",
  "/recomendaciones": "recomendaciones",
  "/desarrollo": "desarrollo",
  "/talento": "talento",
  "/riesgos": "riesgos",
  "/planillas": "planillas",
  "/analisis": "analisis",
  "/tendencias": "tendencias",
  "/auditor": "auditor",
  "/privacidad": "privacidad",
  "/inventario": "inventario",
  "/perfil": "perfil",
  "/usuarios": "usuarios",
  "/ajustador": "ajustador",
  "/terminal": "terminal",
  "/flujos": "flujos",
  "/planes": "planes",
  "/portal": "portal",
};

/** Conjunto mínimo de prueba (fail-closed, 2026-11-23): si el perfil
 * falla, estos son los únicos módulos visibles — aprendizaje y perfil,
 * sin Invertir operativo ni módulos de negocio/admin. Es el mismo
 * conjunto que MODULOS_PRUEBA del backend (perfiles.py) menos
 * "asistente" y "portal", que no son entradas de este menú. Claves
 * NavKey, las mismas que devuelve GET /api/acceso/perfil. */
export const PRUEBA_MIN_KEYS: readonly string[] = [
  "inicio",
  "estudiar",
  "crear",
  "perfil",
  "planes",
];

/** Rutas con presentación propia en la landing (no se listan entre los
 * "módulos extra"): la propia portada (/inicio), Invertir (raíz),
 * Estudiar y Crear (los 4 pilares). */
export const LANDING_PRESENTATION_HREFS: readonly string[] = ["/inicio", "/", "/estudiar", "/crear"];

/** Claves de módulo para la landing (M8, 2026-11-13): se derivan de
 * MODULES, así el "24 módulos" de la franja de confianza no se
 * desincroniza si el menú añade o quita una ruta. Los 3 módulos
 * solo-admin van marcados para que la landing no prometa a un visitante
 * de prueba módulos que no verá en su menú. */
export function landingModuleKeys(): { key: NavKey; adminOnly: boolean }[] {
  return MODULES.filter((m) => !LANDING_PRESENTATION_HREFS.includes(m.href)).map((m) => ({
    key: KEY_BY_HREF[m.href],
    adminOnly: "adminOnly" in m && (m as { adminOnly?: boolean }).adminOnly === true,
  }));
}

/** Familias de navegación (Fase 5, F1): las 29 rutas, sin borrar ni
 * renombrar ninguna. Se sigue la propuesta de la auditoría; dos rutas
 * que la propuesta no nombraba se ubican por afinidad y se reportan:
 * Recomendaciones (cursos y herramientas) en Estudiar, Desarrollo
 * digital (adaptación para empresas) en Negocio. Inicio (2026-11-06)
 * ya no está dentro de Invertir: es un botón independiente siempre
 * visible encima de los grupos y conserva el acento Invertir por
 * afinidad (familyForHref cae en «invertir» si no hay grupo). Las 4
 * rutas nuevas de Negocio
 * (Talento humano, Gestión de Riesgos, Planillas, Análisis de datos)
 * enlazan a páginas que crea el agente Frontend; hasta entonces el
 * enlace existe en el menú pero la página aún no está servida. Las 3
 * guías de /estudiar/manual-* pertenecen a la familia Estudiar SIN
 * entrada propia en el menú: el grupo las reconoce para el acento y la
 * familia abierta en móvil, y el menú las filtra porque no están en
 * MODULES. */
const GROUPS: { key: string; hrefs: string[] }[] = [
  { key: "invertir", hrefs: ["/"] },
  { key: "estudiar", hrefs: ["/estudiar", "/estudiar/manual-plataforma", "/estudiar/manual-invertir", "/estudiar/manual-negocio", "/estudiar/juego", "/recomendaciones"] },
  { key: "crear", hrefs: ["/crear", "/tendencias", "/analizador"] },
  { key: "negocio", hrefs: ["/crm", "/referidos", "/business", "/facturas", "/correos", "/inventario", "/desarrollo", "/talento", "/riesgos", "/planillas", "/analisis", "/planes", "/portal"] },
  { key: "personal", hrefs: ["/espacio", "/perfil"] },
  { key: "sistema", hrefs: ["/chat", "/auditor", "/privacidad", "/usuarios", "/ajustador", "/terminal", "/flujos"] },
];

/** Acentos por familia (F13, decisión de Rubén 2026-11-02): UN acento por
 * familia, codificado AQUÍ y en ningún otro sitio. El acento de marca
 * (emerald) es la familia Invertir; el rojo queda reservado a
 * peligro/riesgo y no es acento de familia. Los colores de rol (p. ej.
 * super-admin violet) son otro sistema y no se tocan aquí. Las clases
 * van literales: Tailwind no genera clases interpoladas. Los acentos
 * decorativos dentro de paneles (p. ej. teal en Espacio, cyan en
 * Correos) quedan como decoración interna, no como identidad de
 * familia; si Rubén quiere alinearlos, es un pase aparte. */
export const FAMILY_ACCENT: Record<
  string,
  { active: string; hint: string; dot: string; ring: string }
> = {
  invertir: {
    active: "bg-emerald-700 text-white ring-emerald-500/50",
    hint: "text-emerald-100/90",
    dot: "bg-emerald-500",
    ring: "focus-visible:ring-emerald-500/60",
  },
  estudiar: {
    active: "bg-sky-700 text-white ring-sky-500/50",
    hint: "text-sky-100/90",
    dot: "bg-sky-500",
    ring: "focus-visible:ring-sky-500/60",
  },
  crear: {
    active: "bg-violet-600 text-white ring-violet-500/50",
    hint: "text-violet-100/90",
    dot: "bg-violet-500",
    ring: "focus-visible:ring-violet-500/60",
  },
  negocio: {
    active: "bg-amber-700 text-white ring-amber-500/50",
    hint: "text-amber-100/90",
    dot: "bg-amber-500",
    ring: "focus-visible:ring-amber-500/60",
  },
  personal: {
    active: "bg-teal-700 text-white ring-teal-500/50",
    hint: "text-teal-100/90",
    dot: "bg-teal-500",
    ring: "focus-visible:ring-teal-500/60",
  },
  sistema: {
    active: "bg-zinc-600 text-white ring-zinc-500/50",
    hint: "text-zinc-100/90",
    dot: "bg-zinc-400",
    ring: "focus-visible:ring-zinc-500/60",
  },
};

/** Familia de una ruta (o "invertir" si no está en ningún grupo). */
export function familyForHref(href: string): string {
  const g = GROUPS.find((gr) => gr.hrefs.includes(href));
  return g ? g.key : "invertir";
}

/** Categorías de presentación (Fase 4, 2026-11-23): las 6 familias se
 * presentan bajo 4 categorías, SIN cambiar rutas ni claves de módulos:
 * Simulación de Inversión (invertir), Academia (estudiar), Contenido
 * (crear), Gestión (negocio + personal) y Sistema aparte. */
export const CATEGORIES: { key: string; groups: string[] }[] = [
  { key: "sim", groups: ["invertir"] },
  { key: "academia", groups: ["estudiar"] },
  { key: "contenido", groups: ["crear"] },
  { key: "gestion", groups: ["negocio", "personal"] },
  { key: "sistema", groups: ["sistema"] },
];

/** Clave i18n (t.landing) del título de cada categoría. */
export const CATEGORY_TITLE_KEY: Record<string, string> = {
  sim: "catSimTitle",
  academia: "catAcademyTitle",
  contenido: "catContentTitle",
  gestion: "catManageTitle",
  sistema: "catSystemTitle",
};

export function categoryForHref(href: string): string {
  const family = familyForHref(href);
  const cat = CATEGORIES.find((c) => c.groups.includes(family));
  return cat ? cat.key : "sim";
}

const HREF_BY_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(KEY_BY_HREF).map(([href, key]) => [key, href]),
);

/** Módulos de la landing agrupados por categoría (M8 + Fase 4). */
export function landingModulesByCategory(): {
  category: string;
  items: { key: NavKey; adminOnly: boolean }[];
}[] {
  const all = landingModuleKeys();
  return CATEGORIES.map((c) => ({
    category: c.key,
    items: all.filter((m) => categoryForHref(HREF_BY_KEY[m.key] ?? "") === c.key),
  })).filter((g) => g.items.length > 0);
}

export function ModuleNav() {
  const pathname = usePathname();
  const { t } = useLanguage();
  // Rol por perfil (corrida 2026-11-23, chat potente + perfiles):
  // GET /api/acceso/perfil devuelve el rol y los módulos que le tocan
  // a esta cuenta (claves = NavKey). Fail-closed: mientras resuelve no
  // se muestra ningún módulo; si /me o el perfil falla, solo el
  // conjunto mínimo de prueba. El backend refuerza cada endpoint: el
  // menú solo deja de prometer lo que no le toca.
  const [role, setRole] = useState<"loading" | "admin" | "prueba" | "cliente" | "invitado">("loading");
  const [modulos, setModulos] = useState<Set<string> | null>(null);
  const isAdmin = role === "admin";
  const isCliente = role === "cliente";
  // Móvil: todo el menú vive detrás de un único botón "Menú" (2026-11-17):
  // antes las 6 familias + Inicio ocupaban ~400 px antes del contenido.
  const [menuOpen, setMenuOpen] = useState(false);
  // Cerrar el menú móvil al navegar: el contenido del módulo destino es
  // lo primero que se ve, sin hacer scroll.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  // Móvil: solo la categoría de la ruta actual empieza abierta.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    CATEGORIES.forEach((c) => {
      o[c.key] = c.groups.some((gk) => GROUPS.find((g) => g.key === gk)?.hrefs.includes(pathname));
    });
    return o;
  });
  // Sincronizar las categorías colapsables con la ruta: al navegar, abrir
  // la categoría destino sin cerrar las que el usuario abrió a mano.
  useEffect(() => {
    setOpen((prev) => {
      const next = { ...prev };
      CATEGORIES.forEach((c) => {
        if (c.groups.some((gk) => GROUPS.find((g) => g.key === gk)?.hrefs.includes(pathname))) next[c.key] = true;
      });
      return next;
    });
  }, [pathname]);
  // Buscador de módulos (Fase 4, 2026-11-23, solo escritorio): filtra por
  // etiqueta/hint, sin reordenar. La búsqueda ignora acentos y mayúsculas.
  const [query, setQuery] = useState("");
  const norm = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const matchesQuery = useCallback(
    (m: (typeof MODULES)[number]) => {
      const q = norm(query.trim());
      if (!q) return true;
      const navText = t.nav[KEY_BY_HREF[m.href]];
      const label = navText?.label ?? m.label;
      const hint = navText?.hint ?? m.hint;
      return norm(`${label} ${hint}`).includes(q);
    },
    [query, t],
  );
  useEffect(() => {
    let cancelled = false;
    api
      .getPerfil()
      .then((p) => {
        if (cancelled) return;
        // Invitado (Fase 1): el backend devuelve role "invitado" con su
        // conjunto fijo (inicio, estudiar, planes, asistente).
        setRole(p.role === "super_admin" || p.role === "admin" ? "admin" : p.role);
        setModulos(new Set(p.modulos));
      })
      .catch(() => {
        if (cancelled) return;
        // Perfil sin implementar o sin respuesta: conjunto mínimo de
        // prueba, nunca todo el menú (fail-closed). Con sesión de
        // invitado, el conjunto fijo del contrato, no el de prueba.
        if (isGuest()) {
          setRole("invitado");
          setModulos(new Set(GUEST_MODULES));
          return;
        }
        setRole("prueba");
        setModulos(new Set(PRUEBA_MIN_KEYS));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Solo los módulos de `modulos`: lo que no le toca a un perfil no
  // aparece ni como enlace. El filtro adminOnly queda como segunda
  // capa (el perfil ya no debería traerlos para no-admin).
  const visible = useMemo(() => {
    if (!modulos) return [];
    return MODULES.filter((m) => {
      if (!modulos.has(KEY_BY_HREF[m.href])) return false;
      if ("adminOnly" in m && m.adminOnly && !isAdmin) return false;
      return true;
    });
  }, [modulos, isAdmin]);
  const byHref = useMemo(() => new Map(visible.map((m) => [m.href, m])), [visible]);
  // Inicio es un botón independiente, no parte de ninguna familia.
  const inicio = byHref.get("/inicio");
  // Módulo actual para el botón "Menú" en móvil: etiqueta + punto de su
  // familia; si la ruta no está en el menú (p. ej. un manual), la familia.
  const currentModule = byHref.get(pathname);
  const currentAccent = FAMILY_ACCENT[familyForHref(pathname)] ?? FAMILY_ACCENT.invertir;
  const currentLabel = currentModule
    ? (t.nav[KEY_BY_HREF[currentModule.href]]?.label ?? currentModule.label)
    : (t.navGroups[familyForHref(pathname)] ?? familyForHref(pathname));

  const link = useCallback(
    (m: (typeof MODULES)[number]) => {
      const navText = t.nav[KEY_BY_HREF[m.href]];
      const label = navText?.label ?? m.label;
      const hint = navText?.hint ?? m.hint;
      const active = pathname === m.href;
      const accent = FAMILY_ACCENT[familyForHref(m.href)] ?? FAMILY_ACCENT.invertir;
      return (
        <Link
          key={m.href}
          href={m.href}
          aria-current={active ? "page" : undefined}
          // H-13: el hint se oculta en móvil (hidden sm:inline), así que
          // va también como title (toque prolongado) y aria-label
          // (lector de pantalla) con "etiqueta — descripción".
          title={`${label} — ${hint}`}
          aria-label={`${label} — ${hint}`}
          className={
            active
              ? `flex min-h-[2.75rem] items-center gap-2 whitespace-nowrap rounded-lg ${accent.active} px-4 py-2.5 text-sm font-semibold shadow-sm ring-1 ring-inset transition-colors`
              : "flex min-h-[2.75rem] items-center gap-2 whitespace-nowrap rounded-lg border border-slate-700/70 bg-slate-900/50 px-4 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800/80 hover:text-slate-100"
          }
        >
          {m.icon}
          {label}
          <span className={`hidden text-xs font-normal sm:inline ${active ? accent.hint : "text-slate-400"}`}>
            {hint}
          </span>
        </Link>
      );
    },
    [pathname, t],
  );

  return (
    <nav aria-label={t.header.navAria}>
      {/* Aviso por perfil (2026-11-23): prueba ve el aviso de demo y
          cliente vinculado, el de su portal. Admin/super no ven aviso.
          El aviso de prueba vivía solo en el dashboard (/); ahora lo
          lleva el menú y se ve en todos los módulos. */}
      {role === "invitado" && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-emerald-700/60 bg-emerald-500/10 px-4 py-3 text-sm leading-relaxed text-emerald-300"
        >
          {t.guest.banner}{" "}
          <Link href="/login?mode=register" className="font-semibold text-emerald-200 underline">
            {t.guest.bannerCta}
          </Link>
        </div>
      )}
      {role === "prueba" && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-sky-700/60 bg-sky-500/10 px-4 py-3 text-sm leading-relaxed text-sky-300"
        >
          <strong className="font-semibold">{t.dashboard.testModeTitle}</strong>{" "}
          {t.dashboard.testModeBody}
        </div>
      )}
      {isCliente && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-emerald-700/60 bg-emerald-500/10 px-4 py-3 text-sm leading-relaxed text-emerald-300"
        >
          <strong className="font-semibold">{t.dashboard.clientModeTitle}</strong>{" "}
          {t.dashboard.clientModeBody}
        </div>
      )}
      {/* Móvil: un solo botón "Menú" con el módulo actual; el resto del
          menú (Inicio + familias) solo se despliega al tocarlo. */}
      <div className="sm:hidden">
        <button
          type="button"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-slate-700/80 bg-slate-900/60 px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-sm backdrop-blur transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${currentAccent.dot}`} />
            {t.nav.menu}
            <span className="truncate font-normal text-slate-400">· {currentLabel}</span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-slate-400">{menuOpen ? "▾" : "▸"}</span>
        </button>
      </div>
      {menuOpen && (
        <div className="mt-2 sm:hidden">
          {/* Inicio: botón independiente siempre visible (móvil y escritorio),
              encima de las familias — nunca dentro de un grupo colapsable. */}
          {inicio && <div className="mb-2 sm:mb-4">{link(inicio)}</div>}
          {/* Mientras /me resuelve, indicador neutro (fail-closed): no se
              listan entradas admin ni se habla de "solo lectura"; las entradas
              adminOnly aparecen solo cuando /me confirma admin. */}
          {role === "loading" && (
            <p role="status" className="px-1 py-2 text-xs text-slate-400">
              {t.nav.checkingRole}
            </p>
          )}
          {/* Móvil: categorías colapsables (Fase 4): las 6 familias se
              presentan bajo las 4 categorías + Sistema aparte. */}
          <div className="space-y-2">
            {CATEGORIES.map((cat) => {
              const groups = cat.groups
                .map((gk) => GROUPS.find((g) => g.key === gk))
                .filter((g): g is (typeof GROUPS)[number] => !!g)
                .map((g) => ({
                  g,
                  items: g.hrefs
                    .map((h) => byHref.get(h))
                    .filter((m): m is (typeof MODULES)[number] => !!m)
                    .filter(matchesQuery),
                }))
                .filter(({ items }) => items.length > 0);
              if (groups.length === 0) return null;
              const isOpen = !!open[cat.key] || query.trim() !== "";
              const catLabel = t.landing[CATEGORY_TITLE_KEY[cat.key]] ?? cat.key;
              const accent = FAMILY_ACCENT[cat.groups[0]] ?? FAMILY_ACCENT.invertir;
              return (
                <div key={cat.key} className="overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900/50 backdrop-blur">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen((prev) => ({ ...prev, [cat.key]: !prev[cat.key] }))}
                    className={`flex min-h-[44px] w-full items-center justify-between gap-2 px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-2 ${accent.ring}`}
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${accent.dot}`} />
                      {catLabel}
                    </span>
                    <span aria-hidden="true" className="text-slate-400">{isOpen ? "▾" : "▸"}</span>
                  </button>
                  {isOpen && (
                    <div className="space-y-3 p-2 pt-0">
                      {groups.map(({ g, items }) => (
                        <div key={g.key}>
                          <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                            {t.navGroups[g.key] ?? g.key}
                          </p>
                          <div className="flex flex-col gap-2">{items.map(link)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Escritorio: buscador + Inicio + categorías seccionadas, todo visible. */}
      <div className="hidden sm:block">
        {inicio && <div className="mb-2 sm:mb-4">{link(inicio)}</div>}
        {role === "loading" && (
          <p role="status" className="px-1 py-2 text-xs text-slate-400">
            {t.nav.checkingRole}
          </p>
        )}
        <div className="mb-4">
          <input
            data-no-swipe
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.landing.modulesSearchPlaceholder}
            aria-label={t.landing.modulesSearchAria}
            className="min-h-[44px] w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900/60 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          />
        </div>
        <div className="space-y-5">
          {CATEGORIES.map((cat) => {
            const groups = cat.groups
              .map((gk) => GROUPS.find((g) => g.key === gk))
              .filter((g): g is (typeof GROUPS)[number] => !!g)
              .map((g) => ({
                g,
                items: g.hrefs
                  .map((h) => byHref.get(h))
                  .filter((m): m is (typeof MODULES)[number] => !!m)
                  .filter(matchesQuery),
              }))
              .filter(({ items }) => items.length > 0);
            if (groups.length === 0) return null;
            const catLabel = t.landing[CATEGORY_TITLE_KEY[cat.key]] ?? cat.key;
            const accent = FAMILY_ACCENT[cat.groups[0]] ?? FAMILY_ACCENT.invertir;
            return (
              <section key={cat.key} aria-label={catLabel}>
                <h2 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-300">
                  <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${accent.dot}`} />
                  {catLabel}
                </h2>
                <div className="space-y-3">
                  {groups.map(({ g, items }) => (
                    <div key={g.key}>
                      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                        {t.navGroups[g.key] ?? g.key}
                      </h3>
                      <div className="flex flex-wrap gap-2">{items.map(link)}</div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          {query.trim() !== "" &&
            !CATEGORIES.some((cat) =>
              cat.groups.some((gk) =>
                GROUPS.find((g) => g.key === gk)?.hrefs.some((h) => {
                  const m = byHref.get(h);
                  return m ? matchesQuery(m) : false;
                }),
              ),
            ) && (
              <p role="status" className="px-1 py-2 text-sm text-slate-400">
                {t.landing.modulesSearchNoResults}
              </p>
            )}
        </div>
      </div>
    </nav>
  );
}
