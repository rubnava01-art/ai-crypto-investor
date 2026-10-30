"""Recomendaciones — admin-managed recommendations (paquete 2026-10-28).

Recommends Estudiar courses and Crear tools: each entry has a title,
description, link and category (curso|herramienta). The list starts
EMPTY — the system never invents recommendations. Any authenticated
user reads; only admins create/update/delete (require_admin -> 403
for prueba), mirroring the other modules.
"""
from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import Recommendation, User

router = APIRouter(prefix="/api/recomendaciones", tags=["recomendaciones"])

CATEGORIES = ("curso", "herramienta")


class RecommendationOut(BaseModel):
    id: int
    title: str
    description: str
    url: str
    category: str
    created_at: str | None = None
    updated_at: str | None = None


class RecommendationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    url: str = ""
    category: str = "curso"


class RecommendationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    url: str | None = None
    category: str | None = None


def _out(r: Recommendation) -> RecommendationOut:
    return RecommendationOut(
        id=r.id,
        title=r.title,
        description=r.description or "",
        url=r.url or "",
        category=r.category,
        created_at=r.created_at.isoformat() if r.created_at else None,
        updated_at=r.updated_at.isoformat() if r.updated_at else None,
    )


def _validate_category(category: str) -> str:
    c = (category or "").strip().lower()
    if c not in CATEGORIES:
        raise HTTPException(
            status_code=422, detail="La categoría debe ser 'curso' o 'herramienta'."
        )
    return c


def _validate_url(url: str) -> str:
    url = (url or "").strip()
    if url and not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(
            status_code=422, detail="El enlace debe empezar con http:// o https://."
        )
    return url


@router.get("", response_model=list[RecommendationOut])
def list_recommendations(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = db.query(Recommendation).order_by(Recommendation.id).offset(offset).limit(limit).all()
    return [_out(r) for r in rows]


@router.post("", response_model=RecommendationOut, status_code=status.HTTP_201_CREATED)
def create_recommendation(
    payload: RecommendationCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = Recommendation(
        title=payload.title.strip(),
        description=payload.description,
        url=_validate_url(payload.url),
        category=_validate_category(payload.category),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.put("/{rec_id}", response_model=RecommendationOut)
def update_recommendation(
    rec_id: int,
    payload: RecommendationUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(Recommendation, rec_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    if payload.title is not None:
        row.title = payload.title.strip()
    if payload.description is not None:
        row.description = payload.description
    if payload.url is not None:
        row.url = _validate_url(payload.url)
    if payload.category is not None:
        row.category = _validate_category(payload.category)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.delete("/{rec_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recommendation(
    rec_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(Recommendation, rec_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    db.delete(row)
    db.commit()
    return None
