"""Academia — Plataforma Unificada, Fase 2 (módulo Estudiar).

Catalog of Rubén's REAL digital products, seeded from documented records
(MEMORY.md + academia-campaign): the 6 Hotmart ebooks at $19.99, the Pack
Creador Completo at $59.99 and the $400 Academy (PayPal/Square). No URL or
price is invented here.

Permissions follow the platform RBAC:
- any authenticated user (admin or "prueba") can READ the catalog and the
  per-course student lists;
- only admins can edit courses and register/update/delete deliveries
  (require_admin -> 403 for prueba).

Delivery tracking links the Academy to the CRM: an enrollment ties one
CRM contact to one course, with purchased/delivered flags + timestamps.
"""
import base64
import logging
from decimal import Decimal, InvalidOperation
from pathlib import Path

from fastapi import APIRouter, Depends, Query, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import Contact, Course, CourseEnrollment, User, utcnow

router = APIRouter(prefix="/api/academy", tags=["academy"])

KINDS = ("ebook", "pack", "academia")

# --- Real PDF files (Fase 2.5) --------------------------------------------
# The actual PDFs live in the repo at backend/app/assets/pdfs/ and are served
# ONLY through the authenticated download endpoint below (never static).
# Map: course slug -> PDF filename inside PDF_DIR.
PDF_DIR = Path(__file__).resolve().parent.parent / "assets" / "pdfs"
PDF_FILES: dict[str, str] = {
    "manual-ia-emprendedores": "manual-ia-emprendedores.pdf",
    "manual-claude": "manual-claude.pdf",
    "manual-marketing-2027": "manual-marketing-2027.pdf",
    "whatsapp-vende": "whatsapp-vende.pdf",
    "sistema-contenido-ia": "sistema-contenido-ia.pdf",
    "marca-personal-rentable": "marca-personal-rentable.pdf",
    # The $400 Academy delivers its complete-course PDF.
    "academia-habilidades-negocio": "academia-curso-completo.pdf",
    # The Pack has no single file: it is the 6 ebook PDFs (see downloads).
}
PACK_SLUG = "pack-creador-completo"

logger = logging.getLogger(__name__)


def ensure_pdf_file(filename: str) -> Path | None:
    """Return the PDF path, materializing it from its .b64 sibling if needed.

    The deploy pipeline (GitHub push-files) only accepts UTF-8 text, so the
    repo ALSO ships each PDF as base64 text (``<name>.pdf.b64``) next to the
    binary. On hosts where the binary itself did not survive the deploy
    (e.g. Render), decode the .b64 into the real .pdf on first use.
    Idempotent, and never raises: on any failure it logs and returns None so
    the caller answers its usual 404.
    """
    path = PDF_DIR / filename
    if path.is_file():
        return path
    b64_path = PDF_DIR / f"{filename}.b64"
    if not b64_path.is_file():
        return None
    try:
        data = base64.b64decode(b64_path.read_text(encoding="ascii"))
        path.write_bytes(data)
        logger.info("Materialized PDF %s from its base64 source", filename)
    except Exception:  # defensive: a corrupt .b64 must not break downloads
        logger.exception("Failed to materialize PDF %s from base64", filename)
        return None
    return path if path.is_file() else None

# --- Real catalog (documented 2026-10-07 / academia-campaign) --------------
# (slug, title, description, price_usd, kind, buy_url, delivery_note)
CATALOG: list[tuple[str, str, str, str, str, str, str]] = [
    (
        "manual-ia-emprendedores",
        "Manual de IA para Emprendedores",
        "Manual práctico de inteligencia artificial aplicada a emprender, por Rubén.",
        "19.99",
        "ebook",
        "https://go.hotmart.com/B107872670I",
        "Entrega digital vía Hotmart tras el pago.",
    ),
    (
        "manual-claude",
        "Manual de Muse",
        "Guía práctica para trabajar con Muse en el día a día, por Rubén.",
        "19.99",
        "ebook",
        "https://go.hotmart.com/H107872686Y",
        "Entrega digital vía Hotmart tras el pago.",
    ),
    (
        "manual-marketing-2027",
        "Manual de Marketing 2027",
        "Manual de marketing con la mirada puesta en 2027, por Rubén.",
        "19.99",
        "ebook",
        "https://go.hotmart.com/B107872713S",
        "Entrega digital vía Hotmart tras el pago.",
    ),
    (
        "whatsapp-vende",
        "WhatsApp Vende",
        "Manual para vender por WhatsApp, paso a paso, por Rubén.",
        "19.99",
        "ebook",
        "https://go.hotmart.com/R107890527U",
        "Entrega digital vía Hotmart tras el pago.",
    ),
    (
        "sistema-contenido-ia",
        "Sistema de Contenido con IA",
        "Sistema para crear contenido con ayuda de la inteligencia artificial, por Rubén.",
        "19.99",
        "ebook",
        "https://go.hotmart.com/H107890643K",
        "Entrega digital vía Hotmart tras el pago.",
    ),
    (
        "marca-personal-rentable",
        "Marca Personal Rentable",
        "Manual para construir una marca personal rentable, por Rubén.",
        "19.99",
        "ebook",
        "https://go.hotmart.com/W107890679J",
        "Entrega digital vía Hotmart tras el pago.",
    ),
    (
        "pack-creador-completo",
        "Pack Creador Completo",
        "Los 6 manuales de Rubén en un solo pack (PDF).",
        "59.99",
        "pack",
        "https://go.hotmart.com/D107932748G",
        "Entrega digital vía Hotmart tras el pago (los 6 PDFs).",
    ),
    (
        "academia-habilidades-negocio",
        "Academia de Habilidades de Negocio",
        "La academia completa de habilidades de negocio de Rubén: los 6 manuales "
        "en PDF más el PDF del curso completo.",
        "400.00",
        "academia",
        "https://py.pl/DmZD4WMDLU2VkraMHHo4kg",
        "Pago por PayPal (https://py.pl/DmZD4WMDLU2VkraMHHo4kg) o Square "
        "(https://square.link/u/ewarbJoj). Entrega manual el mismo día: el "
        "comprador envía su comprobante por WhatsApp/DM y recibe los 6 PDFs "
        "+ el PDF del curso completo.",
    ),
]


# Ebook slugs in catalog order (the Pack is exactly these 6 PDFs).
EBOOK_SLUGS = [entry[0] for entry in CATALOG if entry[4] == "ebook"]


def seed_academy_catalog(db: Session) -> None:
    """Insert any catalog item that is missing (idempotent by slug)."""
    existing = {c.slug for c in db.query(Course).all()}
    added = False
    for i, (slug, title, desc, price, kind, url, note) in enumerate(CATALOG):
        if slug in existing:
            continue
        db.add(
            Course(
                slug=slug,
                title=title,
                description=desc,
                price_usd=Decimal(price),
                kind=kind,
                buy_url=url,
                delivery_note=note,
                sort_order=i,
            )
        )
        added = True
    if added:
        db.commit()


# ---------------------------------------------------------------- schemas --

class CourseDownload(BaseModel):
    course_id: int
    title: str
    filename: str


class CourseOut(BaseModel):
    id: int
    slug: str
    title: str
    description: str
    price_usd: str  # money stays a string end-to-end
    kind: str
    buy_url: str
    delivery_note: str
    sort_order: int
    students_count: int
    downloads: list[CourseDownload] = []
    created_at: str | None = None
    updated_at: str | None = None


class CourseUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None
    price_usd: str | None = None
    kind: str | None = None
    buy_url: str | None = Field(default=None, max_length=512)
    delivery_note: str | None = None


class EnrollmentOut(BaseModel):
    id: int
    contact_id: int
    course_id: int
    contact_name: str
    contact_email: str
    course_title: str
    purchased: bool
    delivered: bool
    purchased_at: str | None = None
    delivered_at: str | None = None
    notes: str
    created_at: str | None = None
    updated_at: str | None = None


class EnrollmentCreate(BaseModel):
    contact_id: int
    course_id: int
    purchased: bool = True
    delivered: bool = False
    notes: str = ""


class EnrollmentUpdate(BaseModel):
    purchased: bool | None = None
    delivered: bool | None = None
    notes: str | None = None


# ---------------------------------------------------------------- helpers --

def _downloads_for(db: Session, c: Course) -> list[CourseDownload]:
    """PDFs downloadable from this catalog entry.

    Ebooks and the Academy map to their own single PDF. The Pack maps to
    the 6 ebook PDFs it contains (each downloaded via its own course id).
    """
    if c.slug == PACK_SLUG:
        out: list[CourseDownload] = []
        for slug in EBOOK_SLUGS:
            ec = db.query(Course).filter(Course.slug == slug).first()
            if ec is not None and slug in PDF_FILES:
                out.append(
                    CourseDownload(
                        course_id=ec.id, title=ec.title, filename=PDF_FILES[slug]
                    )
                )
        return out
    filename = PDF_FILES.get(c.slug)
    if filename:
        return [CourseDownload(course_id=c.id, title=c.title, filename=filename)]
    return []


def _course_out(db: Session, c: Course) -> CourseOut:
    count = (
        db.query(CourseEnrollment)
        .filter(CourseEnrollment.course_id == c.id)
        .count()
    )
    return CourseOut(
        id=c.id,
        slug=c.slug,
        title=c.title,
        description=c.description or "",
        price_usd=str(c.price_usd),
        kind=c.kind,
        buy_url=c.buy_url or "",
        delivery_note=c.delivery_note or "",
        sort_order=c.sort_order,
        students_count=count,
        downloads=_downloads_for(db, c),
        created_at=c.created_at.isoformat() if c.created_at else None,
        updated_at=c.updated_at.isoformat() if c.updated_at else None,
    )


def _enrollment_out(db: Session, e: CourseEnrollment) -> EnrollmentOut:
    contact = db.get(Contact, e.contact_id)
    course = db.get(Course, e.course_id)
    return EnrollmentOut(
        id=e.id,
        contact_id=e.contact_id,
        course_id=e.course_id,
        contact_name=contact.name if contact else "",
        contact_email=(contact.email or "") if contact else "",
        course_title=course.title if course else "",
        purchased=e.purchased,
        delivered=e.delivered,
        purchased_at=e.purchased_at.isoformat() if e.purchased_at else None,
        delivered_at=e.delivered_at.isoformat() if e.delivered_at else None,
        notes=e.notes or "",
        created_at=e.created_at.isoformat() if e.created_at else None,
        updated_at=e.updated_at.isoformat() if e.updated_at else None,
    )


def _parse_price(value: str) -> Decimal:
    try:
        price = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=422, detail="price_usd must be a number") from None
    if price < 0:
        raise HTTPException(status_code=422, detail="price_usd cannot be negative")
    return price


def _check_kind(value: str) -> str:
    v = (value or "").strip().lower()
    if v not in KINDS:
        raise HTTPException(
            status_code=422, detail=f"kind must be one of: {', '.join(KINDS)}"
        )
    return v


# --------------------------------------------------------------- endpoints --

@router.get("/courses", response_model=list[CourseOut])
def list_courses(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    courses = (
        db.query(Course).order_by(Course.sort_order.asc(), Course.id.asc()).offset(offset).limit(limit).all()
    )
    return [_course_out(db, c) for c in courses]


@router.get("/courses/{course_id}/download")
def download_course_pdf(
    course_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Serve the course's real PDF — authenticated users only (any role).

    404 when the course does not exist or has no single PDF file (the Pack
    is the 6 ebook PDFs, downloaded from each ebook's own entry).
    """
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    filename = PDF_FILES.get(course.slug)
    if not filename:
        raise HTTPException(
            status_code=404,
            detail="Este producto no tiene un PDF único; descarga los PDFs desde cada ebook.",
        )
    path = ensure_pdf_file(filename)
    if path is None:
        raise HTTPException(status_code=404, detail="PDF file not available")
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=filename,
    )


@router.put("/courses/{course_id}", response_model=CourseOut)
def update_course(
    course_id: int,
    payload: CourseUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    if payload.title is not None:
        course.title = payload.title.strip()
    if payload.description is not None:
        course.description = payload.description
    if payload.price_usd is not None:
        course.price_usd = _parse_price(payload.price_usd)
    if payload.kind is not None:
        course.kind = _check_kind(payload.kind)
    if payload.buy_url is not None:
        course.buy_url = payload.buy_url.strip()
    if payload.delivery_note is not None:
        course.delivery_note = payload.delivery_note
    db.commit()
    db.refresh(course)
    return _course_out(db, course)


@router.get("/courses/{course_id}/students", response_model=list[EnrollmentOut])
def list_students(
    course_id: int,
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    rows = (
        db.query(CourseEnrollment)
        .filter(CourseEnrollment.course_id == course_id)
        .order_by(CourseEnrollment.id.desc())
        .offset(offset).limit(limit).all()
    )
    return [_enrollment_out(db, e) for e in rows]


@router.post(
    "/enrollments", response_model=EnrollmentOut, status_code=status.HTTP_201_CREATED
)
def create_enrollment(
    payload: EnrollmentCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    contact = db.get(Contact, payload.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    course = db.get(Course, payload.course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    existing = (
        db.query(CourseEnrollment)
        .filter(
            CourseEnrollment.contact_id == payload.contact_id,
            CourseEnrollment.course_id == payload.course_id,
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="Ese contacto ya está registrado en este curso.",
        )
    now = utcnow()
    enrollment = CourseEnrollment(
        contact_id=payload.contact_id,
        course_id=payload.course_id,
        purchased=payload.purchased,
        delivered=payload.delivered,
        purchased_at=now if payload.purchased else None,
        delivered_at=now if payload.delivered else None,
        notes=payload.notes,
    )
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    return _enrollment_out(db, enrollment)


@router.patch("/enrollments/{enrollment_id}", response_model=EnrollmentOut)
def update_enrollment(
    enrollment_id: int,
    payload: EnrollmentUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    enrollment = db.get(CourseEnrollment, enrollment_id)
    if enrollment is None:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    now = utcnow()
    if payload.purchased is not None and payload.purchased != enrollment.purchased:
        enrollment.purchased = payload.purchased
        enrollment.purchased_at = now if payload.purchased else None
    if payload.delivered is not None and payload.delivered != enrollment.delivered:
        enrollment.delivered = payload.delivered
        enrollment.delivered_at = now if payload.delivered else None
    if payload.notes is not None:
        enrollment.notes = payload.notes
    db.commit()
    db.refresh(enrollment)
    return _enrollment_out(db, enrollment)


@router.delete("/enrollments/{enrollment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_enrollment(
    enrollment_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    enrollment = db.get(CourseEnrollment, enrollment_id)
    if enrollment is None:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    db.delete(enrollment)
    db.commit()
    return None
