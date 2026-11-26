"use client";

import Link from "next/link";
import { LegalPage, LegalPending, LegalSection } from "../../../components/LegalPage";
import { useLanguage } from "../../../lib/i18n";

/** Política de privacidad — BORRADOR en español (Fase 2 mejoras-v1,
 * tarea 1). Describe los datos reales que recoge la plataforma (cuenta,
 * contenido y uso) y lo que NO se hace con ellos. No inventa razón
 * social, dirección ni datos de empresa: donde falta un dato real, se
 * marca PENDIENTE. */
export default function PrivacidadLegalPage() {
  const { t } = useLanguage();
  return (
    <LegalPage title={t.legal.privacyTitle}>
      <LegalSection title="1. Qué datos se recogen">
        <p>
          <strong className="text-zinc-200">Datos de tu cuenta:</strong> tu usuario y tu
          contraseña (guardada cifrada), y el correo si lo das para la verificación. Tu perfil
          puede llevar además nombre, dirección, foto, biografía, ubicación, negocio y
          habilidades: todo opcional, y lo que dejes vacío queda vacío.
        </p>
        <p>
          <strong className="text-zinc-200">Datos de tu uso:</strong> los contactos, facturas,
          inventario, correos, notas, citas, mensajes de chat y el contenido que creas dentro de
          la plataforma, además de tus consultas al Asistente y tus búsquedas de tendencias.
        </p>
        <p>
          <strong className="text-zinc-200">Datos técnicos:</strong> tu sesión caduca a los 60
          minutos, y se guarda un registro limitado de intentos de acceso por dirección IP para
          frenar abusos (por ejemplo, demasiados intentos de registro o de inicio de sesión).
        </p>
      </LegalSection>

      <LegalSection title="2. Para qué se usan">
        <p>
          Solo para prestarte el servicio: que entres a tu cuenta, que guardes tu trabajo y que
          la plataforma funcione. Nada se vende ni se comparte con terceros. No hay publicidad de
          terceros ni seguimiento publicitario.
        </p>
      </LegalSection>

      <LegalSection title="3. Cookies y almacenamiento local">
        <p>
          La plataforma guarda tu sesión y tu idioma en el almacenamiento local de tu navegador
          (no en cookies de seguimiento). El detalle está en la{" "}
          <Link href="/legal/cookies" className="font-semibold text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            Política de cookies
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="4. Cómo se protege tu cuenta">
        <p>
          La contraseña se guarda cifrada y nunca se muestra. El registro pide una pregunta de
          verificación contra cuentas automáticas, hay un límite de intentos por dirección IP y la
          sesión caduca a los 60 minutos. Los administradores pueden activar la verificación en
          dos pasos. Ninguna medida es perfecta: guarda tu contraseña y no la compartas.
        </p>
      </LegalSection>

      <LegalSection title="5. Tus derechos: ver, exportar y borrar">
        <p>
          Puedes ver y editar tus datos en Mi perfil. Desde «Mis datos» puedes descargar todos
          tus datos en un archivo JSON y puedes borrar tu cuenta (te pedirá tu contraseña para
          confirmarlo). Al borrarla se eliminan tu cuenta y tus datos personales; los registros de
          negocio compartidos que creaste quedan sin autor, y el historial de auditoría se
          conserva sin tu nombre, como registro del sistema. Si prefieres pedirlo por escrito,
          escríbenos desde la página de contacto.
        </p>
      </LegalSection>

      <LegalSection title="6. Menores de edad">
        <p>
          El servicio está pensado para personas adultas que gestionan un negocio o practican
          inversión en simulación. No está dirigido a menores de edad.
        </p>
      </LegalSection>

      <LegalSection title="7. Cambios en esta política">
        <p>
          Si esta política cambia de forma importante, se anunciará en Inicio y la fecha de la
          última actualización, arriba, cambiará con ella.
        </p>
      </LegalSection>

      <LegalSection title="8. Titular y contacto">
        <LegalPending>
          El titular legal, la razón social y la dirección están pendientes de definir por el
          dueño. Hasta que se definan, el contacto es a través de la página de contacto de la
          plataforma.
        </LegalPending>
        <p>
          Para ejercer tus derechos sobre tus datos o preguntar por esta política, escríbenos
          desde la{" "}
          <Link href="/contacto" className="font-semibold text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            página de contacto
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
