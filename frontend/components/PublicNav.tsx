"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LanguageToggle, useLanguage } from "../lib/i18n";

/** Menú público (2026-11-12): lo que ve un visitante sin sesión.
 * Exactamente cuatro ítems — Inicio, Contacto, Registrarse, Login — y
 * nada más. Inicio va a la landing (/), Contacto a /contacto,
 * Registrarse a /login?mode=register (la página de login preselecciona
 * el modo registro con ese parámetro) y Login a /login. Sin props
 * obligatorias: la landing lo usa y la página de login lo reutiliza
 * después (export nombrado estable). En móvil los ítems van en una fila
 * con desplazamiento horizontal si no caben; cada objetivo táctil mide
 * al menos 44 px de alto. No dispara llamadas autenticadas. */
export function PublicNav() {
  const { t } = useLanguage();
  const pathname = usePathname();
  const items = [
    { href: "/", label: t.publicNav.home },
    { href: "/contacto", label: t.publicNav.contact },
    { href: "/login?mode=register", label: t.publicNav.register },
    { href: "/login", label: t.publicNav.login },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link
          href="/"
          aria-label={t.publicNav.brandAria}
          className="flex min-h-[44px] shrink-0 items-center text-base font-bold tracking-tight text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
        >
          {t.header.brand}
        </Link>
        <nav aria-label={t.publicNav.navAria} className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {items.map((item) => {
            const active =
              (item.href === "/" && pathname === "/") ||
              (item.href === "/contacto" && pathname === "/contacto") ||
              (item.href === "/login" && pathname === "/login");
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                  active ? "bg-zinc-800 text-white" : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <span className="ml-1 shrink-0">
            <LanguageToggle />
          </span>
        </nav>
      </div>
    </header>
  );
}
