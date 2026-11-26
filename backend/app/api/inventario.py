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

from app.api.portal import deny_linked_reader
from app.core.security import get_current_user, require_admin
from app.core.perfiles import require_modulo
from app.database import get_db
from app.models.tables import InventoryItem, InventoryMovement, User

router = APIRouter(prefix="/api/inventario", tags=["inventario"], dependencies=[Depends(require_modulo("inventario"))])

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
    # Motivo del cambio de cantidad (Fase 5b, tarea 3): solo alimenta
    # el historial de movimientos; no se guarda en el producto.
    motivo: str | None = Field(default=None, max_length=500)


class MovementOut(BaseModel):
    id: int
    item_id: int
    tipo: str
    cantidad_delta: int
    cantidad_final: int
    motivo: str
    created_at: str | None = None


class MovementCreate(BaseModel):
    # Delta con signo: positivo en entradas, negativo en ventas/salidas.
    tipo: str = "ajuste"
    cantidad: int
    motivo: str = Field(default="", max_length=500)


MOVEMENT_TYPES = ("entrada", "venta", "ajuste")


def _movement_out(m: InventoryMovement) -> MovementOut:
    return MovementOut(
        id=m.id,
        item_id=m.item_id,
        tipo=m.tipo,
        cantidad_delta=m.cantidad_delta,
        cantidad_final=m.cantidad_final,
        motivo=m.motivo or "",
        created_at=m.created_at.isoformat() if m.created_at else None,
    )


def _record_movement(db: Session, item: InventoryItem, tipo: str, delta: int, motivo: str) -> None:
    db.add(
        InventoryMovement(
            item_id=item.id,
            tipo=tipo,
            cantidad_delta=delta,
            cantidad_final=item.quantity,
            motivo=motivo,
        )
    )


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


def _check_sku_unique(db: Session, sku: str, exclude_id: int | None = None) -> None:
    """Non-empty SKUs must be unique (M18). Empty SKU means "no SKU"
    and stays exempt — several items without SKU remain possible, and
    the migration's unique constraint likewise skips duplicates rather
    than breaking when empty SKUs already repeat."""
    if not sku:
        return
    query = db.query(InventoryItem).filter(InventoryItem.sku == sku)
    if exclude_id is not None:
        query = query.filter(InventoryItem.id != exclude_id)
    if query.first() is not None:
        raise HTTPException(status_code=409, detail="SKU already exists")


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
    # S1 (Fase 1 mejoras-v1, tarea 5): cliente vinculado -> 403, como
    # en CRM/facturas/correos. El gate require_modulo del router ya lo
    # bloquea; esto es defensa en profundidad, igual que en el resto
    # de routers de negocio.
    deny_linked_reader(db, user)
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
    _check_sku_unique(db, payload.sku.strip())
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
    # Stock inicial: queda registrado como entrada (sin él, un producto
    # creado con 10 unidades no tendría ningún movimiento en su historial).
    if row.quantity > 0:
        _record_movement(db, row, "entrada", row.quantity, "Stock inicial")
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
        _check_sku_unique(db, payload.sku.strip(), exclude_id=row.id)
        row.sku = payload.sku.strip()
    if payload.quantity is not None:
        _validate_non_negative(payload.quantity, "La cantidad")
        if payload.quantity != row.quantity:
            delta = payload.quantity - row.quantity
            row.quantity = payload.quantity
            _record_movement(
                db, row, "ajuste", delta, (payload.motivo or "").strip() or "Ajuste manual"
            )
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


@router.get("/items/{item_id}/movimientos", response_model=list[MovementOut])
def list_movements(
    item_id: int,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deny_linked_reader(db, user)
    row = db.get(InventoryItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Item not found")
    rows = (
        db.query(InventoryMovement)
        .filter(InventoryMovement.item_id == item_id)
        .order_by(InventoryMovement.created_at.desc(), InventoryMovement.id.desc())
        .offset(offset).limit(limit).all()
    )
    return [_movement_out(m) for m in rows]


@router.post("/items/{item_id}/movimientos", response_model=MovementOut, status_code=status.HTTP_201_CREATED)
def add_movement(
    item_id: int,
    payload: MovementCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Movimiento explícito: aplica el delta al stock y lo registra.

    Una venta es un delta negativo; el stock resultante nunca baja de
    0 (vender más de lo que hay es 422, no un negativo silencioso).
    El tipo debe ser coherente con el signo: venta con delta positivo
    o entrada con delta negativo son 422.
    """
    row = db.get(InventoryItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Item not found")
    tipo = (payload.tipo or "").strip().lower()
    if tipo not in MOVEMENT_TYPES:
        raise HTTPException(
            status_code=422, detail="El tipo debe ser uno de: " + ", ".join(MOVEMENT_TYPES) + "."
        )
    if payload.cantidad == 0:
        raise HTTPException(status_code=422, detail="La cantidad no puede ser 0.")
    if tipo == "venta" and payload.cantidad > 0:
        raise HTTPException(status_code=422, detail="Una venta resta stock: la cantidad debe ser negativa.")
    if tipo == "entrada" and payload.cantidad < 0:
        raise HTTPException(status_code=422, detail="Una entrada suma stock: la cantidad debe ser positiva.")
    nuevo = row.quantity + payload.cantidad
    if nuevo < 0:
        raise HTTPException(status_code=422, detail="No hay suficiente stock para ese movimiento.")
    row.quantity = nuevo
    _record_movement(db, row, tipo, payload.cantidad, payload.motivo.strip() or "Movimiento manual")
    db.commit()
    db.refresh(row)
    mov = (
        db.query(InventoryMovement)
        .filter(InventoryMovement.item_id == item_id)
        .order_by(InventoryMovement.id.desc())
        .first()
    )
    assert mov is not None
    return _movement_out(mov)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(InventoryItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Item not found")
    # El historial se borra con el producto: la FK CASCADE lo cubre en
    # Postgres, pero en SQLite el pragma de FK no está activado, así que
    # se borra explícito para no dejar movimientos huérfanos que un
    # futuro producto reutilizando el id heredaría.
    db.query(InventoryMovement).filter(InventoryMovement.item_id == item_id).delete()
    db.delete(row)
    db.commit()
    return None
