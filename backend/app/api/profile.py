"""User profile — editable fields for the logged-in user (paquete 2026-10-28).

Fields: nombre (display name), correo (email), dirección (address) and
foto (avatar). All optional and empty at first — the system never
invents profile data.

Rules:
- A user edits ONLY their own profile (PUT /me). Admins can VIEW any
  user's profile (GET /users/{id}) but never edit another user's
  profile through this router.
- The photo is a base64 data URL (image/png, jpeg, gif or webp),
  decoded size at most 500 KiB, stored in the DB so it survives the
  free tier's restarts (no disk files). An empty string clears the photo.
- Profile data is never part of trading, auth or money logic.
"""
import base64
import binascii

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import effective_role, get_current_user, require_admin
from app.database import get_db
from app.models.tables import User

router = APIRouter(prefix="/api/profile", tags=["profile"])

MAX_AVATAR_BYTES = 500 * 1024
ALLOWED_AVATAR_MIMES = ("image/png", "image/jpeg", "image/gif", "image/webp")


class ProfileOut(BaseModel):
    id: int
    username: str
    role: str
    is_admin: bool
    display_name: str | None = None
    email: str | None = None
    address: str | None = None
    avatar_data_url: str | None = None
    created_at: str | None = None


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    email: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    avatar_data_url: str | None = None


def _out(u: User, db: Session) -> ProfileOut:
    return ProfileOut(
        id=u.id,
        username=u.username,
        role=effective_role(u, db),
        is_admin=u.is_admin,
        display_name=u.display_name,
        email=u.email,
        address=u.address,
        avatar_data_url=u.avatar_data_url,
        created_at=u.created_at.isoformat() if u.created_at else None,
    )


def _validate_avatar(data_url: str) -> str:
    """Return the data URL unchanged if valid, else raise 422."""
    if not data_url.startswith("data:"):
        raise HTTPException(status_code=422, detail="La foto debe ser una imagen (data URL).")
    try:
        header, b64 = data_url.split(",", 1)
    except ValueError:
        raise HTTPException(status_code=422, detail="La foto no tiene un formato válido.")
    mime = header[len("data:"):].split(";")[0].strip().lower()
    if mime not in ALLOWED_AVATAR_MIMES or ";base64" not in header:
        raise HTTPException(
            status_code=422,
            detail="La foto debe ser PNG, JPEG, GIF o WebP en base64.",
        )
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=422, detail="La foto no es base64 válido.")
    if len(raw) > MAX_AVATAR_BYTES:
        raise HTTPException(
            status_code=422,
            detail="La foto supera los 500 KB permitidos.",
        )
    if len(raw) == 0:
        raise HTTPException(status_code=422, detail="La foto está vacía.")
    return data_url


def _validate_email(email: str) -> str:
    email = email.strip()
    if email and ("@" not in email or "." not in email.split("@")[-1]):
        raise HTTPException(status_code=422, detail="El correo no tiene un formato válido.")
    return email


@router.get("/me", response_model=ProfileOut)
def get_my_profile(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _out(user, db)


@router.put("/me", response_model=ProfileOut)
def update_my_profile(
    payload: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Only provided fields change; an empty string clears that field.
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip() or None
    if payload.email is not None:
        user.email = _validate_email(payload.email) or None
    if payload.address is not None:
        user.address = payload.address.strip() or None
    if payload.avatar_data_url is not None:
        cleaned = payload.avatar_data_url.strip()
        user.avatar_data_url = _validate_avatar(cleaned) if cleaned else None
    db.commit()
    db.refresh(user)
    return _out(user, db)


@router.get("/users/{user_id}", response_model=ProfileOut)
def get_user_profile(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    return _out(target, db)
