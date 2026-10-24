"""Referral campaigns — Plataforma Unificada, módulo Referidos.

Helps a business get new clients through referral campaigns with
rewards: the business (admin) creates a campaign, existing customers
share its code, and when a referred person becomes a new client the
referral is tracked here and the referrer's reward is recorded.

Rewards are TRACKED ONLY in v1 — pending/confirmed/rewarded on the
Referral row. No money moves through this module, no payments are
processed, and no payout is promised by the platform.

Permissions follow the platform RBAC (same as CRM):
- any authenticated user (admin or "prueba") can READ campaigns/referrals;
- only admins can create, update or change referral status
  (require_admin -> 403 for prueba).
"""
import re
import secrets
import string
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import Contact, Referral, ReferralCampaign, User

router = APIRouter(prefix="/api/referrals", tags=["referrals"])

REWARD_TYPES = ("fixed", "percentage")
CAMPAIGN_STATUSES = ("active", "paused", "ended")
REFERRAL_STATUSES = ("pending", "confirmed", "rewarded")
# Forward-only transitions: pending -> confirmed -> rewarded.
NEXT_STATUS = {"pending": ("confirmed",), "confirmed": ("rewarded",), "rewarded": ()}


class CampaignOut(BaseModel):
    id: int
    name: str
    business_contact_id: int | None
    business_name: str | None
    share_code: str
    reward_type: str
    reward_value: str
    reward_note: str
    status: str
    referrals_count: int = 0
    confirmed_count: int = 0
    rewarded_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None


class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    business_contact_id: int | None = None
    reward_type: str = "fixed"
    reward_value: str = "0"
    reward_note: str = ""
    status: str = "active"


class CampaignUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    business_contact_id: int | None = None
    reward_type: str | None = None
    reward_value: str | None = None
    reward_note: str | None = None
    status: str | None = None


class ReferralOut(BaseModel):
    id: int
    campaign_id: int
    referrer_name: str
    referrer_contact: str
    referred_name: str
    referred_contact: str
    code: str
    status: str
    notes: str
    created_at: str | None = None
    updated_at: str | None = None


class ReferralCreate(BaseModel):
    referrer_name: str = Field(min_length=1, max_length=128)
    referrer_contact: str = Field(default="", max_length=255)
    referred_name: str = Field(min_length=1, max_length=128)
    referred_contact: str = Field(default="", max_length=255)
    code: str | None = Field(default=None, max_length=32)
    notes: str = ""


class ReferralStatusUpdate(BaseModel):
    status: str


def _check_reward_type(value: str) -> str:
    v = (value or "").strip().lower()
    if v not in REWARD_TYPES:
        raise HTTPException(
            status_code=422, detail=f"reward_type must be one of: {', '.join(REWARD_TYPES)}"
        )
    return v


def _check_campaign_status(value: str) -> str:
    v = (value or "").strip().lower()
    if v not in CAMPAIGN_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of: {', '.join(CAMPAIGN_STATUSES)}",
        )
    return v


def _check_reward_value(value: str) -> Decimal:
    try:
        dec = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=422, detail="reward_value must be a number")
    if dec < 0:
        raise HTTPException(status_code=422, detail="reward_value must be >= 0")
    return dec


def _new_share_code(db: Session, name: str) -> str:
    """Unique share code: name prefix + 4 random chars (e.g. ACME-7K2P)."""
    prefix = re.sub(r"[^A-Z0-9]", "", name.strip().upper())[:4] or "REF"
    alphabet = string.ascii_uppercase + string.digits
    for _ in range(20):
        code = f"{prefix}-{''.join(secrets.choice(alphabet) for _ in range(4))}"
        if db.query(ReferralCampaign).filter(ReferralCampaign.share_code == code).first() is None:
            return code
    raise HTTPException(status_code=500, detail="could not generate a unique share code")


def _business_name(db: Session, contact_id: int | None) -> str | None:
    if contact_id is None:
        return None
    contact = db.get(Contact, contact_id)
    return contact.name if contact else None


def _out_campaign(db: Session, c: ReferralCampaign) -> CampaignOut:
    referrals = db.query(Referral).filter(Referral.campaign_id == c.id).all()
    return CampaignOut(
        id=c.id,
        name=c.name,
        business_contact_id=c.business_contact_id,
        business_name=_business_name(db, c.business_contact_id),
        share_code=c.share_code,
        reward_type=c.reward_type,
        reward_value=str(c.reward_value),
        reward_note=c.reward_note or "",
        status=c.status,
        referrals_count=len(referrals),
        confirmed_count=sum(1 for r in referrals if r.status in ("confirmed", "rewarded")),
        rewarded_count=sum(1 for r in referrals if r.status == "rewarded"),
        created_at=c.created_at.isoformat() if c.created_at else None,
        updated_at=c.updated_at.isoformat() if c.updated_at else None,
    )


def _out_referral(r: Referral) -> ReferralOut:
    return ReferralOut(
        id=r.id,
        campaign_id=r.campaign_id,
        referrer_name=r.referrer_name,
        referrer_contact=r.referrer_contact or "",
        referred_name=r.referred_name,
        referred_contact=r.referred_contact or "",
        code=r.code,
        status=r.status,
        notes=r.notes or "",
        created_at=r.created_at.isoformat() if r.created_at else None,
        updated_at=r.updated_at.isoformat() if r.updated_at else None,
    )


def _get_campaign_or_404(db: Session, campaign_id: int) -> ReferralCampaign:
    campaign = db.get(ReferralCampaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


@router.get("/campaigns", response_model=list[CampaignOut])
def list_campaigns(
    status_filter: str | None = Query(default=None, alias="status"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ReferralCampaign)
    if status_filter:
        query = query.filter(ReferralCampaign.status == _check_campaign_status(status_filter))
    return [_out_campaign(db, c) for c in query.order_by(ReferralCampaign.id.desc()).all()]


@router.post("/campaigns", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
def create_campaign(
    payload: CampaignCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if payload.business_contact_id is not None and db.get(Contact, payload.business_contact_id) is None:
        raise HTTPException(status_code=404, detail="Business contact not found")
    reward_type = _check_reward_type(payload.reward_type)
    reward_value = _check_reward_value(payload.reward_value)
    if reward_type == "percentage" and reward_value > 100:
        raise HTTPException(status_code=422, detail="percentage reward_value must be <= 100")
    campaign = ReferralCampaign(
        name=payload.name.strip(),
        business_contact_id=payload.business_contact_id,
        share_code=_new_share_code(db, payload.name),
        reward_type=reward_type,
        reward_value=reward_value,
        reward_note=payload.reward_note,
        status=_check_campaign_status(payload.status),
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return _out_campaign(db, campaign)


@router.get("/campaigns/{campaign_id}", response_model=CampaignOut)
def get_campaign(
    campaign_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _out_campaign(db, _get_campaign_or_404(db, campaign_id))


@router.put("/campaigns/{campaign_id}", response_model=CampaignOut)
def update_campaign(
    campaign_id: int,
    payload: CampaignUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    campaign = _get_campaign_or_404(db, campaign_id)
    if payload.name is not None:
        campaign.name = payload.name.strip()
    if payload.business_contact_id is not None:
        if db.get(Contact, payload.business_contact_id) is None:
            raise HTTPException(status_code=404, detail="Business contact not found")
        campaign.business_contact_id = payload.business_contact_id
    if payload.reward_type is not None:
        campaign.reward_type = _check_reward_type(payload.reward_type)
    if payload.reward_value is not None:
        campaign.reward_value = _check_reward_value(payload.reward_value)
    if payload.reward_note is not None:
        campaign.reward_note = payload.reward_note
    if payload.status is not None:
        campaign.status = _check_campaign_status(payload.status)
    if campaign.reward_type == "percentage" and campaign.reward_value > 100:
        raise HTTPException(status_code=422, detail="percentage reward_value must be <= 100")
    db.commit()
    db.refresh(campaign)
    return _out_campaign(db, campaign)


@router.get("/campaigns/{campaign_id}/referrals", response_model=list[ReferralOut])
def list_referrals(
    campaign_id: int,
    status_filter: str | None = Query(default=None, alias="status"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_campaign_or_404(db, campaign_id)
    query = db.query(Referral).filter(Referral.campaign_id == campaign_id)
    if status_filter:
        v = status_filter.strip().lower()
        if v not in REFERRAL_STATUSES:
            raise HTTPException(
                status_code=422,
                detail=f"status must be one of: {', '.join(REFERRAL_STATUSES)}",
            )
        query = query.filter(Referral.status == v)
    return [_out_referral(r) for r in query.order_by(Referral.id.desc()).all()]


@router.post(
    "/campaigns/{campaign_id}/referrals",
    response_model=ReferralOut,
    status_code=status.HTTP_201_CREATED,
)
def register_referral(
    campaign_id: int,
    payload: ReferralCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    campaign = _get_campaign_or_404(db, campaign_id)
    if campaign.status != "active":
        raise HTTPException(
            status_code=422,
            detail=f"campaign is {campaign.status}; referrals can only be registered on active campaigns",
        )
    code = (payload.code or "").strip().upper() or campaign.share_code
    referral = Referral(
        campaign_id=campaign.id,
        referrer_name=payload.referrer_name.strip(),
        referrer_contact=payload.referrer_contact.strip(),
        referred_name=payload.referred_name.strip(),
        referred_contact=payload.referred_contact.strip(),
        code=code,
        status="pending",
        notes=payload.notes,
    )
    db.add(referral)
    db.commit()
    db.refresh(referral)
    return _out_referral(referral)


@router.patch("/referrals/{referral_id}", response_model=ReferralOut)
def update_referral_status(
    referral_id: int,
    payload: ReferralStatusUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    referral = db.get(Referral, referral_id)
    if referral is None:
        raise HTTPException(status_code=404, detail="Referral not found")
    target = (payload.status or "").strip().lower()
    if target not in REFERRAL_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of: {', '.join(REFERRAL_STATUSES)}",
        )
    if target not in NEXT_STATUS[referral.status]:
        raise HTTPException(
            status_code=422,
            detail=f"cannot move referral from {referral.status} to {target}",
        )
    referral.status = target
    db.commit()
    db.refresh(referral)
    return _out_referral(referral)
