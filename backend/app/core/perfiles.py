"""Aislamiento por perfil (corrida 2026-11-23, Agente 2).

Resuelve M1/D3 por orden de Rubén: cada perfil ve solo sus módulos.

Claves de módulo: las de `frontend/components/ModuleNav.tsx`
(`KEY_BY_HREF`) más dos rutas de la app que no están en ese menú:
"asistente" (`/asistente`, la página del Asistente; el menú solo
lista "chat" para el chat en vivo) y "portal" (portal del cliente,
bajo Negocio > Marketing). El frontend las usa para filtrar el menú;
aquí cierran las rutas de datos en servidor.

- super_admin / admin: todos los módulos.
- prueba (sin vínculo): solo demo, sin datos reales:
  ["inicio", "estudiar", "crear", "asistente", "perfil", "planes"].
- cliente vinculado (Contact.user_id == user.id): solo lo suyo:
  ["inicio", "portal", "perfil"] (sin "asistente": el chat le
  responde 403 por B1; dictamen QA 2026-11-23, opción B).
- Rol "inversionista": NO existe en el código (verificado por grep
  en security.py y tables.py: solo super_admin > admin > prueba, más
  el lector vinculado). No se crea; si algún día existe, se le daría
  ["inicio", "invertir", "asistente", "perfil"].

Los routers de datos que sirven a clientes vinculados con filtro
propio en servidor (D-01: marketing/contenido, portal) NO se cierran
con este helper: su aislamiento ya es por contacto, no por módulo.
"""
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import Guest, effective_role, get_current_principal
from app.database import get_db
from app.models.tables import User

# Todas las claves de KEY_BY_HREF en ModuleNav + asistente + portal.
MODULOS_TODOS = frozenset(
    {
        "inicio", "invertir", "estudiar", "crear", "analizador", "crm",
        "referidos", "business", "espacio", "facturas", "correos",
        "chat", "recomendaciones", "desarrollo", "talento", "riesgos",
        "planillas", "analisis", "tendencias", "auditor", "privacidad",
        "inventario", "perfil", "usuarios", "ajustador", "terminal",
        "flujos", "planes",
        "asistente", "portal",
    }
)

# Demo de prueba: sin datos reales (sin invertir, crm, facturas,
# correos, negocio ni sistema).
MODULOS_PRUEBA = frozenset(
    {"inicio", "estudiar", "crear", "asistente", "perfil", "planes"}
)

# Cliente vinculado: solo lo suyo (portal + inicio + perfil).
# "asistente" NO está en la lista (dictamen QA 2026-11-23, opción B):
# el chat del Asistente le responde 403 por B1 (cierre de seguridad,
# corrida 2026-11-23), así que listar el módulo sería prometer en el
# menú lo que el backend niega. Si Rubén decide abrir el chat a
# clientes con alcance a sus propios datos, se implementa como
# funcionalidad aparte (opción A del dictamen) y se re-añade aquí.
MODULOS_CLIENTE = frozenset({"inicio", "portal", "perfil"})

# Invitado (sin registro, Fase 1, 2026-11-23): conjunto fijo, sin
# fila User y sin persistencia. Solo lectura pública de Inicio y
# Estudiar, vista de precios/planes y Asistente de solo lectura.
MODULOS_INVITADO = frozenset({"inicio", "estudiar", "planes", "asistente"})


def es_cliente_vinculado(db: Session, user: User) -> bool:
    """True si el usuario no-admin tiene un Contact vinculado."""
    if user.is_admin:
        return False
    # Un Guest (id None) nunca está vinculado: sin este guard,
    # `Contact.user_id == None` se traduce a IS NULL y podría casar
    # con un contacto sin vínculo.
    if getattr(user, "id", None) is None:
        return False
    from app.models.tables import Contact

    return (
        db.query(Contact).filter(Contact.user_id == user.id).first()
        is not None
    )


def contacto_vinculado_id(db: Session, user: User) -> int | None:
    """Id del Contact vinculado, o None (admin o sin vínculo)."""
    if user.is_admin:
        return None
    if getattr(user, "id", None) is None:
        return None
    from app.models.tables import Contact

    contact = db.query(Contact).filter(Contact.user_id == user.id).first()
    return contact.id if contact else None


def modulos_para(usuario: User | Guest, db: Session) -> set:
    """Módulos visibles para el usuario (ver docstring del módulo)."""
    if isinstance(usuario, Guest):
        return set(MODULOS_INVITADO)
    rol = effective_role(usuario, db)
    if rol in ("super_admin", "admin"):
        return set(MODULOS_TODOS)
    if es_cliente_vinculado(db, usuario):
        return set(MODULOS_CLIENTE)
    return set(MODULOS_PRUEBA)


def assert_modulo_visible(db: Session, usuario: User | Guest, modulo: str) -> None:
    """403 si el módulo no está en la lista del perfil."""
    if modulo not in modulos_para(usuario, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Tu perfil no tiene acceso al módulo «{modulo}».",
        )


def require_modulo(modulo: str):
    """Dependencia FastAPI: cierra un router (o ruta) a un módulo.

    Uso: `APIRouter(dependencies=[Depends(require_modulo("crm"))])`
    o por ruta: `user: User = Depends(require_modulo("crm"))`.

    El gate resuelve el principal con get_current_principal(): un
    User pasa por su lista de módulos y un Guest por su conjunto
    fijo (MODULOS_INVITADO); un Guest fuera de esos módulos recibe
    403, igual que un prueba fuera de los suyos.
    """

    def _gate(
        user: User | Guest = Depends(get_current_principal),
        db: Session = Depends(get_db),
    ) -> User | Guest:
        assert_modulo_visible(db, user, modulo)
        return user

    return _gate
