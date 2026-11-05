"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
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

const MODULES = [
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
];

// Clave del diccionario ES/EN por ruta (lib/i18n): la etiqueta y la
// descripción visibles salen de ahí, no de los textos fijos de MODULES
// (que quedan como respaldo si una ruta no tiene entrada).
const KEY_BY_HREF: Record<string, NavKey> = {
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
};

/** Familias de navegación (Fase 5, F1): las 25 rutas, sin borrar ni
 * renombrar ninguna. Se sigue la propuesta de la auditoría; dos rutas
 * que la propuesta no nombraba se ubican por afinidad y se reportan:
 * Recomendaciones (cursos y herramientas) en Estudiar, Desarrollo
 * digital (adaptación para empresas) en Negocio, e Inicio junto a
 * Invertir como punto de entrada. Las 4 rutas nuevas de Negocio
 * (Talento humano, Gestión de Riesgos, Planillas, Análisis de datos)
 * enlazan a páginas que crea el agente Frontend; hasta entonces el
 * enlace existe en el menú pero la página aún no está servida. Las 3
 * guías de /estudiar/manual-* pertenecen a la familia Estudiar SIN
 * entrada propia en el menú: el grupo las reconoce para el acento y la
 * familia abierta en móvil, y el menú las filtra porque no están en
 * MODULES. */
const GROUPS: { key: string; hrefs: string[] }[] = [
  { key: "invertir", hrefs: ["/inicio", "/"] },
  { key: "estudiar", hrefs: ["/estudiar", "/estudiar/manual-plataforma", "/estudiar/manual-invertir", "/estudiar/manual-negocio", "/estudiar/juego", "/recomendaciones"] },
  { key: "crear", hrefs: ["/crear", "/tendencias", "/analizador"] },
  { key: "negocio", hrefs: ["/crm", "/referidos", "/business", "/facturas", "/correos", "/inventario", "/desarrollo", "/talento", "/riesgos", "/planillas", "/analisis"] },
  { key: "personal", hrefs: ["/espacio", "/perfil"] },
  { key: "sistema", hrefs: ["/chat", "/auditor", "/privacidad", "/usuarios", "/ajustador", "/terminal"] },
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
    active: "bg-emerald-600 text-white ring-emerald-500/50",
    hint: "text-emerald-100/90",
    dot: "bg-emerald-500",
    ring: "focus-visible:ring-emerald-500/60",
  },
  estudiar: {
    active: "bg-sky-600 text-white ring-sky-500/50",
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
    active: "bg-amber-600 text-white ring-amber-500/50",
    hint: "text-amber-100/90",
    dot: "bg-amber-500",
    ring: "focus-visible:ring-amber-500/60",
  },
  personal: {
    active: "bg-teal-600 text-white ring-teal-500/50",
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

export function ModuleNav() {
  const pathname = usePathname();
  const { t } = useLanguage();
  // La entrada de Control de usuarios solo se muestra a administradores.
  const [isAdmin, setIsAdmin] = useState(false);
  // Móvil: solo la familia de la ruta actual empieza abierta.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    GROUPS.forEach((g) => {
      o[g.key] = g.hrefs.includes(pathname);
    });
    return o;
  });
  useEffect(() => {
    api
      .me()
      .then((m) => setIsAdmin(m.is_admin))
      .catch(() => setIsAdmin(false));
  }, []);

  const visible = MODULES.filter((m) => !("adminOnly" in m && m.adminOnly) || isAdmin);
  const byHref = new Map(visible.map((m) => [m.href, m]));

  const link = (m: (typeof MODULES)[number]) => {
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
        className={
          active
            ? `flex min-h-[2.75rem] items-center gap-2 whitespace-nowrap rounded-lg ${accent.active} px-4 py-2.5 text-sm font-semibold shadow-sm ring-1 ring-inset transition-colors`
            : "flex min-h-[2.75rem] items-center gap-2 whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-900/40 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
        }
      >
        {m.icon}
        {label}
        <span className={`hidden text-xs font-normal sm:inline ${active ? accent.hint : "text-zinc-400"}`}>
          {hint}
        </span>
      </Link>
    );
  };

  return (
    <nav aria-label={t.header.navAria}>
      {/* Móvil: familias colapsables, una a una, sin scroll horizontal de 25 ítems. */}
      <div className="space-y-2 sm:hidden">
        {GROUPS.map((g) => {
          const items = g.hrefs.map((h) => byHref.get(h)).filter((m): m is (typeof MODULES)[number] => !!m);
          if (items.length === 0) return null;
          const isOpen = !!open[g.key];
          const groupLabel = t.navGroups[g.key] ?? g.key;
          const accent = FAMILY_ACCENT[g.key] ?? FAMILY_ACCENT.invertir;
          return (
            <div key={g.key} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen((prev) => ({ ...prev, [g.key]: !prev[g.key] }))}
                className={`flex min-h-[44px] w-full items-center justify-between gap-2 px-4 py-2.5 text-sm font-semibold text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 ${accent.ring}`}
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${accent.dot}`} />
                  {groupLabel}
                </span>
                <span aria-hidden="true" className="text-zinc-400">{isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen && <div className="flex flex-col gap-2 p-2 pt-0">{items.map(link)}</div>}
            </div>
          );
        })}
      </div>
      {/* Escritorio: familias seccionadas con encabezado, todas visibles. */}
      <div className="hidden space-y-4 sm:block">
        {GROUPS.map((g) => {
          const items = g.hrefs.map((h) => byHref.get(h)).filter((m): m is (typeof MODULES)[number] => !!m);
          if (items.length === 0) return null;
          const groupLabel = t.navGroups[g.key] ?? g.key;
          const accent = FAMILY_ACCENT[g.key] ?? FAMILY_ACCENT.invertir;
          return (
            <section key={g.key} aria-label={groupLabel}>
              <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${accent.dot}`} />
                {groupLabel}
              </h2>
              <div className="flex flex-wrap gap-2">{items.map(link)}</div>
            </section>
          );
        })}
      </div>
    </nav>
  );
}
