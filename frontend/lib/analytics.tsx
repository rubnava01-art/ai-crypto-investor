"use client";

import { useEffect } from "react";

/** Analytics (gestión SEO 2026-11-03, reel Peter Lead: "¿tienes
 * analítica instalada?"). Plausible, sin cookies, sin datos personales.
 *
 * APAGADO por defecto: solo carga el script si está definida
 * NEXT_PUBLIC_PLAUSIBLE_DOMAIN (p. ej. crypto-investor-web.onrender.com)
 * Y ese sitio existe en la cuenta de Plausible. Sin la variable no se
 * carga ningún script ni se envía nada. Activarlo es un paso del dueño:
 * crear el sitio en Plausible y definir la variable en el deploy. */
export function Analytics() {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  useEffect(() => {
    if (!domain) return;
    const s = document.createElement("script");
    s.defer = true;
    s.dataset.domain = domain;
    s.src = "https://plausible.io/js/script.js";
    document.head.appendChild(s);
    return () => {
      document.head.removeChild(s);
    };
  }, [domain]);
  return null;
}
