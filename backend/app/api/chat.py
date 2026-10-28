"""Chat en vivo — near-real-time chat for authenticated users.

The panel polls every ~5s: no WebSocket infra, which the Render free
tier does not support well. Any authenticated user (admin or prueba)
can read and post; only admins delete (moderation). Messages are
short (max 500 chars). The chat starts EMPTY — no seed messages.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import ChatMessage, User

router = APIRouter(prefix="/api/chat", tags=["chat"])

MAX_MESSAGES = 100


class ChatMessageOut(BaseModel):
    id: int
    author_username: str
    author_label: str
    text: str
    created_at: str | None = None


class ChatMessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)


def _out(m: ChatMessage) -> ChatMessageOut:
    return ChatMessageOut(
        id=m.id,
        author_username=m.author_username,
        author_label=m.author_label,
        text=m.text,
        created_at=m.created_at.isoformat() if m.created_at else None,
    )


@router.get("/messages", response_model=list[ChatMessageOut])
def list_messages(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(ChatMessage)
        .order_by(ChatMessage.id.desc())
        .limit(MAX_MESSAGES)
        .all()
    )
    return [_out(m) for m in reversed(rows)]


@router.post("/messages", response_model=ChatMessageOut, status_code=status.HTTP_201_CREATED)
def post_message(
    payload: ChatMessageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="El mensaje no puede estar vacío.")
    label = (user.display_name or "").strip() or user.username
    row = ChatMessage(
        user_id=user.id,
        author_username=user.username,
        author_label=label,
        text=text,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(
    message_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(ChatMessage, message_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found")
    db.delete(row)
    db.commit()
    return None
