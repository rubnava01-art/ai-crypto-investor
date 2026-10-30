"""Privacidad y cumplimiento — internal compliance task center (2026-10-28).

Centralizes the privacy, data-protection, accessibility and legal
compliance work for the site in one section, grouped in the six
categories Rubén defined. Any authenticated user reads; only admins
create/update/delete (require_admin -> 403 for prueba), mirroring the
other modules.

The 20 seed items are Rubén's own checklist (2026-10-28), inserted
only when the table is empty. Honest boundary: this is an INTERNAL
task center — it does not publish legal texts and does not claim the
site complies. The document items (privacy policy, terms, refunds,
cookies) are tasks to draft and maintain those documents; their
links/text live in `notes`, filled in by the admin.
"""

from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import ComplianceItem, User

router = APIRouter(prefix="/api/privacidad", tags=["privacidad"])

CATEGORIES = {
    "documentos": "Documentos legales",
    "cookies": "Cookies y consentimiento",
    "datos": "Protección y gestión de datos",
    "transparencia": "Transparencia y prácticas comerciales",
    "accesibilidad": "Accesibilidad y contenido",
    "negocio": "Información del negocio",
}

STATUSES = ("pendiente", "en_proceso", "completado")

# Rubén's checklist (2026-10-28): (category, title, description).
SEED_ITEMS: list[tuple[str, str, str]] = [
    (
        "documentos",
        "Política de privacidad",
        "Redactar y mantener actualizada la política de privacidad del sitio.",
    ),
    (
        "documentos",
        "Términos y condiciones",
        "Redactar y mantener actualizados los términos y condiciones del sitio.",
    ),
    (
        "documentos",
        "Política de reembolsos",
        "Definir y publicar la política de reembolsos.",
    ),
    (
        "cookies",
        "Política de cookies",
        "Redactar la política de cookies: qué cookies se usan y para qué.",
    ),
    (
        "cookies",
        "Banner de consentimiento de cookies",
        "Mostrar un banner de consentimiento antes de activar cookies no esenciales.",
    ),
    (
        "cookies",
        "Gestión de consentimientos en formularios",
        "Recoger y guardar el consentimiento en cada formulario que pida datos.",
    ),
    (
        "datos",
        "Revisión de la recolección de datos innecesarios",
        "Revisar qué datos se recogen y eliminar los que no hacen falta.",
    ),
    (
        "datos",
        "Auditoría de SDKs y herramientas de terceros",
        "Auditar qué SDKs y herramientas de terceros reciben datos.",
    ),
    (
        "datos",
        "Eliminación de datos personales",
        "Atender y ejecutar solicitudes de eliminación de datos personales.",
    ),
    (
        "datos",
        "Consentimiento parental cuando corresponda",
        "Pedir consentimiento parental cuando el servicio pueda usarse por menores.",
    ),
    (
        "transparencia",
        "Detección y eliminación de reseñas falsas",
        "Detectar y eliminar reseñas falsas.",
    ),
    (
        "transparencia",
        "Verificación de afirmaciones sin respaldo",
        "Verificar que cada afirmación del sitio tenga respaldo real.",
    ),
    (
        "transparencia",
        "Eliminación de patrones oscuros en la interfaz",
        "Eliminar patrones oscuros: diseños que empujan a decidir sin querer.",
    ),
    (
        "transparencia",
        "Identificación y eliminación de cobros ocultos",
        "Identificar y eliminar cobros ocultos: todo precio debe verse antes de pagar.",
    ),
    (
        "transparencia",
        "Enlace para darse de baja o cancelar suscripciones",
        "Incluir un enlace claro para darse de baja o cancelar suscripciones.",
    ),
    (
        "accesibilidad",
        "Texto alternativo en imágenes (Alt Text)",
        "Añadir texto alternativo a las imágenes.",
    ),
    (
        "accesibilidad",
        "Corrección del contraste y los colores",
        "Corregir contraste y colores para que el texto se lea bien.",
    ),
    (
        "accesibilidad",
        "Navegación accesible mediante teclado",
        "Garantizar que todo se pueda usar solo con el teclado.",
    ),
    (
        "accesibilidad",
        "Verificación de licencias y derechos de uso de imágenes",
        "Verificar que cada imagen tenga licencia y derecho de uso.",
    ),
    (
        "negocio",
        "Revisión y actualización de los datos del negocio",
        "Revisar y actualizar los datos del negocio que se muestran en el sitio.",
    ),
]


def seed_privacidad_items(db: Session) -> None:
    """Insert Rubén's 20 checklist items, only when the table is empty.

    Follows the academy/trends seed pattern: the caller commits. Never
    duplicates: if the admin already has items, nothing is added.
    """
    if db.query(ComplianceItem).count() > 0:
        return
    for category, title, description in SEED_ITEMS:
        db.add(
            ComplianceItem(
                title=title,
                category=category,
                description=description,
                status="pendiente",
                notes="",
            )
        )


class ComplianceItemOut(BaseModel):
    id: int
    title: str
    category: str
    description: str
    status: str
    notes: str
    created_at: str | None = None
    updated_at: str | None = None


class ComplianceItemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    category: str = "documentos"
    description: str = ""
    status: str = "pendiente"
    notes: str = ""


class ComplianceItemUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = None
    description: str | None = None
    status: str | None = None
    notes: str | None = None


def _out(item: ComplianceItem) -> ComplianceItemOut:
    return ComplianceItemOut(
        id=item.id,
        title=item.title,
        category=item.category,
        description=item.description or "",
        status=item.status,
        notes=item.notes or "",
        created_at=item.created_at.isoformat() if item.created_at else None,
        updated_at=item.updated_at.isoformat() if item.updated_at else None,
    )


def _validate_category(category: str) -> str:
    c = (category or "").strip().lower()
    if c not in CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Categoría inválida. Opciones: {', '.join(CATEGORIES)}.",
        )
    return c


def _validate_status(status_value: str) -> str:
    s = (status_value or "").strip().lower()
    if s not in STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Estado inválido. Opciones: {', '.join(STATUSES)}.",
        )
    return s


def _get_item_or_404(db: Session, item_id: int) -> ComplianceItem:
    item = db.query(ComplianceItem).filter(ComplianceItem.id == item_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Tarea no encontrada.")
    return item


@router.get("/items", response_model=list[ComplianceItemOut])
def list_items(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    return [_out(i) for i in db.query(ComplianceItem).order_by(ComplianceItem.id).offset(offset).limit(limit).all()]


@router.post("/items", response_model=ComplianceItemOut, status_code=status.HTTP_201_CREATED)
def create_item(
    body: ComplianceItemCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    item = ComplianceItem(
        title=body.title.strip(),
        category=_validate_category(body.category),
        description=body.description,
        status=_validate_status(body.status),
        notes=body.notes,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _out(item)


@router.put("/items/{item_id}", response_model=ComplianceItemOut)
def update_item(
    item_id: int,
    body: ComplianceItemUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    item = _get_item_or_404(db, item_id)
    if body.title is not None:
        item.title = body.title.strip()
    if body.category is not None:
        item.category = _validate_category(body.category)
    if body.description is not None:
        item.description = body.description
    if body.status is not None:
        item.status = _validate_status(body.status)
    if body.notes is not None:
        item.notes = body.notes
    db.commit()
    db.refresh(item)
    return _out(item)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    item = _get_item_or_404(db, item_id)
    db.delete(item)
    db.commit()
    return None
