"""Inventario — stock control (módulo Inventario, 2026-10-29).

Items with quantity on hand, unit, unit price and a minimum-stock
threshold. `low_stock` is computed (quantity <= min_stock) and never
stored. The list starts EMPTY — the system never invents stock.
Any authenticated user reads; only admins create/update/delete
(require_admin -> 403 for prueba), mirroring the other modules.
"""
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import InventoryItem, User

router = APIRouter(prefix="/api/inventario", tags=["inventario"])

UNITS = ("pieza", "kg", "litro", "metro", "caja", "otro")


class ItemOut(BaseModel):
    id: int
    name: str
    description: str
    sku: str
    quantity: int
    unit: str
    unit_price: float
    min_stock: int
    low_stock: bool
    created_at: str | None = None
    updated_at: str | None = None


class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    sku: str = Field(default="", max_length=64)
    quantity: int = 0
    unit: str = "pieza"
    unit_price: float = 0.0
    min_stock: int = 0


class ItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    sku: str | None = Field(default=None, max_length=64)
    quantity: int | None = None
    unit: str | None = None
    unit_price: float | None = None
    min_stock: int | None = None


def _out(r: InventoryItem) -> ItemOut:
    return ItemOut(
        id=r.id,
        name=r.name,
        description=r.description or "",
        sku=r.sku or "",
        quantity=r.quantity,
        unit=r.unit,
        unit_price=float(r.unit_price),
        min_stock=r.min_stock,
        # Sin mínimo definido (0) no hay alerta: antes un ítem con 0/0
        # aparecía en "stock bajo" aunque el dueño no definió ningún mínimo.
        low_stock=r.min_stock > 0 and r.quantity <= r.min_stock,
        created_at=r.created_at.isoformat() if r.created_at else None,
        updated_at=r.updated_at.isoformat() if r.updated_at else None,
    )


def _validate_unit(unit: str) -> str:
    u = (unit or "").strip().lower()
    if u not in UNITS:
        raise HTTPException(
            status_code=422,
            detail="La unidad debe ser una de: " + ", ".join(UNITS) + ".",
        )
    return u


def _validate_non_negative(value: float | int, label: str) -> None:
    if value < 0:
        raise HTTPException(status_code=422, detail=f"{label} no puede ser negativo.")


def _validate_price(value: float) -> Decimal:
    _validate_non_negative(value, "El precio unitario")
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"))
    except InvalidOperation:
        raise HTTPException(status_code=422, detail="El precio unitario no es válido.")


@router.get("/items", response_model=list[ItemOut])
def list_items(
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(InventoryItem).order_by(InventoryItem.name.asc(), InventoryItem.id.asc()).offset(offset).limit(limit).all()
    return [_out(r) for r in rows]


@router.post("/items", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
def create_item(
    payload: ItemCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="El nombre no puede estar vacío.")
    _validate_non_negative(payload.quantity, "La cantidad")
    _validate_non_negative(payload.min_stock, "El stock mínimo")
    row = InventoryItem(
        name=payload.name.strip(),
        description=payload.description,
        sku=payload.sku.strip(),
        quantity=payload.quantity,
        unit=_validate_unit(payload.unit),
        unit_price=_validate_price(payload.unit_price),
        min_stock=payload.min_stock,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.put("/items/{item_id}", response_model=ItemOut)
def update_item(
    item_id: int,
    payload: ItemUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(InventoryItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Item not found")
    if payload.name is not None:
        if not payload.name.strip():
            raise HTTPException(status_code=422, detail="El nombre no puede estar vacío.")
        row.name = payload.name.strip()
    if payload.description is not None:
        row.description = payload.description
    if payload.sku is not None:
        row.sku = payload.sku.strip()
    if payload.quantity is not None:
        _validate_non_negative(payload.quantity, "La cantidad")
        row.quantity = payload.quantity
    if payload.unit is not None:
        row.unit = _validate_unit(payload.unit)
    if payload.unit_price is not None:
        row.unit_price = _validate_price(payload.unit_price)
    if payload.min_stock is not None:
        _validate_non_negative(payload.min_stock, "El stock mínimo")
        row.min_stock = payload.min_stock
    db.commit()
    db.refresh(row)
    return _out(row)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(InventoryItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(row)
    db.commit()
    return None
