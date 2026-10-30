"""User management — administrators only. This is the master user control:
approve/reject pending accounts, change roles, set or reset passwords,
and delete users.

Roles (Acceso, 2026-10-26):
- super_admin: everything an admin can do, plus granting/revoking super
  admin status and managing other super admins' accounts. Only a super
  admin can create one, promote to one, or touch one's account.
- admin (is_admin=True): full control — users, settings, scanner, modes,
  kill switch, orders, exchange connections.
- prueba (is_admin=False): view everything and run tests (backtests,
  strategy evaluation, AI assistant) but cannot change any control.

Status (cuentas por aprobar, 2026-10-30, decisión del dueño):
- pending: account created by public registration, not yet approved by
  an admin. It cannot log in (login returns 403) and sees nothing.
  Approving removes the pending row; rejecting deletes the account.
- active: everyone else — admin-created accounts and approved accounts.
  Old accounts have no pending row, so nothing changes for them.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import hash_password, is_super_admin, require_admin
from app.database import get_db
from app.models.tables import PendingActivation, SuperAdminGrant, User

router = APIRouter(prefix="/api/users", tags=["users"])


class UserOut(BaseModel):
    id: int
    username: str
    role: str  # "super_admin" | "admin" | "prueba"
    is_admin: bool
    is_super_admin: bool
    status: str = "active"  # "active" | "pending"
    created_at: str | None = None


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=4, max_length=128)
    role: str = "prueba"  # "super_admin" | "admin" | "prueba"


class UpdateUserRequest(BaseModel):
    role: str | None = None  # "super_admin" | "admin" | "prueba"
    password: str | None = Field(default=None, min_length=4, max_length=128)


def _out(
    u: User,
    db: Session,
    super_flag: bool | None = None,
    pending: bool | None = None,
) -> UserOut:
    if super_flag is None:
        super_flag = is_super_admin(u, db)
    if pending is None:
        pending = (
            db.query(PendingActivation)
            .filter(PendingActivation.user_id == u.id)
            .first()
            is not None
        )
    return UserOut(
        id=u.id,
        username=u.username,
        role="super_admin" if super_flag else ("admin" if u.is_admin else "prueba"),
        is_admin=u.is_admin,
        is_super_admin=super_flag,
        status="pending" if pending else "active",
        created_at=u.created_at.isoformat() if u.created_at else None,
    )


def _set_super(db: Session, user: User, grant: bool) -> None:
    row = (
        db.query(SuperAdminGrant)
        .filter(SuperAdminGrant.user_id == user.id)
        .first()
    )
    if grant and row is None:
        db.add(SuperAdminGrant(user_id=user.id))
    elif not grant and row is not None:
        db.delete(row)


def _role_to_admin(role: str) -> bool:
    r = (role or "").strip().lower()
    if r in ("admin", "administrator", "administrador"):
        return True
    if r in ("prueba", "viewer", "test", "user", "usuario"):
        return False
    raise HTTPException(status_code=422, detail="role must be 'admin' or 'prueba'")


@router.get("", response_model=list[UserOut])
def list_users(
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    rows = db.query(User).order_by(User.id).offset(offset).limit(limit).all()
    # Un solo SELECT de grants y otro de pendientes (antes: uno por usuario).
    grant_ids = (
        {
            g.user_id
            for g in db.query(SuperAdminGrant)
            .filter(SuperAdminGrant.user_id.in_([u.id for u in rows]))
            .all()
        }
        if rows
        else set()
    )
    pending_ids = (
        {
            p.user_id
            for p in db.query(PendingActivation)
            .filter(PendingActivation.user_id.in_([u.id for u in rows]))
            .all()
        }
        if rows
        else set()
    )
    return [
        _out(u, db, super_flag=(u.id in grant_ids), pending=(u.id in pending_ids))
        for u in rows
    ]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: CreateUserRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    username = payload.username.strip()
    if db.query(User).filter(User.username == username).first() is not None:
        raise HTTPException(status_code=409, detail="Username already exists")
    want_super = (payload.role or "").strip().lower() == "super_admin"
    if want_super and not is_super_admin(admin, db):
        raise HTTPException(
            status_code=403, detail="Only a super admin can create a super admin"
        )
    user = User(
        username=username,
        password_hash=hash_password(payload.password),
        is_admin=True if want_super else _role_to_admin(payload.role),
    )
    db.add(user)
    db.flush()
    if want_super:
        _set_super(db, user, True)
    db.commit()
    db.refresh(user)
    return _out(user, db)


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
    caller_super = is_super_admin(admin, db)
    target_super = is_super_admin(user, db)
    if target_super and not caller_super:
        raise HTTPException(
            status_code=403, detail="Only a super admin can change a super admin's account"
        )
    if payload.role is not None:
        want_super = payload.role.strip().lower() == "super_admin"
        if want_super and not caller_super:
            raise HTTPException(
                status_code=403, detail="Only a super admin can grant super admin status"
            )
        if user.id == admin.id and target_super and not want_super:
            raise HTTPException(
                status_code=400, detail="You cannot remove your own super admin status"
            )
        if want_super:
            user.is_admin = True
            _set_super(db, user, True)
        else:
            new_admin = _role_to_admin(payload.role)
            if user.id == admin.id and not new_admin:
                raise HTTPException(status_code=400, detail="You cannot remove your own admin role")
            if user.is_admin and not new_admin:
                admins = db.query(User).filter(User.is_admin.is_(True)).count()
                if admins <= 1:
                    raise HTTPException(status_code=400, detail="Cannot demote the last admin")
            _set_super(db, user, False)
            user.is_admin = new_admin
    if payload.password:
        user.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(user)
    return _out(user, db)


@router.post("/{user_id}/approve", response_model=UserOut)
def approve_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Approve a pending account: it can log in from now on. Any admin
    can approve (user management is admin-level); super admin exclusivity
    applies only to super admin accounts, and pending accounts are never
    super admins when created."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    row = (
        db.query(PendingActivation)
        .filter(PendingActivation.user_id == user.id)
        .first()
    )
    if row is None:
        raise HTTPException(
            status_code=409, detail="User is not pending activation"
        )
    db.delete(row)
    db.commit()
    db.refresh(user)
    return _out(user, db)


@router.post("/{user_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
def reject_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Reject a pending account: the account is deleted, it never entered.
    Refused for admin/super accounts (a pending account should never be
    one, but an admin could have promoted it before rejecting)."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    row = (
        db.query(PendingActivation)
        .filter(PendingActivation.user_id == user.id)
        .first()
    )
    if row is None:
        raise HTTPException(
            status_code=409, detail="User is not pending activation"
        )
    if user.is_admin or is_super_admin(user, db):
        raise HTTPException(
            status_code=400,
            detail="Cannot reject an admin account; demote it first",
        )
    db.delete(row)
    db.delete(user)
    db.commit()
    return None


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
    if is_super_admin(user, db):
        if not is_super_admin(admin, db):
            raise HTTPException(
                status_code=403, detail="Only a super admin can delete a super admin"
            )
        if db.query(SuperAdminGrant).count() <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last super admin")
    if user.is_admin:
        admins = db.query(User).filter(User.is_admin.is_(True)).count()
        if admins <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin")
    _set_super(db, user, False)  # explicit: SQLite may not enforce the FK cascade
    pending = (
        db.query(PendingActivation)
        .filter(PendingActivation.user_id == user.id)
        .first()
    )
    if pending is not None:
        db.delete(pending)
    db.delete(user)
    db.commit()
    return None
