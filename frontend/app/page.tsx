import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Landing } from "../components/Landing";
import { RootGate } from "../components/RootGate";
import {
  SESSION_COOKIE_NAME,
  rootShellForSessionCookie,
} from "../lib/sessionCookie";

/** Raíz (Fase 3 mejoras-v1, SEO): componente de SERVIDOR. El HTML
 * inicial ya trae la presentación pública (<Landing />) con el contenido
 * principal — héroe, precios, módulos, planes y preguntas frecuentes —
 * en vez de una cáscara vacía que solo se llenaba en el cliente.
 *
 * Corrección QA H2 (2026-11-25): la raíz lee la cookie marcadora no
 * sensible `gpb_session` (la pone el login, la borra el logout) y, con
 * sesión marcada, sirve la cáscara del dashboard en vez de la landing:
 * desaparecen el destello y el hydration mismatch para logueados.
 * Sin cookie sirve la landing SSR (invitados y SEO, sin cambios). La
 * ruta pasa a renderizarse por petición (cookies() la hace dinámica);
 * es el precio de decidir en el servidor y no afecta al SEO: un bot
 * sin cookie sigue recibiendo la landing completa.
 * /herramientas sigue PENDIENTE: sus archivos no existen en este
 * worktree (ver frontend/app/herramientas/PENDIENTE.md). */
export const metadata: Metadata = {
  title: "Grow Business Platform — Invierte, estudia y crea",
  // Fase 4 mejoras-v1, tarea 1: la descripción es la promesa del
  // subtítulo, una sola frase (unificación Fase 3, sin cifras nuevas).
  description:
    "Invierte en simulación, aprende, crea contenido y gestiona tu negocio con un solo inicio de sesión.",
  alternates: { canonical: "https://crypto-investor-web.onrender.com/" },
  openGraph: {
    title: "Grow Business Platform — Invierte, estudia y crea",
    description:
      "Invierte en simulación, aprende, crea contenido y gestiona tu negocio con un solo inicio de sesión.",
    url: "https://crypto-investor-web.onrender.com",
    siteName: "Grow Business Platform",
    locale: "es_MX",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Grow Business Platform — Simulación, sin dinero real",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Grow Business Platform — Invierte, estudia y crea",
    description:
      "Invierte en simulación, aprende, crea contenido y gestiona tu negocio con un solo inicio de sesión.",
    images: ["/og.png"],
  },
};

export default async function HomePage() {
  const cookieStore = await cookies();
  const serverHasSession =
    rootShellForSessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value) ===
    "dashboard";
  return <RootGate landing={<Landing />} serverHasSession={serverHasSession} />;
}
