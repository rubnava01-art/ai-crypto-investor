"""Talento humano, gestión de riesgos y planillas (2026-11-04).

Three record-keeping modules, no money movement anywhere:

- Talento humano (/api/talento): staff roster. NO SSN, NO bank-account
  fields — deliberately absent. Personal data: prueba sees an EMPTY
  list (same pattern as Espacio revelations/emotions, decisión 6).
- Gestión de riesgos (/api/riesgos): risk register. Any authenticated
  user may READ; writes are admin-only.
- Planillas (/api/planillas): payroll RECORDS only — monto is a stored
  amount, empleado_nombre a display snapshot stored at creation. No
  payments, no tax computation. Sensitive data: prueba sees an EMPTY
  list, same as talento.

All writes (POST/PUT/DELETE) on all three modules require_admin
(-> 403 for prueba), mirroring academy.py / inventario.py. List
responses are bare JSON arrays, matching the CRM/inventario pattern
(not {items: [...]}). All three lists start EMPTY — the system never
invents staff, risks, or payroll records.
"""
import datetime as dt
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import Empleado, Planilla, Riesgo, User

talento_router = APIRouter(prefix="/api/talento", tags=["talento"])
riesgos_router = APIRouter(prefix="/api/riesgos", tags=["riesgos"])
planillas_router = APIRouter(prefix="/api/planillas", tags=["planillas"])

EMPLEADO_ESTADOS = ("activo", "inactivo")
RIESGO_PROBABILIDADES = ("baja", "media", "alta")
RIESGO_IMPACTOS = ("bajo", "medio", "alto")
RIESGO_ESTADOS = ("abierto", "en_curso", "mitigado", "cerrado")
PLANILLA_ESTADOS = ("pendiente", "pagado")


def _check_enum(value: str, allowed: tuple[str, ...], label: str) -> str:
    v = (value or "").strip().lower()
    if v not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"{label} debe ser uno de: " + ", ".join(allowed) + ".",
        )
    return v


def _validate_monto(value: float) -> Decimal:
    if value < 0:
        raise HTTPException(status_code=422, detail="El monto no puede ser negativo.")
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"))
    except InvalidOperation:
        raise HTTPException(status_code=422, detail="El monto no es válido.")


# ---------------------------------------------------------------- talento --

class EmpleadoOut(BaseModel):
    id: int
    nombre: str
    puesto: str
    contacto: str
    fecha_ingreso: str | None = None
    estado: str
    notas: str
    created_at: str | None = None
    updated_at: str | None = None


class EmpleadoCreate(BaseModel):
    nombre: str = Field(min_length=1, max_length=200)
    puesto: str = Field(default="", max_length=200)
    contacto: str = Field(default="", max_length=255)
    fecha_ingreso: dt.date | None = None
    estado: str = "activo"
    notas: str = Field(default="", max_length=5000)


class EmpleadoUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=200)
    puesto: str | None = Field(default=None, max_length=200)
    contacto: str | None = Field(default=None, max_length=255)
    fecha_ingreso: dt.date | None = None
    estado: str | None = None
    notas: str | None = Field(default=None, max_length=5000)


def _emp_out(r: Empleado) -> EmpleadoOut:
    return EmpleadoOut(
        id=r.id,
        nombre=r.nombre,
        puesto=r.puesto or "",
        contacto=r.contacto or "",
        fecha_ingreso=r.fecha_ingreso.isoformat() if r.fecha_ingreso else None,
        estado=r.estado,
        notas=r.notas or "",
        created_at=r.created_at.isoformat() if r.created_at else None,
        updated_at=r.updated_at.isoformat() if r.updated_at else None,
    )


@talento_router.get("", response_model=list[EmpleadoOut])
def list_empleados(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # Personal data of the owner: prueba sees nothing (empty list, no
    # counts that could leak anything), same as Espacio.
    if not user.is_admin:
        return []
    rows = db.query(Empleado).order_by(Empleado.id.asc()).offset(offset).limit(limit).all()
    return [_emp_out(r) for r in rows]


@talento_router.post("", response_model=EmpleadoOut, status_code=status.HTTP_201_CREATED)
def create_empleado(
    payload: EmpleadoCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not payload.nombre.strip():
        raise HTTPException(status_code=422, detail="El nombre no puede estar vacío.")
    row = Empleado(
        nombre=payload.nombre.strip(),
        puesto=payload.puesto.strip(),
        contacto=payload.contacto.strip(),
        fecha_ingreso=payload.fecha_ingreso,
        estado=_check_enum(payload.estado, EMPLEADO_ESTADOS, "El estado"),
        notas=payload.notas,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _emp_out(row)


@talento_router.put("/{empleado_id}", response_model=EmpleadoOut)
def update_empleado(
    empleado_id: int,
    payload: EmpleadoUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(Empleado, empleado_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Empleado not found")
    if payload.nombre is not None:
        if not payload.nombre.strip():
            raise HTTPException(status_code=422, detail="El nombre no puede estar vacío.")
        row.nombre = payload.nombre.strip()
    if payload.puesto is not None:
        row.puesto = payload.puesto.strip()
    if payload.contacto is not None:
        row.contacto = payload.contacto.strip()
    if payload.fecha_ingreso is not None:
        row.fecha_ingreso = payload.fecha_ingreso
    if payload.estado is not None:
        row.estado = _check_enum(payload.estado, EMPLEADO_ESTADOS, "El estado")
    if payload.notas is not None:
        row.notas = payload.notas
    db.commit()
    db.refresh(row)
    return _emp_out(row)


@talento_router.delete("/{empleado_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_empleado(
    empleado_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(Empleado, empleado_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Empleado not found")
    db.delete(row)
    db.commit()
    return None


# ---------------------------------------------------------------- riesgos --

class RiesgoOut(BaseModel):
    id: int
    riesgo: str
    descripcion: str
    probabilidad: str
    impacto: str
    mitigacion: str
    responsable: str
    estado: str
    created_at: str | None = None
    updated_at: str | None = None


class RiesgoCreate(BaseModel):
    riesgo: str = Field(min_length=1, max_length=200)
    descripcion: str = Field(default="", max_length=5000)
    probabilidad: str = "media"
    impacto: str = "medio"
    mitigacion: str = Field(default="", max_length=5000)
    responsable: str = Field(default="", max_length=200)
    estado: str = "abierto"


class RiesgoUpdate(BaseModel):
    riesgo: str | None = Field(default=None, min_length=1, max_length=200)
    descripcion: str | None = Field(default=None, max_length=5000)
    probabilidad: str | None = None
    impacto: str | None = None
    mitigacion: str | None = Field(default=None, max_length=5000)
    responsable: str | None = Field(default=None, max_length=200)
    estado: str | None = None


def _riesgo_out(r: Riesgo) -> RiesgoOut:
    return RiesgoOut(
        id=r.id,
        riesgo=r.riesgo,
        descripcion=r.descripcion or "",
        probabilidad=r.probabilidad,
        impacto=r.impacto,
        mitigacion=r.mitigacion or "",
        responsable=r.responsable or "",
        estado=r.estado,
        created_at=r.created_at.isoformat() if r.created_at else None,
        updated_at=r.updated_at.isoformat() if r.updated_at else None,
    )


@riesgos_router.get("", response_model=list[RiesgoOut])
def list_riesgos(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # Read-only for prueba: the register itself is not personal data.
    rows = db.query(Riesgo).order_by(Riesgo.id.asc()).offset(offset).limit(limit).all()
    return [_riesgo_out(r) for r in rows]


@riesgos_router.post("", response_model=RiesgoOut, status_code=status.HTTP_201_CREATED)
def create_riesgo(
    payload: RiesgoCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not payload.riesgo.strip():
        raise HTTPException(status_code=422, detail="El riesgo no puede estar vacío.")
    row = Riesgo(
        riesgo=payload.riesgo.strip(),
        descripcion=payload.descripcion,
        probabilidad=_check_enum(payload.probabilidad, RIESGO_PROBABILIDADES, "La probabilidad"),
        impacto=_check_enum(payload.impacto, RIESGO_IMPACTOS, "El impacto"),
        mitigacion=payload.mitigacion,
        responsable=payload.responsable.strip(),
        estado=_check_enum(payload.estado, RIESGO_ESTADOS, "El estado"),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _riesgo_out(row)


@riesgos_router.put("/{riesgo_id}", response_model=RiesgoOut)
def update_riesgo(
    riesgo_id: int,
    payload: RiesgoUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(Riesgo, riesgo_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Riesgo not found")
    if payload.riesgo is not None:
        if not payload.riesgo.strip():
            raise HTTPException(status_code=422, detail="El riesgo no puede estar vacío.")
        row.riesgo = payload.riesgo.strip()
    if payload.descripcion is not None:
        row.descripcion = payload.descripcion
    if payload.probabilidad is not None:
        row.probabilidad = _check_enum(payload.probabilidad, RIESGO_PROBABILIDADES, "La probabilidad")
    if payload.impacto is not None:
        row.impacto = _check_enum(payload.impacto, RIESGO_IMPACTOS, "El impacto")
    if payload.mitigacion is not None:
        row.mitigacion = payload.mitigacion
    if payload.responsable is not None:
        row.responsable = payload.responsable.strip()
    if payload.estado is not None:
        row.estado = _check_enum(payload.estado, RIESGO_ESTADOS, "El estado")
    db.commit()
    db.refresh(row)
    return _riesgo_out(row)


@riesgos_router.delete("/{riesgo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_riesgo(
    riesgo_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(Riesgo, riesgo_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Riesgo not found")
    db.delete(row)
    db.commit()
    return None


# --------------------------------------------------------------- planillas --

class PlanillaOut(BaseModel):
    id: int
    periodo: str
    empleado_id: int | None = None
    empleado_nombre: str
    monto: float
    estado: str
    notas: str
    created_at: str | None = None
    updated_at: str | None = None


class PlanillaCreate(BaseModel):
    periodo: str = Field(min_length=1, max_length=32)
    empleado_id: int | None = None
    empleado_nombre: str | None = Field(default=None, max_length=200)
    monto: float = 0.0
    estado: str = "pendiente"
    notas: str = Field(default="", max_length=5000)


class PlanillaUpdate(BaseModel):
    periodo: str | None = Field(default=None, min_length=1, max_length=32)
    empleado_id: int | None = None
    empleado_nombre: str | None = Field(default=None, max_length=200)
    monto: float | None = None
    estado: str | None = None
    notas: str | None = Field(default=None, max_length=5000)


def _planilla_out(r: Planilla) -> PlanillaOut:
    return PlanillaOut(
        id=r.id,
        periodo=r.periodo,
        empleado_id=r.empleado_id,
        empleado_nombre=r.empleado_nombre or "",
        monto=float(r.monto),
        estado=r.estado,
        notas=r.notas or "",
        created_at=r.created_at.isoformat() if r.created_at else None,
        updated_at=r.updated_at.isoformat() if r.updated_at else None,
    )


def _resolve_empleado(db: Session, empleado_id: int | None) -> Empleado | None:
    if empleado_id is None:
        return None
    emp = db.get(Empleado, empleado_id)
    if emp is None:
        raise HTTPException(status_code=404, detail="Empleado not found")
    return emp


@planillas_router.get("", response_model=list[PlanillaOut])
def list_planillas(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # Sensitive payroll data: prueba sees nothing, same as talento.
    if not user.is_admin:
        return []
    rows = db.query(Planilla).order_by(Planilla.id.asc()).offset(offset).limit(limit).all()
    return [_planilla_out(r) for r in rows]


@planillas_router.post("", response_model=PlanillaOut, status_code=status.HTTP_201_CREATED)
def create_planilla(
    payload: PlanillaCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not payload.periodo.strip():
        raise HTTPException(status_code=422, detail="El periodo no puede estar vacío.")
    emp = _resolve_empleado(db, payload.empleado_id)
    # Display snapshot: explicit name wins, else the linked employee's
    # name at creation time; it is NOT refreshed later (snapshot).
    nombre = (
        payload.empleado_nombre.strip()
        if payload.empleado_nombre is not None and payload.empleado_nombre.strip()
        else (emp.nombre if emp is not None else "")
    )
    row = Planilla(
        periodo=payload.periodo.strip(),
        empleado_id=payload.empleado_id,
        empleado_nombre=nombre,
        monto=_validate_monto(payload.monto),
        estado=_check_enum(payload.estado, PLANILLA_ESTADOS, "El estado"),
        notas=payload.notas,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _planilla_out(row)


@planillas_router.put("/{planilla_id}", response_model=PlanillaOut)
def update_planilla(
    planilla_id: int,
    payload: PlanillaUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(Planilla, planilla_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Planilla not found")
    if payload.periodo is not None:
        if not payload.periodo.strip():
            raise HTTPException(status_code=422, detail="El periodo no puede estar vacío.")
        row.periodo = payload.periodo.strip()
    if payload.empleado_id is not None:
        emp = _resolve_empleado(db, payload.empleado_id)
        row.empleado_id = payload.empleado_id
        # Changing the link refreshes the snapshot only when no explicit
        # name is given in the same update (creation-time snapshot rule).
        if payload.empleado_nombre is None:
            row.empleado_nombre = emp.nombre if emp is not None else row.empleado_nombre
    if payload.empleado_nombre is not None:
        row.empleado_nombre = payload.empleado_nombre.strip()
    if payload.monto is not None:
        row.monto = _validate_monto(payload.monto)
    if payload.estado is not None:
        row.estado = _check_enum(payload.estado, PLANILLA_ESTADOS, "El estado")
    if payload.notas is not None:
        row.notas = payload.notas
    db.commit()
    db.refresh(row)
    return _planilla_out(row)


@planillas_router.delete("/{planilla_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_planilla(
    planilla_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(Planilla, planilla_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Planilla not found")
    db.delete(row)
    db.commit()
    return None
