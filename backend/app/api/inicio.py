"""Inicio (Home) — platform news and updates as posts, with comments
(módulo Inicio, 2026-10-29).

- Posts: only admins publish/edit/delete (platform news and updates).
  Any authenticated user reads.
- Comments: any authenticated user comments on any post. A comment can
  be deleted by its own author or by an admin.
- The list starts EMPTY — the system never invents news. The admin
  publishes the first update from the Inicio tab.
- Author names prefer the user's display_name and fall back to the
  username; a deleted author shows as "Usuario".
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import HomeComment, HomePost, User

router = APIRouter(prefix="/api/inicio", tags=["inicio"])


class PostOut(BaseModel):
    id: int
    title: str
    body: str
    author_name: str
    comment_count: int
    created_at: str | None = None
    updated_at: str | None = None


class PostCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = ""


class PostUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body: str | None = None


class CommentOut(BaseModel):
    id: int
    post_id: int
    author_name: str
    body: str
    created_at: str | None = None
    can_delete: bool = False


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


def _author_name(db: Session, user_id: int | None) -> str:
    if user_id is None:
        return "Usuario"
    u = db.get(User, user_id)
    if u is None:
        return "Usuario"
    return (u.display_name or "").strip() or u.username


def _post_out(db: Session, p: HomePost) -> PostOut:
    count = db.query(HomeComment).filter(HomeComment.post_id == p.id).count()
    return PostOut(
        id=p.id,
        title=p.title,
        body=p.body or "",
        author_name=_author_name(db, p.author_id),
        comment_count=count,
        created_at=p.created_at.isoformat() if p.created_at else None,
        updated_at=p.updated_at.isoformat() if p.updated_at else None,
    )


def _comment_out(db: Session, c: HomeComment, me: User) -> CommentOut:
    return CommentOut(
        id=c.id,
        post_id=c.post_id,
        author_name=_author_name(db, c.author_id),
        body=c.body,
        created_at=c.created_at.isoformat() if c.created_at else None,
        can_delete=bool(me.is_admin or (c.author_id is not None and c.author_id == me.id)),
    )


@router.get("/posts", response_model=list[PostOut])
def list_posts(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(HomePost).order_by(HomePost.created_at.desc(), HomePost.id.desc()).all()
    return [_post_out(db, p) for p in rows]


@router.post("/posts", response_model=PostOut, status_code=status.HTTP_201_CREATED)
def create_post(
    payload: PostCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="El título no puede estar vacío.")
    row = HomePost(title=payload.title.strip(), body=payload.body, author_id=admin.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _post_out(db, row)


@router.put("/posts/{post_id}", response_model=PostOut)
def update_post(
    post_id: int,
    payload: PostUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(HomePost, post_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Post not found")
    if payload.title is not None:
        if not payload.title.strip():
            raise HTTPException(status_code=422, detail="El título no puede estar vacío.")
        row.title = payload.title.strip()
    if payload.body is not None:
        row.body = payload.body
    db.commit()
    db.refresh(row)
    return _post_out(db, row)


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_post(
    post_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(HomePost, post_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Post not found")
    db.delete(row)
    db.commit()
    return None


@router.get("/posts/{post_id}/comments", response_model=list[CommentOut])
def list_comments(
    post_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    post = db.get(HomePost, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    rows = (
        db.query(HomeComment)
        .filter(HomeComment.post_id == post_id)
        .order_by(HomeComment.created_at.asc(), HomeComment.id.asc())
        .all()
    )
    return [_comment_out(db, c, user) for c in rows]


@router.post(
    "/posts/{post_id}/comments",
    response_model=CommentOut,
    status_code=status.HTTP_201_CREATED,
)
def create_comment(
    post_id: int,
    payload: CommentCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    post = db.get(HomePost, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    if not payload.body.strip():
        raise HTTPException(status_code=422, detail="El comentario no puede estar vacío.")
    row = HomeComment(post_id=post_id, author_id=user.id, body=payload.body.strip())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _comment_out(db, row, user)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(
    comment_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(HomeComment, comment_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    if not (user.is_admin or (row.author_id is not None and row.author_id == user.id)):
        raise HTTPException(
            status_code=403, detail="Solo el autor o un administrador puede borrar este comentario."
        )
    db.delete(row)
    db.commit()
    return None
