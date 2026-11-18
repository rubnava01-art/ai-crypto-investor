"""Nest Content Engine — dentro de Negocio > Marketing (NEST 2026-11-17).

Paraguas: /api/business/marketing/contenido (plan conjunto §3.3).

- Banco de ideas (`ContentIdea`), plantillas por REGLAS
  (`ContentTemplate`) y calendario (`ContentItem`).
- `POST /generar-desde-plantilla` NO llama al modelo de IA, NO
  persiste nada y NO usa `demo`: sustitución por reglas sobre el
  cuerpo de la plantilla y respuesta con `source: "plantilla"` +
  etiqueta "Plantilla (reglas), no IA".
- La generación CON IA se reutiliza tal cual en
  `POST /api/crear/copies/generate` (con su flag `demo` del stub);
  este módulo no lo modifica ni lo duplica.
"""
import datetime as dt
import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.portal import (
    BRIEF_FIELDS,
    BriefUpdate,
    brief_out,
    deny_linked_reader,
    linked_contact_for,
    upsert_brief,
)
from app.core.hardening import audit
from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import (
    BrandBrief,
    ContentIdea,
    ContentItem,
    ContentTemplate,
    CopyDraft,
    TrendNote,
    Contact,
    User,
)

router = APIRouter(prefix="/api/business/marketing/contenido", tags=["contenido-nest"])

PLATFORMS = ("instagram", "threads", "facebook")
IDEA_SOURCES = ("manual", "tendencia", "cliente")
IDEA_STATUSES = ("idea", "en_produccion", "descartada")
ITEM_STATUSES = ("borrador", "programado", "publicado")

TEMPLATE_VARS = ("tema", "negocio", "llamada")
_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")
ETIQUETA_PLANTILLA = "Plantilla (reglas), no IA"


# ------------------------------------------------------------------ helpers --

def _iso(value: dt.datetime | None) -> str | None:
    """ISO con offset: SQLite devuelve datetimes naive al leer; se
    asumen UTC (todo se guarda en UTC). En Postgres el offset ya viene."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.isoformat()


def _check(value: str, allowed: tuple[str, ...], field: str) -> str:
    v = (value or "").strip().lower()
    if v not in allowed:
        raise HTTPException(
            status_code=422, detail=f"{field} must be one of: {', '.join(allowed)}"
        )
    return v


def _validate_template_vars(body: str) -> None:
    for var in _VAR_RE.findall(body or ""):
        if var not in TEMPLATE_VARS:
            raise HTTPException(
                status_code=422,
                detail=f"unknown template variable {{{{{var}}}}}; "
                f"allowed: {{{{tema}}}}, {{{{negocio}}}}, {{{{llamada}}}}",
            )


def _fk_or_404(db: Session, model, fk_id: int | None, label: str):
    if fk_id is None:
        return
    if db.get(model, fk_id) is None:
        raise HTTPException(status_code=404, detail=f"{label} not found")


def _idea_out(i: ContentIdea) -> dict:
    return {
        "id": i.id,
        "title": i.title,
        "notes": i.notes or "",
        "source": i.source,
        "status": i.status,
        "trend_note_id": i.trend_note_id,
        "contact_id": i.contact_id,
        "created_at": _iso(i.created_at),
        "updated_at": _iso(i.updated_at),
    }


def _template_out(t: ContentTemplate) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "platform": t.platform,
        "tone": t.tone,
        "body": t.body,
        "max_chars": t.max_chars,
        "etiqueta": ETIQUETA_PLANTILLA,
        "created_at": _iso(t.created_at),
        "updated_at": _iso(t.updated_at),
    }


def _item_out(i: ContentItem) -> dict:
    return {
        "id": i.id,
        "title": i.title,
        "text": i.text or "",
        "scheduled_at": _iso(i.scheduled_at),
        "platform": i.platform,
        "status": i.status,
        "idea_id": i.idea_id,
        "copy_draft_id": i.copy_draft_id,
        "template_id": i.template_id,
        "contact_id": i.contact_id,
        "notes": i.notes or "",
        "created_at": _iso(i.created_at),
        "updated_at": _iso(i.updated_at),
    }


# ------------------------------------------------------------------ schemas --

class IdeaCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    notes: str = Field(default="", max_length=5000)
    source: str = "manual"
    status: str = "idea"
    trend_note_id: int | None = None
    contact_id: int | None = None


class IdeaUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=5000)
    source: str | None = None
    status: str | None = None
    trend_note_id: int | None = None
    contact_id: int | None = None


class TemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    platform: str = "instagram"
    tone: str = Field(default="directo", max_length=32)
    body: str = Field(min_length=1, max_length=10000)
    max_chars: int | None = Field(default=None, gt=0)


class TemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    platform: str | None = None
    tone: str | None = Field(default=None, max_length=32)
    body: str | None = Field(default=None, min_length=1, max_length=10000)
    max_chars: int | None = Field(default=None, gt=0)


class GenerateFromTemplateIn(BaseModel):
    template_id: int
    variables: dict[str, str] = Field(default_factory=dict)


class ItemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(default="", max_length=10000)
    scheduled_at: dt.datetime
    platform: str = "instagram"
    status: str = "borrador"
    idea_id: int | None = None
    copy_draft_id: int | None = None
    template_id: int | None = None
    contact_id: int | None = None
    notes: str = Field(default="", max_length=5000)

    @field_validator("scheduled_at")
    @classmethod
    def _require_tz(cls, v: dt.datetime) -> dt.datetime:
        if v.tzinfo is None:
            raise ValueError("scheduled_at must include a timezone offset")
        return v


class ItemUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    text: str | None = Field(default=None, max_length=10000)
    scheduled_at: dt.datetime | None = None
    platform: str | None = None
    status: str | None = None
    idea_id: int | None = None
    copy_draft_id: int | None = None
    template_id: int | None = None
    contact_id: int | None = None
    notes: str | None = Field(default=None, max_length=5000)

    @field_validator("scheduled_at")
    @classmethod
    def _require_tz(cls, v: dt.datetime | None) -> dt.datetime | None:
        if v is not None and v.tzinfo is None:
            raise ValueError("scheduled_at must include a timezone offset")
        return v


# ------------------------------------------------------------------- ideas --

@router.get("/ideas")
def list_ideas(
    status_filter: str | None = Query(default=None, alias="status"),
    contact_id: int | None = Query(default=None),
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # D-01 (2026-11-17): un cliente vinculado solo ve sus ideas. El
    # filtro se fuerza en servidor y el `?contact_id=` se ignora para
    # él; las filas con contact_id NULL (contenido del negocio sin
    # cliente) tampoco las ve. Admin ve todo (con ?contact_id=
    # respetado); no-admin sin vínculo (prueba) sin cambios (D3).
    query = db.query(ContentIdea)
    if status_filter:
        query = query.filter(
            ContentIdea.status == _check(status_filter, IDEA_STATUSES, "status")
        )
    own = linked_contact_for(db, user)
    if own is not None:
        query = query.filter(ContentIdea.contact_id == own.id)
    elif contact_id is not None:
        query = query.filter(ContentIdea.contact_id == contact_id)
    rows = query.order_by(ContentIdea.id.desc()).offset(offset).limit(limit).all()
    return [_idea_out(i) for i in rows]


@router.post("/ideas", status_code=status.HTTP_201_CREATED)
def create_idea(
    payload: IdeaCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    source = _check(payload.source, IDEA_SOURCES, "source")
    status_value = _check(payload.status, IDEA_STATUSES, "status")
    _fk_or_404(db, TrendNote, payload.trend_note_id, "Trend note")
    _fk_or_404(db, Contact, payload.contact_id, "Contact")
    idea = ContentIdea(
        title=payload.title.strip(),
        notes=payload.notes,
        source=source,
        status=status_value,
        trend_note_id=payload.trend_note_id,
        contact_id=payload.contact_id,
    )
    db.add(idea)
    db.flush()
    audit(db, admin, "contenido.ideas.create", "content_idea", str(idea.id),
          details={"title": idea.title})
    db.refresh(idea)
    return _idea_out(idea)


@router.put("/ideas/{idea_id}")
def update_idea(
    idea_id: int,
    payload: IdeaUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    idea = db.get(ContentIdea, idea_id)
    if idea is None:
        raise HTTPException(status_code=404, detail="Idea not found")
    if payload.title is not None:
        idea.title = payload.title.strip()
    if payload.notes is not None:
        idea.notes = payload.notes
    if payload.source is not None:
        idea.source = _check(payload.source, IDEA_SOURCES, "source")
    if payload.status is not None:
        idea.status = _check(payload.status, IDEA_STATUSES, "status")
    if payload.trend_note_id is not None:
        _fk_or_404(db, TrendNote, payload.trend_note_id, "Trend note")
        idea.trend_note_id = payload.trend_note_id
    if payload.contact_id is not None:
        _fk_or_404(db, Contact, payload.contact_id, "Contact")
        idea.contact_id = payload.contact_id
    db.flush()
    audit(db, admin, "contenido.ideas.update", "content_idea", str(idea.id),
          details={"title": idea.title})
    db.refresh(idea)
    return _idea_out(idea)


@router.delete("/ideas/{idea_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_idea(
    idea_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    idea = db.get(ContentIdea, idea_id)
    if idea is None:
        raise HTTPException(status_code=404, detail="Idea not found")
    audit(db, admin, "contenido.ideas.delete", "content_idea", str(idea.id),
          details={"title": idea.title})
    db.delete(idea)
    db.commit()
    return None


# --------------------------------------------------------------- plantillas --

@router.get("/plantillas")
def list_templates(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # S1 (2026-11-17): cliente vinculado -> 403 (ver portal.py).
    # Las plantillas no tienen contact_id (QA #2 / D-01 bis pendiente:
    # globales por diseño o por cliente): mientras se decide, el
    # cliente vinculado no las lee por esta ruta no-portal.
    deny_linked_reader(db, user)
    rows = (
        db.query(ContentTemplate)
        .order_by(ContentTemplate.id.desc()).offset(offset).limit(limit).all()
    )
    return [_template_out(t) for t in rows]


@router.post("/plantillas", status_code=status.HTTP_201_CREATED)
def create_template(
    payload: TemplateCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    platform = _check(payload.platform, PLATFORMS, "platform")
    _validate_template_vars(payload.body)
    template = ContentTemplate(
        name=payload.name.strip(),
        platform=platform,
        tone=payload.tone.strip() or "directo",
        body=payload.body,
        max_chars=payload.max_chars,
    )
    db.add(template)
    db.flush()
    audit(db, admin, "contenido.plantillas.create", "content_template",
          str(template.id), details={"name": template.name})
    db.refresh(template)
    return _template_out(template)


@router.put("/plantillas/{template_id}")
def update_template(
    template_id: int,
    payload: TemplateUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    template = db.get(ContentTemplate, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    if payload.name is not None:
        template.name = payload.name.strip()
    if payload.platform is not None:
        template.platform = _check(payload.platform, PLATFORMS, "platform")
    if payload.tone is not None:
        template.tone = payload.tone.strip() or "directo"
    if payload.body is not None:
        _validate_template_vars(payload.body)
        template.body = payload.body
    if payload.max_chars is not None:
        template.max_chars = payload.max_chars
    db.flush()
    audit(db, admin, "contenido.plantillas.update", "content_template",
          str(template.id), details={"name": template.name})
    db.refresh(template)
    return _template_out(template)


@router.delete("/plantillas/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    template = db.get(ContentTemplate, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    audit(db, admin, "contenido.plantillas.delete", "content_template",
          str(template.id), details={"name": template.name})
    db.delete(template)
    db.commit()
    return None


@router.post("/generar-desde-plantilla")
def generate_from_template(
    payload: GenerateFromTemplateIn,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Generación por REGLAS desde una plantilla: sustitución de
    variables, sin llamar al modelo de IA, sin persistir nada.
    `tema` es obligatorio; `negocio` y `llamada` opcionales (vacío si
    no se pasan). Variable desconocida en `variables` -> 422."""
    template = db.get(ContentTemplate, payload.template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    variables = payload.variables or {}
    for key in variables:
        if key not in TEMPLATE_VARS:
            raise HTTPException(
                status_code=422, detail=f"unknown variable '{key}'"
            )
    tema = (variables.get("tema") or "").strip()
    if not tema:
        raise HTTPException(status_code=422, detail="variables.tema is required")
    values = {
        "tema": tema,
        "negocio": (variables.get("negocio") or "").strip(),
        "llamada": (variables.get("llamada") or "").strip(),
    }

    def _sub(match: re.Match) -> str:
        return values.get(match.group(1), "")

    text = _VAR_RE.sub(_sub, template.body)
    truncated = False
    if template.max_chars is not None and len(text) > template.max_chars:
        text = text[: template.max_chars]
        truncated = True
    return {
        "text": text,
        "source": "plantilla",
        "etiqueta": ETIQUETA_PLANTILLA,
        "template_id": template.id,
        "platform": template.platform,
        "tone": template.tone,
        "truncated": truncated,
    }


# --------------------------------------------------------------- calendario --

@router.get("/calendario")
def list_calendar(
    from_day: str | None = Query(default=None, alias="from"),
    to_day: str | None = Query(default=None, alias="to"),
    platform: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # from/to obligatorios (máx. 93 días, vista mes/semana).
    if not from_day or not to_day:
        raise HTTPException(
            status_code=422, detail="from and to are required (YYYY-MM-DD)"
        )
    try:
        start_day = dt.date.fromisoformat(from_day.strip())
        end_day = dt.date.fromisoformat(to_day.strip())
    except ValueError:
        raise HTTPException(
            status_code=422, detail="from/to must be YYYY-MM-DD"
        ) from None
    if end_day < start_day:
        raise HTTPException(status_code=422, detail="to must be on or after from")
    if (end_day - start_day).days > 93:
        raise HTTPException(
            status_code=422, detail="date range must be at most 93 days"
        )
    start = dt.datetime.combine(start_day, dt.time.min, tzinfo=dt.timezone.utc)
    end = dt.datetime.combine(
        end_day + dt.timedelta(days=1), dt.time.min, tzinfo=dt.timezone.utc
    )
    query = db.query(ContentItem).filter(
        ContentItem.scheduled_at >= start, ContentItem.scheduled_at < end
    )
    # D-01 (2026-11-17): igual que en /ideas — cliente vinculado solo
    # ve sus ítems (contact_id NULL invisible para él); admin ve todo;
    # no-admin sin vínculo sin cambios (D3).
    own = linked_contact_for(db, user)
    if own is not None:
        query = query.filter(ContentItem.contact_id == own.id)
    if platform:
        query = query.filter(
            ContentItem.platform == _check(platform, PLATFORMS, "platform")
        )
    if status_filter:
        query = query.filter(
            ContentItem.status == _check(status_filter, ITEM_STATUSES, "status")
        )
    rows = (
        query.order_by(ContentItem.scheduled_at.asc())
        .offset(offset).limit(limit).all()
    )
    return [_item_out(i) for i in rows]


@router.post("/calendario", status_code=status.HTTP_201_CREATED)
def create_calendar_item(
    payload: ItemCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    platform = _check(payload.platform, PLATFORMS, "platform")
    status_value = _check(payload.status, ITEM_STATUSES, "status")
    _fk_or_404(db, ContentIdea, payload.idea_id, "Idea")
    _fk_or_404(db, CopyDraft, payload.copy_draft_id, "Copy draft")
    _fk_or_404(db, ContentTemplate, payload.template_id, "Template")
    _fk_or_404(db, Contact, payload.contact_id, "Contact")
    item = ContentItem(
        title=payload.title.strip(),
        text=payload.text,
        scheduled_at=payload.scheduled_at.astimezone(dt.timezone.utc),
        platform=platform,
        status=status_value,
        idea_id=payload.idea_id,
        copy_draft_id=payload.copy_draft_id,
        template_id=payload.template_id,
        contact_id=payload.contact_id,
        notes=payload.notes,
    )
    db.add(item)
    db.flush()
    audit(db, admin, "contenido.calendario.create", "content_item",
          str(item.id), details={"title": item.title})
    db.refresh(item)
    return _item_out(item)


@router.patch("/calendario/{item_id}")
def update_calendar_item(
    item_id: int,
    payload: ItemUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    item = db.get(ContentItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Calendar item not found")
    if payload.status is not None:
        target = _check(payload.status, ITEM_STATUSES, "status")
        # `publicado` es terminal: nunca se retrocede desde publicado.
        if item.status == "publicado" and target != "publicado":
            raise HTTPException(
                status_code=422,
                detail="cannot move calendar item from publicado to "
                f"{target}",
            )
        item.status = target
    if payload.title is not None:
        item.title = payload.title.strip()
    if payload.text is not None:
        item.text = payload.text
    if payload.scheduled_at is not None:
        item.scheduled_at = payload.scheduled_at.astimezone(dt.timezone.utc)
    if payload.platform is not None:
        item.platform = _check(payload.platform, PLATFORMS, "platform")
    if payload.idea_id is not None:
        _fk_or_404(db, ContentIdea, payload.idea_id, "Idea")
        item.idea_id = payload.idea_id
    if payload.copy_draft_id is not None:
        _fk_or_404(db, CopyDraft, payload.copy_draft_id, "Copy draft")
        item.copy_draft_id = payload.copy_draft_id
    if payload.template_id is not None:
        _fk_or_404(db, ContentTemplate, payload.template_id, "Template")
        item.template_id = payload.template_id
    if payload.contact_id is not None:
        _fk_or_404(db, Contact, payload.contact_id, "Contact")
        item.contact_id = payload.contact_id
    if payload.notes is not None:
        item.notes = payload.notes
    db.flush()
    audit(db, admin, "contenido.calendario.update", "content_item",
          str(item.id), details={"status": item.status})
    db.refresh(item)
    return _item_out(item)


@router.delete("/calendario/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_calendar_item(
    item_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    item = db.get(ContentItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Calendar item not found")
    audit(db, admin, "contenido.calendario.delete", "content_item",
          str(item.id), details={"title": item.title})
    db.delete(item)
    db.commit()
    return None


# ------------------------------------------------------- brief de marca ----

@router.get("/briefs")
def list_briefs(
    admin: User = Depends(require_admin),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Admin: progreso del brief por cliente (un registro por
    contacto; sin fila guardada, 0/8). El punto de partida del
    Content Engine: desde aquí se elige el cliente cuyo brief
    alimenta la generación."""
    contacts = (
        db.query(Contact)
        .order_by(Contact.id.asc())
        .offset(offset).limit(limit).all()
    )
    # S4 (QA #11, 2026-11-17): filtrar los briefs por los contact_id
    # de la página en vez de cargar todos con .all().
    page_ids = [c.id for c in contacts]
    briefs = (
        {
            b.contact_id: b
            for b in db.query(BrandBrief)
            .filter(BrandBrief.contact_id.in_(page_ids))
            .all()
        }
        if page_ids
        else {}
    )
    out = []
    for contact in contacts:
        summary = brief_out(briefs.get(contact.id), contact)
        out.append(
            {
                "contact_id": contact.id,
                "contact_name": contact.name,
                "answered": summary["answered"],
                "missing": summary["missing"],
                "updated_at": summary["updated_at"],
            }
        )
    return out


@router.get("/briefs/{contact_id}")
def get_brief(
    contact_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin: brief completo de un cliente (respuestas vacías si no
    hay fila guardada). 404 si el contacto no existe."""
    contact = db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    brief = (
        db.query(BrandBrief)
        .filter(BrandBrief.contact_id == contact.id)
        .first()
    )
    return brief_out(brief, contact)


@router.put("/briefs/{contact_id}")
def put_brief(
    contact_id: int,
    payload: BriefUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin: guarda (parcial o completo) el brief de un cliente.
    Q2 con != 3 palabras avisa en la respuesta, nunca bloquea."""
    contact = db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    brief = upsert_brief(db, contact, payload)
    db.flush()
    audit(db, admin, "contenido.brief.update", "brand_brief",
          str(contact.id), details={"contact_id": contact.id})
    db.refresh(brief)
    return brief_out(brief, contact)
