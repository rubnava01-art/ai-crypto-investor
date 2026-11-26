"use client";

import Link from "next/link";
import { LegalPage, LegalSection } from "../../../components/LegalPage";
import { useLanguage } from "../../../lib/i18n";

/** Política de cookies — BORRADOR en español (Fase 2 mejoras-v1,
 * tarea 1). Describe lo que la plataforma guarda de verdad en el
 * navegador: sesión e idioma en almacenamiento local, borradores
 * locales y nada de terceros (hoy no hay analítica ni publicidad).
 * No inventa servicios ni datos de empresa. */
export default function CookiesPage() {
  const { t } = useLanguage();
  return (
    <LegalPage title={t.legal.cookiesTitle}>
      <LegalSection title="1. Qué son las cookies y el almacenamiento local">
        <p>
          Las cookies son pequeños archivos que un sitio guarda en tu navegador. El
          almacenamiento local (localStorage) cumple una función parecida: guarda pequeños datos
          en tu navegador para que el sitio te recuerde. Grow Business Platform usa sobre todo
          almacenamiento local, no cookies de seguimiento.
        </p>
      </LegalSection>

      <LegalSection title="2. Qué guarda la plataforma en tu navegador">
        <p>
          <strong className="text-zinc-200">Sesión:</strong> tu token de sesión, para que no
          tengas que entrar con tu usuario y contraseña en cada página. Caduca a los 60 minutos y
          se borra al cerrar sesión.
        </p>
        <p>
          <strong className="text-zinc-200">Idioma:</strong> tu preferencia de idioma (español o
          inglés), para no preguntarla en cada visita.
        </p>
        <p>
          <strong className="text-zinc-200">Borradores locales:</strong> si usas los Flujos, el
          constructor guarda tus borradores solo en tu navegador; lo mismo pasa con algún
          borrador de correo. Estos datos no viajan al servidor.
        </p>
        <p>
          <strong className="text-zinc-200">Prueba sin registro:</strong> si entras como
          invitado, se guarda una marca de sesión de invitado (15 minutos) en tu navegador.
        </p>
      </LegalSection>

      <LegalSection title="3. Qué NO usa la plataforma">
        <p>
          Hoy no hay cookies ni servicios de analítica de terceros, ni publicidad de terceros, ni
          seguimiento publicitario. Si en el futuro se añade alguno, esta página se actualizará
          antes de activarlo.
        </p>
      </LegalSection>

      <LegalSection title="4. Cómo borrarlos">
        <p>
          Puedes borrar el almacenamiento local y las cookies desde los ajustes de tu navegador
          («Borrar datos de navegación»). Si los borras, se cerrará tu sesión y se perderán tus
          borradores locales, pero tu cuenta y tus datos guardados en la plataforma seguirán ahí.
        </p>
      </LegalSection>

      <LegalSection title="5. Cambios en esta política">
        <p>
          Si cambia lo que la plataforma guarda en tu navegador, se actualizará esta página y la
          fecha de arriba. Para preguntas, escríbenos desde la{" "}
          <Link href="/contacto" className="font-semibold text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            página de contacto
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
