"use client";

import Link from "next/link";
import { LegalPage, LegalPending, LegalSection } from "../../../components/LegalPage";
import { useLanguage } from "../../../lib/i18n";

/** Términos y condiciones — BORRADOR en español (Fase 2 mejoras-v1,
 * tarea 1). Texto genérico y honesto sobre el servicio real: simulación
 * de inversión sin dinero real ni asesoría financiera, cuentas por
 * aprobar, planes $19/$49/$99 con 14 días gratis y sin cobro en línea
 * todavía. No inventa razón social, dirección ni datos de empresa:
 * donde falta un dato real, se marca PENDIENTE. */
export default function TerminosPage() {
  const { t } = useLanguage();
  return (
    <LegalPage title={t.legal.termsTitle}>
      <LegalSection title="1. Qué es Grow Business Platform">
        <p>
          Grow Business Platform es una plataforma en un solo lugar para practicar inversión en
          simulación, estudiar, crear contenido y gestionar un negocio: señales y órdenes en
          simulación con BTC y ETH, academia y manuales, herramientas de creación y módulos de
          gestión (clientes, facturas, inventario, equipo y más). Un solo inicio de sesión abre
          todas las áreas.
        </p>
      </LegalSection>

      <LegalSection title="2. El servicio es simulación, no asesoría financiera">
        <p>
          Todo lo relacionado con inversión es simulación con saldos virtuales: el trading real
          está apagado y no se mueve dinero real. Nada de lo que muestra la plataforma es asesoría
          financiera, ni una recomendación de compra o venta, ni una promesa de ganancias. Los
          resultados pasados, incluidos los de cualquier backtest, no garantizan resultados
          futuros. El trading con criptomonedas puede perder todo el capital.
        </p>
      </LegalSection>

      <LegalSection title="3. Cuentas">
        <p>
          Para usar la plataforma hay que crear una cuenta con un usuario y una contraseña de al
          menos 12 caracteres, y resolver una pregunta de verificación. Las cuentas nuevas quedan
          pendientes de activación por un administrador; hasta que se aprueban, no se puede entrar.
          Las cuentas nuevas entran con el rol Prueba: ver y probar, sin cambiar nada. Eres
          responsable de guardar tu contraseña y de no compartir tu cuenta.
        </p>
        <p>
          Un administrador puede suspender o borrar una cuenta que abuse del servicio. Puedes
          borrar tu propia cuenta cuando quieras desde Mi perfil, en la sección «Mis datos».
        </p>
      </LegalSection>

      <LegalSection title="4. Planes y pagos">
        <p>
          Los planes son Esencial $19 al mes, Crecimiento $49 al mes y Negocio Total $99 al mes,
          todos con 14 días de prueba gratis. Hoy no hay cobro en línea: la prueba y la
          suscripción se activan con el administrador. Cuando exista el cobro en línea, el precio
          y la forma de pago se mostrarán antes de pagar, sin cobros ocultos.
        </p>
        <p>
          La política de reembolsos y cancelación está en la página de{" "}
          <Link href="/legal/reembolsos" className="font-semibold text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            reembolsos y cancelación
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="5. Uso aceptable">
        <p>
          Usa la plataforma solo para lo que está hecha. No intentes entrar a cuentas ajenas,
          romper la seguridad, automatizar el registro ni subir contenido que no sea tuyo o que
          sea ilegal. El contenido que creas dentro de la plataforma sigue siendo tuyo.
        </p>
      </LegalSection>

      <LegalSection title="6. Tus datos">
        <p>
          Qué datos se recogen y para qué se usan está explicado en la{" "}
          <Link href="/legal/privacidad" className="font-semibold text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            Política de privacidad
          </Link>
          . Puedes exportar tus datos y borrar tu cuenta desde Mi perfil, en «Mis datos».
        </p>
      </LegalSection>

      <LegalSection title="7. Disponibilidad y cambios">
        <p>
          La plataforma está en desarrollo activo: las funciones pueden cambiar, mejorar o
          quitarse, y el servicio puede interrumpirse por mantenimiento. Los cambios importantes
          se anuncian en Inicio. Estos términos pueden actualizarse; la fecha de la última
          actualización está arriba.
        </p>
      </LegalSection>

      <LegalSection title="8. Titular y contacto">
        <LegalPending>
          El titular legal, la razón social y la dirección de la plataforma están pendientes de
          definir por el dueño. Hasta que se definan, el contacto es a través de la página de
          contacto de la plataforma.
        </LegalPending>
        <p>
          Para cualquier pregunta sobre estos términos, escríbenos desde la{" "}
          <Link href="/contacto" className="font-semibold text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            página de contacto
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
