"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const MODULES = [
  { href: "/", label: "Invertir", hint: "Trading y mercados" },
  { href: "/estudiar", label: "Estudiar", hint: "Academia" },
  { href: "/crear", label: "Crear", hint: "Forge · copies · tendencias" },
  { href: "/crm", label: "CRM", hint: "Contactos y clientes" },
  { href: "/referidos", label: "Referidos", hint: "Campañas con recompensas" },
];

export function ModuleNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Módulos de la plataforma" className="flex flex-wrap gap-2">
      {MODULES.map((m) => {
        const active = pathname === m.href;
        return (
          <Link
            key={m.href}
            href={m.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
                : "rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-zinc-800"
            }
          >
            {m.label}
            <span className={`ml-2 hidden text-xs font-normal sm:inline ${active ? "text-emerald-100/80" : "text-zinc-500"}`}>
              {m.hint}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
