"""Ajustador y videos educativos (2026-11-05).

- Ajustador (/api/ajustes): proposals per section for the 3-agent
  optimization board. The board itself is a management view: the
  agents' real work happens through Swapy in sessions and daily
  improvements; rows here are PROPOSALS, never done work — estado
  moves propuesta -> en_curso -> aplicada only when the work is
  verified. Any authenticated user may READ the board; writes are
  admin-only (require_admin, 403 for prueba).
- Videos educativos (/api/videos): admin-managed YouTube list for
  Estudiar. The URL must be youtube.com/watch or youtu.be (validated
  server-side, 422 otherwise). No video metadata is fetched and no
  thumbnails are invented; the frontend embeds the privacy-enhanced
  player (youtube-nocookie). Everyone reads; only admin adds/removes.

List responses are bare JSON arrays, matching the CRM/inventario
pattern (not {items: [...]}). Both lists start EMPTY.
"""
import datetime as dt
import re
from urllib.parse import urlparse, parse_qs

from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import Ajuste, User, VideoEducativo

ajustes_router = APIRouter(prefix="/api/ajustes", tags=["ajustador"])
videos_router = APIRouter(prefix="/api/videos", tags=["videos"])

# The 24 optimizable sections: every route in ModuleNav except
# /ajustador itself (the board manages the sections, it is not one).
SECCIONES = (
    "inicio",
    "invertir",
    "estudiar",
    "crear",
    "analizador",
    "crm",
    "referidos",
    "business",
    "espacio",
    "facturas",
    "correos",
    "chat",
    "recomendaciones",
    "desarrollo",
    "talento",
    "riesgos",
    "planillas",
    "analisis",
    "tendencias",
    "auditor",
    "privacidad",
    "inventario",
    "perfil",
    "usuarios",
)

# The 3-agent system (AGENT-SYSTEM.md): Agente 1 UI/UX & Frontend,
# Agente 2 Performance & Backend, Agente 3 QA, Seguridad & Calidad.
AGENTES = ("agente1", "agente2", "agente3")
AJUSTE_ESTADOS = ("propuesta", "en_curso", "aplicada")

_YT_ID = re.compile(r"^[A-Za-z0-9_-]+$")
_YT_HOSTS = ("youtube.com", "www.youtube.com", "m.youtube.com")


def _check_enum(value: str, allowed: tuple[str, ...], label: str) -> str:
    v = (value or "").strip().lower()
    if v not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"{label} debe ser uno de: " + ", ".join(allowed) + ".",
        )
    return v


def _validate_youtube_url(value: str) -> str:
    """Accept only youtube.com/watch?v=ID or youtu.be/ID links.

    Returns the trimmed URL. Anything else (other hosts, shorts,
    playlists without a video, missing id) is a 422 — the frontend
    shows the same rule in the form.
    """
    url = (value or "").strip()
    if not url:
        raise HTTPException(status_code=422, detail="La URL no puede estar vacía.")
    try:
        parsed = urlparse(url)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="La URL debe ser un enlace de YouTube (youtube.com/watch o youtu.be).",
        )
    host = (parsed.netloc or "").lower()
    video_id: str | None = None
    if host in _YT_HOSTS:
        if parsed.path != "/watch":
            raise HTTPException(
                status_code=422,
                detail="La URL debe ser un enlace de YouTube (youtube.com/watch o youtu.be).",
            )
        video_id = (parse_qs(parsed.query).get("v") or [None])[0]
    elif host == "youtu.be":
        parts = [p for p in parsed.path.split("/") if p]
        video_id = parts[0] if parts else None
    else:
        raise HTTPException(
            status_code=422,
            detail="La URL debe ser un enlace de YouTube (youtube.com/watch o youtu.be).",
        )
    if not video_id or not _YT_ID.match(video_id):
        raise HTTPException(
            status_code=422,
            detail="La URL debe ser un enlace de YouTube (youtube.com/watch o youtu.be).",
        )
    return url


# ---------------------------------------------------------------- ajustes --

class AjusteOut(BaseModel):
    id: int
    seccion: str
    agente: str
    propuesta: str
    estado: str
    created_at: str | None = None
    updated_at: str | None = None


class AjusteCreate(BaseModel):
    seccion: str = Field(min_length=1, max_length=64)
    agente: str = "agente1"
    propuesta: str = Field(min_length=1, max_length=5000)
    estado: str = "propuesta"


class AjusteUpdate(BaseModel):
    seccion: str | None = Field(default=None, min_length=1, max_length=64)
    agente: str | None = None
    propuesta: str | None = Field(default=None, min_length=1, max_length=5000)
    estado: str | None = None


def _ajuste_out(r: Ajuste) -> AjusteOut:
    return AjusteOut(
        id=r.id,
        seccion=r.seccion,
        agente=r.agente,
        propuesta=r.propuesta,
        estado=r.estado,
        created_at=r.created_at.isoformat() if r.created_at else None,
        updated_at=r.updated_at.isoformat() if r.updated_at else None,
    )


@ajustes_router.get("", response_model=list[AjusteOut])
def list_ajustes(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # Proposals are not sensitive: any authenticated user may read the
    # board (prueba is read-only — writes below require admin).
    rows = db.query(Ajuste).order_by(Ajuste.id.asc()).offset(offset).limit(limit).all()
    return [_ajuste_out(r) for r in rows]


@ajustes_router.post("", response_model=AjusteOut, status_code=status.HTTP_201_CREATED)
def create_ajuste(
    payload: AjusteCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not payload.propuesta.strip():
        raise HTTPException(status_code=422, detail="La propuesta no puede estar vacía.")
    row = Ajuste(
        seccion=_check_enum(payload.seccion, SECCIONES, "La sección"),
        agente=_check_enum(payload.agente, AGENTES, "El agente"),
        propuesta=payload.propuesta.strip(),
        estado=_check_enum(payload.estado, AJUSTE_ESTADOS, "El estado"),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _ajuste_out(row)


@ajustes_router.put("/{ajuste_id}", response_model=AjusteOut)
def update_ajuste(
    ajuste_id: int,
    payload: AjusteUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(Ajuste, ajuste_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Ajuste not found")
    if payload.seccion is not None:
        row.seccion = _check_enum(payload.seccion, SECCIONES, "La sección")
    if payload.agente is not None:
        row.agente = _check_enum(payload.agente, AGENTES, "El agente")
    if payload.propuesta is not None:
        if not payload.propuesta.strip():
            raise HTTPException(status_code=422, detail="La propuesta no puede estar vacía.")
        row.propuesta = payload.propuesta.strip()
    if payload.estado is not None:
        row.estado = _check_enum(payload.estado, AJUSTE_ESTADOS, "El estado")
    db.commit()
    db.refresh(row)
    return _ajuste_out(row)


@ajustes_router.delete("/{ajuste_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ajuste(
    ajuste_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(Ajuste, ajuste_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Ajuste not found")
    db.delete(row)
    db.commit()
    return None


# ----------------------------------------------------------------- videos --

class VideoOut(BaseModel):
    id: int
    url: str
    titulo: str
    added_at: str | None = None


class VideoCreate(BaseModel):
    url: str = Field(min_length=1, max_length=500)
    titulo: str = Field(min_length=1, max_length=200)


class VideoUpdate(BaseModel):
    url: str | None = Field(default=None, min_length=1, max_length=500)
    titulo: str | None = Field(default=None, min_length=1, max_length=200)


def _video_out(r: VideoEducativo) -> VideoOut:
    return VideoOut(
        id=r.id,
        url=r.url,
        titulo=r.titulo,
        added_at=r.added_at.isoformat() if r.added_at else None,
    )


@videos_router.get("", response_model=list[VideoOut])
def list_videos(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(VideoEducativo)
        .order_by(VideoEducativo.id.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_video_out(r) for r in rows]


@videos_router.post("", response_model=VideoOut, status_code=status.HTTP_201_CREATED)
def create_video(
    payload: VideoCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not payload.titulo.strip():
        raise HTTPException(status_code=422, detail="El título no puede estar vacío.")
    row = VideoEducativo(
        url=_validate_youtube_url(payload.url),
        titulo=payload.titulo.strip(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _video_out(row)


@videos_router.put("/{video_id}", response_model=VideoOut)
def update_video(
    video_id: int,
    payload: VideoUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(VideoEducativo, video_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Video not found")
    if payload.url is not None:
        row.url = _validate_youtube_url(payload.url)
    if payload.titulo is not None:
        if not payload.titulo.strip():
            raise HTTPException(status_code=422, detail="El título no puede estar vacío.")
        row.titulo = payload.titulo.strip()
    db.commit()
    db.refresh(row)
    return _video_out(row)


@videos_router.delete("/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_video(
    video_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(VideoEducativo, video_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Video not found")
    db.delete(row)
    db.commit()
    return None
