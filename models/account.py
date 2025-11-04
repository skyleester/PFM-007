from __future__ import annotations

"""
Standalone SQLAlchemy 2.0 Account model for design/reference.

Notes:
- This file is not wired into the running FastAPI app by default.
- Column "metadata" is a reserved name on Declarative base; we expose it as
  attribute "extra_metadata" while persisting to DB column named "metadata".
- If you later integrate this into the app, either migrate the existing Account
  or alias fields accordingly.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy import JSON


# Minimal standalone base so this file is self-contained.
class Base(DeclarativeBase):
    pass


def now_naive_utc() -> datetime:
    # Keep it simple for the reference model; app uses local-time defaults.
    return datetime.utcnow().replace(tzinfo=None)


class AccountKind(str, Enum):
    """Unified account categories for the PFM design spec.

    BANK:     Deposit/Savings-like bank accounts (예금/적금/마통 등)
    CARD:     Credit/Debit card accounts
    POINT:    Points/Wallets (네이버페이/카카오페이/삼성페이 등)
    STOCK:    Brokerage/security accounts
    PENSION:  Retirement/pension accounts
    LOAN:     Loan/credit line accounts
    CASH:     Physical cash on hand
    VIRTUAL:  Virtual/other synthetic buckets
    """

    BANK = "BANK"
    CARD = "CARD"
    POINT = "POINT"
    STOCK = "STOCK"
    PENSION = "PENSION"
    LOAN = "LOAN"
    CASH = "CASH"
    VIRTUAL = "VIRTUAL"


class Account(Base):
    """Represents any entity that can hold or move money.

    Hierarchical by `parent_id` to model structures like 카드 -> 포인트,
    은행 -> 적금, 증권 -> CMA 등.
    """

    __tablename__ = "account"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Display name of the account (e.g., "농협 입출금통장 1234", "삼성카드")
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    # Coarse-grained account kind; see AccountKind enum above.
    type: Mapped[AccountKind] = mapped_column(SAEnum(AccountKind, name="account_kind"), nullable=False)

    # Provider / institution / brand name (e.g., "NH", "Samsung Card")
    provider: Mapped[Optional[str]] = mapped_column(String(120))

    # Current balance in the account's currency; nullable for non-balance-bearing wallets
    balance: Mapped[Optional[float]] = mapped_column(Numeric(18, 4))

    # ISO currency code; default to KRW
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="KRW")

    # Parent relationship for hierarchical accounts (nullable root)
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("account.id", ondelete="SET NULL"))

    # Whether this account is visible/active in UIs and calculations
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Free-form metadata (JSON). Use a different attribute name to avoid Base.metadata conflicts.
    extra_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata",  # DB column name
        MutableDict.as_mutable(JSON),
        default=dict,
        nullable=False,
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=now_naive_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=now_naive_utc, onupdate=now_naive_utc)

    # Relationships
    parent: Mapped["Account | None"] = relationship(
        "Account",
        remote_side="Account.id",
        back_populates="children",
        foreign_keys=[parent_id],
    )
    children: Mapped[list["Account"]] = relationship(
        "Account",
        back_populates="parent",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        # Optional constraints you may adopt when integrating:
        CheckConstraint("id != parent_id", name="ck_account_parent_not_self"),
    )

    def __repr__(self) -> str:  # pragma: no cover - developer convenience
        kind = self.type if isinstance(self.type, str) else getattr(self.type, "value", self.type)
        return (
            f"<Account id={self.id!r} name={self.name!r} type={kind!r} "
            f"provider={self.provider!r} currency={self.currency!r} balance={self.balance!r} "
            f"parent_id={self.parent_id!r} active={self.is_active!r}>"
        )
