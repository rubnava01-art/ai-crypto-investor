"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LanguageToggle, useLanguage } from "../lib/i18n";
import { getToken } from "../lib/api";

/** Menú público (2026-11-12): lo que ve un visitante sin sesión.
 * Ítems — Inicio, Herramientas, Planes, Contacto, Registrarse, Login —
 * y nada más (TBT-Herramientas, FASE 2, A-3, 2026-11-24: se añaden
 * Herramientas y Planes; antes eran cuatro). Inicio va a la landing (/),
 * Herramientas a /herramientas, Planes a /planes, Contacto a /contacto,
 * Registrarse a /login?mode=register (la página de login preselecciona
 * el modo registro con ese parámetro) y Login a /login. Sin props
 * obligatorias: la landing lo usa y la página de login lo reutiliza
 * después (export nombrado estable). En móvil los ítems van en una fila
 * con desplazamiento horizontal si no caben; cada objetivo táctil mide
 * al menos 44 px de alto. No dispara llamadas autenticadas.
 *
 * 2026-11-13 (A5/M9/M11): con sesión, Registrarse y Login se sustituyen
 * por un solo "Entrar a la plataforma" (el menú de 4 ítems para
 * visitantes no cambia); en /login?mode=register el ítem activo es
 * Registrarse, no Login; `variant="onBlue"` adapta los colores al fondo
 * azul de la página de login sin rediseñar el login Metro. La sesión se
 * lee en el cliente (getToken) para no romper el prerender estático. */
export function PublicNav({ variant = "dark" }: { variant?: "dark" | "onBlue" } = {}) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const [authed, setAuthed] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);

  useEffect(() => {
    setAuthed(!!getToken());
    try {
      setRegisterMode(new URLSearchParams(window.location.search).get("mode") === "register");
    } catch {
      setRegisterMode(false);
    }
  }, [pathname]);

  const visitorItems = [
    { href: "/", label: t.publicNav.home, key: "home" },
    { href: "/herramientas", label: t.publicNav.tools, key: "tools" },
    { href: "/planes", label: t.publicNav.plans, key: "plans" },
    { href: "/contacto", label: t.publicNav.contact, key: "contact" },
    { href: "/login?mode=register", label: t.publicNav.register, key: "register" },
    { href: "/login", label: t.publicNav.login, key: "login" },
  ];
  const items = authed
    ? [
        { href: "/", label: t.publicNav.home, key: "home" },
        { href: "/herramientas", label: t.publicNav.tools, key: "tools" },
        { href: "/planes", label: t.publicNav.plans, key: "plans" },
        { href: "/contacto", label: t.publicNav.contact, key: "contact" },
        { href: "/", label: t.publicNav.enterPlatform, key: "enter" },
      ]
    : visitorItems;

  const onBlue = variant === "onBlue";
  return (
    <header
      className={
        onBlue
          ? "sticky top-0 z-40 border-b border-blue-800 bg-blue-800/95 shadow-[0_8px_24px_rgb(0_0_0/0.35)] backdrop-blur"
          : "sticky top-0 z-40 border-b border-slate-800/80 bg-[#0B0F19]/90 shadow-[0_8px_24px_rgb(0_0_0/0.35)] backdrop-blur"
      }
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link
          href="/"
          aria-label={t.publicNav.brandAria}
          className={`flex min-h-[44px] shrink-0 items-center text-base font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
            onBlue ? "text-white" : "text-slate-50"
          }`}
        >
          {t.header.brand}
        </Link>
        <nav aria-label={t.publicNav.navAria} className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {items.map((item) => {
            const active =
              (item.key === "home" && pathname === "/" && !registerMode) ||
              (item.key === "tools" && pathname === "/herramientas") ||
              (item.key === "plans" && pathname === "/planes") ||
              (item.key === "contact" && pathname === "/contacto") ||
              (item.key === "register" && pathname === "/login" && registerMode) ||
              (item.key === "login" && pathname === "/login" && !registerMode);
            return (
              <Link
                key={`${item.key}-${item.href}`}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                  active
                    ? onBlue
                      ? "bg-white/15 text-white"
                      : "bg-emerald-500/15 text-emerald-300"
                    : onBlue
                      ? "text-blue-100 hover:bg-white/10 hover:text-white"
                      : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {/* H-21: el toggle de idioma sale de la fila con scroll: antes
            quedaba fuera de vista en móvil hasta desplazar; ahora es
            fijo a la derecha del encabezado, siempre visible. */}
        <span className="shrink-0">
          <LanguageToggle />
        </span>
      </div>
    </header>
  );
}
