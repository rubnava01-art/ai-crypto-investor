"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    href: "/crm",
    label: "CRM",
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
];

export function ModuleNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Módulos de la plataforma" className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
      {MODULES.map((m) => {
        const active = pathname === m.href;
        return (
          <Link
            key={m.href}
            href={m.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "flex items-center gap-2 whitespace-nowrap rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm"
                : "flex items-center gap-2 whitespace-nowrap rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800"
            }
          >
            {m.icon}
            {m.label}
            <span className={`hidden text-xs font-normal sm:inline ${active ? "text-emerald-100/80" : "text-zinc-500"}`}>
              {m.hint}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
