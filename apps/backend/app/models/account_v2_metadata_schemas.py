from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.models import AccountKind


class BaseMetadata(BaseModel):
    # Common optional presentation fields
    color: Optional[str] = Field(default=None, description="UI color hex")
    external_ids: dict[str, str] = Field(default_factory=dict, description="External identifiers by source")


class BankMetadata(BaseMetadata):
    institution_code: Optional[str] = None
    account_number: Optional[str] = None


class CardMetadata(BaseMetadata):
    billing_cutoff_day: Optional[int] = Field(default=None, ge=1, le=31)
    payment_day: Optional[int] = Field(default=None, ge=1, le=31)
    auto_deduct: Optional[bool] = None
    settlement_account_ref: Optional[str] = Field(
        default=None, description="Human reference to settlement destination (e.g., linked bank)"
    )


class PointMetadata(BaseMetadata):
    provider_user_id: Optional[str] = None


class StockMetadata(BaseMetadata):
    brokerage_code: Optional[str] = None
    account_number: Optional[str] = None


class PensionMetadata(BaseMetadata):
    plan_type: Optional[str] = None


class LoanMetadata(BaseMetadata):
    lender: Optional[str] = None
    interest_rate: Optional[Decimal] = Field(default=None, ge=0)
    credit_limit: Optional[Decimal] = Field(default=None, ge=0)
    maturity_date: Optional[date] = None


class CashMetadata(BaseMetadata):
    location: Optional[str] = Field(default=None, description="Where the cash is held")


class VirtualMetadata(BaseMetadata):
    note: Optional[str] = None


_KIND_TO_MODEL: dict[AccountKind, type[BaseMetadata]] = {
    AccountKind.BANK: BankMetadata,
    AccountKind.CARD: CardMetadata,
    AccountKind.POINT: PointMetadata,
    AccountKind.STOCK: StockMetadata,
    AccountKind.PENSION: PensionMetadata,
    AccountKind.LOAN: LoanMetadata,
    AccountKind.CASH: CashMetadata,
    AccountKind.VIRTUAL: VirtualMetadata,
}


def get_metadata_model(kind: AccountKind) -> type[BaseMetadata]:
    return _KIND_TO_MODEL.get(kind, BaseMetadata)  # type: ignore[return-value]
