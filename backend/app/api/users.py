"""User management — administrators only.

Roles:
- admin (is_admin=True): full control — users, settings, scanner, modes,
  kill switch, orders, exchange connections.
- prueba (is_admin=False): view everything and run tests (backtests,
  strategy evaluation, AI assistant) but cannot change any control.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import hash_password, require_admin
from app.database import get_db
from app.models.tables import User

router = APIRouter(prefix="/api/users", tags=["users"])


class UserOut(BaseModel):
    id: int
    username: str
    role: str  # "admin" | "prueba"
    is_admin: bool
    created_at: str | None = None


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=4, max_length=128)
    role: str = "prueba"  # "admin" | "prueba"


class UpdateUserRequest(BaseModel):
    role: str | None = None  # "admin" | "prueba"
    password: str | None = Field(default=None, min_length=4, max_length=128)


def _out(u: User) -> UserOut:
    return UserOut(
        id=u.id,
        username=u.username,
        role="admin" if u.is_admin else "prueba",
        is_admin=u.is_admin,
        created_at=u.created_at.isoformat() if u.created_at else None,
    )


def _role_to_admin(role: str) -> bool:
    r = (role or "").strip().lower()
    if r in ("admin", "administrator", "administrador"):
        return True
    if r in ("prueba", "viewer", "test", "user", "usuario"):
        return False
    raise HTTPException(status_code=422, detail="role must be 'admin' or 'prueba'")


@router.get("", response_model=list[UserOut])
def list_users(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return [_out(u) for u in db.query(User).order_by(User.id).all()]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: CreateUserRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    username = payload.username.strip()
    if db.query(User).filter(User.username == username).first() is not None:
        raise HTTPException(status_code=409, detail="Username already exists")
    user = User(
        username=username,
        password_hash=hash_password(payload.password),
        is_admin=_role_to_admin(payload.role),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _out(user)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.role is not None:
        new_admin = _role_to_admin(payload.role)
        if user.id == admin.id and not new_admin:
            raise HTTPException(status_code=400, detail="You cannot remove your own admin role")
        if user.is_admin and not new_admin:
            admins = db.query(User).filter(User.is_admin.is_(True)).count()
            if admins <= 1:
                raise HTTPException(status_code=400, detail="Cannot demote the last admin")
        user.is_admin = new_admin
    if payload.password:
        user.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(user)
    return _out(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    if user.is_admin:
        admins = db.query(User).filter(User.is_admin.is_(True)).count()
        if admins <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin")
    db.delete(user)
    db.commit()
    return None
