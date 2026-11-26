"use client";

import Link from "next/link";
import { LegalPage, LegalPending, LegalSection } from "../../../components/LegalPage";
import { useLanguage } from "../../../lib/i18n";

/** Política de reembolsos y cancelación — BORRADOR en español
 * (Fase 2 mejoras-v1, tarea 3). Coherente con la realidad: planes
 * $19/$49/$99 al mes, 14 días gratis, sin cobro en línea todavía (el
 * admin activa prueba/suscripción). La cancelación en un clic llegará
 * con el cobro en línea (Fase 7); los días y casos de reembolso están
 * marcados PENDIENTE porque solo el dueño puede decidirlos. */
export default function ReembolsosPage() {
  const { t } = useLanguage();
  return (
    <LegalPage title={t.legal.refundsTitle}>
      <LegalSection title="1. Planes y prueba gratis">
        <p>
          Los planes son Esencial $19 al mes, Crecimiento $49 al mes y Negocio Total $99 al mes,
          todos con 14 días de prueba gratis. La prueba incluye todo lo del plan elegido y cuando
          termina decides si sigues o no: no se cobra nada automáticamente.
        </p>
      </LegalSection>

      <LegalSection title="2. Hoy no hay cobro en línea">
        <p>
          La prueba gratis y la suscripción se activan con el administrador de la plataforma:
          todavía no hay cobro en línea y no se guarda ninguna tarjeta. Mientras no haya cobro en
          línea no hay nada que cancelar ni que devolver: si quieres dejar de usar un plan, basta
          con no renovarlo con el administrador o escribir desde la página de contacto.
        </p>
      </LegalSection>

      <LegalSection title="3. Cancelación cuando exista el cobro en línea">
        <p>
          Cuando el cobro en línea esté activo, podrás cancelar tu suscripción en un clic desde tu
          cuenta, sin tener que escribir a nadie (esta función la implementa la Fase 7 del
          programa de mejoras). Al cancelar, seguirás teniendo acceso hasta el final del periodo
          ya pagado; después tu cuenta volverá al rol Prueba. Hoy, sin cobro en línea, la
          cancelación se pide al administrador o desde la{" "}
          <Link href="/contacto" className="font-semibold text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            página de contacto
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="4. Reembolsos">
        <LegalPending>
          Los días de reembolso y los casos en que se devuelve el dinero están pendientes de
          decidir por el dueño. Cuando se decidan, esta sección dirá el plazo exacto, qué se
          devuelve (mes en curso, mes completo, prueba gratis) y cómo se pide.
        </LegalPending>
        <p>
          Lo que sí es seguro: nunca se cobra por un periodo que no se haya mostrado antes de
          pagar, y cualquier cobro por error se revisa con el administrador desde la página de
          contacto.
        </p>
      </LegalSection>

      <LegalSection title="5. Cómo pedir una cancelación o un reembolso">
        <p>
          Escríbenos desde la{" "}
          <Link href="/contacto" className="font-semibold text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            página de contacto
          </Link>{" "}
          indicando tu usuario y el plan. Te responderá un administrador: hoy no hay un plazo
          publicado de respuesta.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
