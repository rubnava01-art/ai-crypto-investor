"""Punto de integración con la pasarela de pagos (Fase 7 mejoras-v1).

PREPARAR, NO ACTIVAR — estructura lista para conectar, sin activar:

- NO hay ninguna credencial aquí (ni PayPal ni Stripe): las claves
  son PENDIENTE explícito y las pone el dueño cuando decida el
  proveedor. NO se guarda ninguna clave en el código, en la BD ni
  en variables de este módulo.
- NO hay ninguna llamada real a ninguna pasarela: cada método que
  cobraría o tocaría al proveedor lanza ProveedorNoConfiguradoError
  ("no configurado", en español). Nada falla en silencio y nada
  cobra.
- El código es NEUTRO respecto al proveedor: PayPal y Stripe quedan
  ambas como PENDIENTE (ver PENDIENTES.md); la primera opción la
  elige el dueño. Lo único que ya existe de PayPal son los huecos
  de URL en `frontend/lib/pagos.ts` (PAYMENT_LINKS, hoy los tres
  null): eso es un enlace de pago, no una suscripción gestionada
  por API, y no se toca aquí.
- Cuando el dueño elija proveedor, la implementación real vive en
  una subclase de PagosProveedor (p. ej. PagosPayPal /
  PagosStripe) que implemente estos mismos métodos; el resto del
  código (suscripciones, cancelación, avisos) no cambia.
"""

PROVEEDOR_PENDIENTE = (
    "El pago en línea aún no está activo: no hay pasarela de pagos "
    "configurada (PayPal y Stripe están pendientes de decisión del "
    "dueño). La activación de planes la hace el administrador."
)


class ProveedorNoConfiguradoError(RuntimeError):
    """La pasarela no está configurada: no se puede cobrar ni
    gestionar nada en el proveedor. Nunca es un fallo silencioso."""


def proveedor_configurado() -> bool:
    """¿Hay pasarela configurada? Hoy siempre False (Fase 7: solo
    estructura). Cuando se conecte un proveedor, esta función leerá
    su configuración (sin exponer claves)."""
    return False


def estado_proveedor() -> dict:
    """Estado honesto de la pasarela para la API/UI: sin proveedor,
    sin claves y sin fechas prometidas."""
    return {
        "configurado": False,
        "proveedor": None,
        "mensaje": PROVEEDOR_PENDIENTE,
        "pendientes": ["paypal", "stripe"],
    }


class PagosProveedor:
    """Interfaz de la pasarela (neutra: PayPal o Stripe).

    Todos los métodos reales lanzan ProveedorNoConfiguradoError
    hasta que exista una implementación con credenciales del dueño.
    Ninguno cobra, cancela ni consulta nada real hoy.
    """

    nombre = "sin_configurar"

    def crear_suscripcion(
        self, *, user_id: int, plan: str
    ) -> dict:  # pragma: no cover - stub sin configurar
        """Crear la suscripción en el proveedor y devolver su id."""
        raise ProveedorNoConfiguradoError(PROVEEDOR_PENDIENTE)

    def cancelar_en_proveedor(
        self, *, proveedor_suscripcion_id: str
    ) -> dict:  # pragma: no cover - stub sin configurar
        """Cancelar la suscripción en el proveedor (al final del
        periodo pagado, como la cancelación local)."""
        raise ProveedorNoConfiguradoError(PROVEEDOR_PENDIENTE)

    def procesar_webhook(
        self, *, cuerpo: bytes, firma: str | None
    ) -> dict:  # pragma: no cover - stub sin configurar
        """Validar la firma y traducir un webhook del proveedor a un
        evento interno (p. ej. pago confirmado, suscripción
        cancelada). Sin proveedor no hay nada que validar."""
        raise ProveedorNoConfiguradoError(PROVEEDOR_PENDIENTE)


def obtener_proveedor() -> PagosProveedor:
    """Fábrica: hoy devuelve el stub sin configurar. Cuando el dueño
    elija proveedor, aquí se devolverá su implementación."""
    return PagosProveedor()
