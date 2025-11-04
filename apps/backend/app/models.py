from __future__ import annotations

from datetime import date, time, datetime
from zoneinfo import ZoneInfo
from enum import Enum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
    Index,
    Boolean,
    JSON,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, synonym
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.ext.mutable import MutableDict

from .core.config import settings
from .core.database import Base


try:
    LOCAL_ZONE = ZoneInfo(getattr(settings, "TIMEZONE", "Asia/Seoul"))
except Exception:
    LOCAL_ZONE = ZoneInfo("Asia/Seoul")


def now_local_naive() -> datetime:
    """Return naive datetime normalized to configured local timezone."""
    return datetime.now(LOCAL_ZONE).replace(tzinfo=None)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local_naive, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_local_naive, onupdate=now_local_naive, nullable=False)


class User(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    profile: Mapped["UserProfile"] = relationship(back_populates="user", uselist=False)
    accounts_v2: Mapped[list["AccountV2"]] = relationship("AccountV2", back_populates="user")


class UserProfile(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), unique=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(100))
    base_currency: Mapped[str | None] = mapped_column(String(3))
    locale: Mapped[str | None] = mapped_column(String(32))
    timezone: Mapped[str | None] = mapped_column(String(64))

    user: Mapped[User] = relationship(back_populates="profile")


class AccountUnifiedType(str, Enum):
    """Programmatic buckets that group legacy account types."""

    ASSET = "ASSET"
    LIABILITY = "LIABILITY"
    CREDIT_CARD = "CREDIT_CARD"
    INVESTMENT = "INVESTMENT"
    VIRTUAL = "VIRTUAL"
    CHECK_CARD = "CHECK_CARD"


class AccountType(str, Enum):
    """Legacy account types persisted in the database enum."""

    DEPOSIT = "DEPOSIT"
    SAVINGS = "SAVINGS"
    LOAN = "LOAN"
    CREDIT_LINE = "CREDIT_LINE"
    RETIREMENT = "RETIREMENT"
    FUND = "FUND"
    STOCK = "STOCK"
    CRYPTO = "CRYPTO"
    OTHER = "OTHER"
    CHECK_CARD = "CHECK_CARD"
    CREDIT_CARD = "CREDIT_CARD"

    @classmethod
    def unified_bucket(cls, value: "AccountType | str") -> AccountUnifiedType:
        if not isinstance(value, AccountType):
            value = cls(value)
        return _ACCOUNT_UNIFIED_MAP.get(value, AccountUnifiedType.ASSET)

    @classmethod
    def from_unified(cls, bucket: AccountUnifiedType) -> "AccountType":
        return _ACCOUNT_UNIFIED_REVERSE_MAP.get(bucket, cls.OTHER)


_ACCOUNT_UNIFIED_MAP: dict[AccountType, AccountUnifiedType] = {
    AccountType.DEPOSIT: AccountUnifiedType.ASSET,
    AccountType.SAVINGS: AccountUnifiedType.ASSET,
    AccountType.OTHER: AccountUnifiedType.VIRTUAL,
    AccountType.CHECK_CARD: AccountUnifiedType.CHECK_CARD,
    AccountType.CREDIT_CARD: AccountUnifiedType.CREDIT_CARD,
    AccountType.LOAN: AccountUnifiedType.LIABILITY,
    AccountType.CREDIT_LINE: AccountUnifiedType.LIABILITY,
    AccountType.RETIREMENT: AccountUnifiedType.INVESTMENT,
    AccountType.FUND: AccountUnifiedType.INVESTMENT,
    AccountType.STOCK: AccountUnifiedType.INVESTMENT,
    AccountType.CRYPTO: AccountUnifiedType.INVESTMENT,
}

_ACCOUNT_UNIFIED_REVERSE_MAP: dict[AccountUnifiedType, AccountType] = {
    AccountUnifiedType.ASSET: AccountType.DEPOSIT,
    AccountUnifiedType.VIRTUAL: AccountType.OTHER,
    AccountUnifiedType.CHECK_CARD: AccountType.CHECK_CARD,
    AccountUnifiedType.CREDIT_CARD: AccountType.CREDIT_CARD,
    AccountUnifiedType.LIABILITY: AccountType.LOAN,
    AccountUnifiedType.INVESTMENT: AccountType.RETIREMENT,
}


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        return lowered in {"1", "true", "yes", "y", "on"}
    return False


def _coerce_optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class Account(Base, TimestampMixin):
    """Unified account entity representing any source/destination of money."""

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[AccountType] = mapped_column(SAEnum(AccountType, name="account_type"), nullable=False)
    category: Mapped[str | None] = mapped_column(String(50))  # e.g., bank, cash, loan, brokerage
    institution: Mapped[str | None] = mapped_column(String(120))
    current_balance: Mapped[float] = mapped_column(Numeric(18, 4), default=0, nullable=False)
    available_balance: Mapped[float | None] = mapped_column(Numeric(18, 4))
    credit_limit: Mapped[float | None] = mapped_column(Numeric(18, 4))
    currency: Mapped[str | None] = mapped_column(String(3))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    linked_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id", ondelete="SET NULL"))
    opened_at: Mapped[date | None] = mapped_column(Date)
    closed_at: Mapped[date | None] = mapped_column(Date)
    memo: Mapped[str | None] = mapped_column(Text)
    extra_metadata: Mapped[dict[str, Any]] = mapped_column(MutableDict.as_mutable(JSON), default=dict, nullable=False)

    user: Mapped["User"] = relationship("User", backref="accounts")
    parent_account: Mapped["Account | None"] = relationship(
        "Account",
        remote_side="Account.id",
        backref="child_accounts",
        foreign_keys=[linked_account_id],
    )

    transactions_out: Mapped[list["Transaction"]] = relationship(
        "Transaction",
        back_populates="from_account",
        foreign_keys="Transaction.from_account_id",
    )
    transactions_in: Mapped[list["Transaction"]] = relationship(
        "Transaction",
        back_populates="to_account",
        foreign_keys="Transaction.to_account_id",
    )

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_account_name"),
        CheckConstraint("linked_account_id IS NULL OR linked_account_id != id", name="ck_account_link_not_self"),
        CheckConstraint(
            "type != 'CREDIT_CARD' OR linked_account_id IS NOT NULL",
            name="ck_credit_card_requires_link",
        ),
    )

    def _ensure_metadata(self) -> dict[str, Any]:
        if self.extra_metadata is None:
            self.extra_metadata = {}
        return self.extra_metadata

    def ensure_credit_metadata(self) -> None:
        """Hydrate credit-card specific defaults inside ``extra_metadata``.

        Stores keys such as ``billing_cutoff_day``/``payment_day`` without forcing dedicated columns.
        """

        if self.type is not AccountType.CREDIT_CARD:
            return
        metadata = self._ensure_metadata()
        metadata.setdefault("billing_cutoff_day", None)
        metadata.setdefault("payment_day", None)

    @property
    def auto_deduct(self) -> bool:
        metadata = self.extra_metadata or {}
        return _coerce_bool(metadata.get("auto_deduct"))

    @auto_deduct.setter
    def auto_deduct(self, value: bool) -> None:
        metadata = self._ensure_metadata()
        metadata["auto_deduct"] = bool(value)

    @property
    def billing_cutoff_day(self) -> int | None:
        metadata = self.extra_metadata or {}
        return _coerce_optional_int(metadata.get("billing_cutoff_day"))

    @billing_cutoff_day.setter
    def billing_cutoff_day(self, value: int | None) -> None:
        metadata = self._ensure_metadata()
        if value is None:
            metadata.pop("billing_cutoff_day", None)
        else:
            metadata["billing_cutoff_day"] = int(value)

    @property
    def payment_day(self) -> int | None:
        metadata = self.extra_metadata or {}
        return _coerce_optional_int(metadata.get("payment_day"))

    @payment_day.setter
    def payment_day(self, value: int | None) -> None:
        metadata = self._ensure_metadata()
        if value is None:
            metadata.pop("payment_day", None)
        else:
            metadata["payment_day"] = int(value)

    # --- Backwards compatibility helpers (legacy fields) -----------------
    @property
    def balance(self) -> float:
        return float(self.current_balance)

    @balance.setter
    def balance(self, value: float) -> None:
        self.current_balance = value

    @property
    def is_archived(self) -> bool:
        return not self.is_active

    @is_archived.setter
    def is_archived(self, value: bool) -> None:
        self.is_active = not value

    @property
    def unified_type(self) -> AccountUnifiedType:
        return AccountType.unified_bucket(self.type)


class TxnType(str, Enum):
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"
    TRANSFER = "TRANSFER"
    SETTLEMENT = "SETTLEMENT"


class CategoryGroup(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Global category groups (shared across application)
    type: Mapped[str] = mapped_column(String(1), nullable=False)  # I/E/T
    code_gg: Mapped[int] = mapped_column(Integer, nullable=False)  # 0~99
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int | None] = mapped_column(Integer)

    __table_args__ = (
        UniqueConstraint("type", "code_gg", name="uq_group_code"),
    )


class Category(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Global categories (shared across application)
    group_id: Mapped[int] = mapped_column(ForeignKey("categorygroup.id"), nullable=False)
    code_cc: Mapped[int] = mapped_column(Integer, nullable=False)  # 0~99
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int | None] = mapped_column(Integer)
    full_code: Mapped[str] = mapped_column(String(5), nullable=False)  # e.g., E0102

    __table_args__ = (
        UniqueConstraint("group_id", "code_cc", name="uq_category_cc"),
        UniqueConstraint("full_code", name="uq_category_full_code"),
    )


class TransferGroup(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)


class Payee(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_payee_name"),
    )


class TransactionStatus(str, Enum):
    CLEARED = "CLEARED"
    PENDING_PAYMENT = "PENDING_PAYMENT"


class Transaction(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    occurred_at: Mapped[date] = mapped_column(Date, nullable=False)
    occurred_time: Mapped[time | None] = mapped_column(Time)
    type: Mapped[TxnType] = mapped_column(SAEnum(TxnType, name="txn_type"), nullable=False)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("transfergroup.id"))
    from_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    to_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    card_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("category.id"))
    amount: Mapped[float] = mapped_column(Numeric(18, 4), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    memo: Mapped[str | None] = mapped_column(Text)
    payee_id: Mapped[int | None] = mapped_column(ForeignKey("payee.id"))
    external_id: Mapped[str | None] = mapped_column(String(64))
    imported_source_id: Mapped[str | None] = mapped_column(String(128))
    is_card_charge: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_balance_neutral: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_auto_transfer_match: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    exclude_from_reports: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    linked_transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("transaction.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[TransactionStatus] = mapped_column(
        SAEnum(TransactionStatus, name="txn_status"),
        nullable=False,
        default=TransactionStatus.CLEARED,
    )
    billing_cycle_id: Mapped[int | None] = mapped_column(
        "statement_id",
        ForeignKey("creditcardstatement.id", ondelete="SET NULL"),
    )

    # --- Backward-compatibility shims for legacy field names -----------------
    # Accept legacy constructor kwargs and attribute access from old code/tests
    def __init__(self, **kwargs):  # type: ignore[override]
        # Map legacy directional keys to unified ones
        _acc = kwargs.pop("account_id", None)
        if _acc is not None and "from_account_id" not in kwargs and "to_account_id" not in kwargs:
            t = kwargs.get("type")
            t_val = t.value if hasattr(t, "value") else t
            # Legacy semantics:
            # - INCOME: primary account is the destination (to)
            # - EXPENSE/TRANSFER/SETTLEMENT: primary account is the source (from)
            if t_val == "INCOME":
                kwargs["to_account_id"] = _acc
            else:
                kwargs["from_account_id"] = _acc
        _cnt = kwargs.pop("counter_account_id", None)
        if _cnt is not None:
            t = kwargs.get("type")
            t_val = t.value if hasattr(t, "value") else t
            # For counter side, mirror of the above:
            # - INCOME: counter is the source (from)
            # - EXPENSE/TRANSFER/SETTLEMENT: counter is the destination (to)
            if t_val == "INCOME":
                if "from_account_id" not in kwargs:
                    kwargs["from_account_id"] = _cnt
            else:
                if "to_account_id" not in kwargs:
                    kwargs["to_account_id"] = _cnt
        _card = kwargs.pop("card_id", None)
        if _card is not None and "card_account_id" not in kwargs:
            kwargs["card_account_id"] = _card
        # Drop name-only helper fields that are not ORM columns
        for k in (
            "account_name",
            "from_account_name",
            "counter_account_name",
            "to_account_name",
            "category_group_name",
            "category_name",
            "transfer_flow",
        ):
            kwargs.pop(k, None)
        super().__init__(**kwargs)

    from_account: Mapped["Account | None"] = relationship(
        "Account",
        back_populates="transactions_out",
        foreign_keys=[from_account_id],
    )
    to_account: Mapped["Account | None"] = relationship(
        "Account",
        back_populates="transactions_in",
        foreign_keys=[to_account_id],
    )
    card_account: Mapped["Account | None"] = relationship(
        "Account",
        foreign_keys=[card_account_id],
    )
    billing_cycle: Mapped["CreditCardStatement | None"] = relationship(
        "CreditCardStatement",
        back_populates="transactions",
        foreign_keys=[billing_cycle_id],
    )

    # Hybrid properties for legacy fields: instance access adapts by type; expression maps to columns
    @hybrid_property
    def account_id(self) -> int | None:  # type: ignore[override]
        if self.type == TxnType.INCOME:
            return self.to_account_id
        return self.from_account_id

    @account_id.setter
    def account_id(self, value: int | None) -> None:  # type: ignore[override]
        # Allow legacy-style assignment
        if self.type == TxnType.INCOME:
            self.to_account_id = value
        else:
            self.from_account_id = value

    @account_id.expression  # type: ignore[no-redef]
    def account_id(cls):
        return cls.from_account_id

    @hybrid_property
    def counter_account_id(self) -> int | None:  # type: ignore[override]
        if self.type == TxnType.INCOME:
            return self.from_account_id
        return self.to_account_id

    @counter_account_id.setter
    def counter_account_id(self, value: int | None) -> None:  # type: ignore[override]
        # Allow legacy-style assignment
        if self.type == TxnType.INCOME:
            self.from_account_id = value
        else:
            self.to_account_id = value

    @counter_account_id.expression  # type: ignore[no-redef]
    def counter_account_id(cls):
        return cls.to_account_id

    card_id = synonym("card_account_id")  # type: ignore[assignment]

    __table_args__ = (
        CheckConstraint(
            "from_account_id IS NOT NULL OR to_account_id IS NOT NULL",
            name="ck_txn_requires_account",
        ),
        CheckConstraint(
            "(type = 'TRANSFER' AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL AND from_account_id != to_account_id)"
            " OR (type = 'EXPENSE' AND from_account_id IS NOT NULL)"
            " OR (type = 'INCOME' AND to_account_id IS NOT NULL)"
            " OR (type = 'SETTLEMENT' AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL)",
            name="ck_txn_account_rules",
        ),
        CheckConstraint(
            "(is_card_charge = 0) OR (card_account_id IS NOT NULL)",
            name="ck_txn_card_charge_requires_card",
        ),
        CheckConstraint(
            "(type != 'SETTLEMENT') OR card_account_id IS NOT NULL",
            name="ck_txn_settlement_requires_card",
        ),
    Index("ix_txn_user_date", "user_id", "occurred_at"),
    Index("ix_txn_card_account_id", "card_account_id"),
        UniqueConstraint("user_id", "external_id", name="uq_txn_external_id"),
        UniqueConstraint("user_id", "imported_source_id", name="uq_txn_imported_source_id"),
        UniqueConstraint("linked_transaction_id", name="uq_txn_linked_transaction_id"),
        CheckConstraint("linked_transaction_id IS NULL OR linked_transaction_id != id", name="ck_txn_not_link_self"),
    )

    # (Removed) Legacy attribute property shims — use ORM synonyms above for both
    # query-time expressions and attribute access.


class CreditCardStatementStatus(str, Enum):
    PENDING = "pending"
    CLOSED = "closed"
    PAID = "paid"


class CreditCardStatement(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    total_amount: Mapped[float] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    status: Mapped[CreditCardStatementStatus] = mapped_column(
        SAEnum(CreditCardStatementStatus),
        nullable=False,
        default=CreditCardStatementStatus.PENDING,
    )
    settlement_transaction_id: Mapped[int | None] = mapped_column(ForeignKey("transaction.id", ondelete="SET NULL"))

    account: Mapped["Account"] = relationship("Account", backref="credit_card_statements")
    transactions: Mapped[list["Transaction"]] = relationship(
        "Transaction",
        back_populates="billing_cycle",
        foreign_keys="Transaction.billing_cycle_id",
    )
    settlement_transaction: Mapped["Transaction | None"] = relationship(
        "Transaction",
        foreign_keys="CreditCardStatement.settlement_transaction_id",
        post_update=True,
    )


class BudgetPeriod(str, Enum):
    MONTH = "MONTH"
    WEEK = "WEEK"
    CUSTOM = "CUSTOM"


class Budget(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    period: Mapped[BudgetPeriod] = mapped_column(SAEnum(BudgetPeriod), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("category.id"))
    account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    amount: Mapped[float] = mapped_column(Numeric(18, 4), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    rollover: Mapped[bool] = mapped_column(default=False, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "category_id", "period_start", "period_end", name="uq_budget_span"),
    )


class Tag(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(50), nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_tag_name"),)


class TransactionTag(Base):
    transaction_id: Mapped[int] = mapped_column(ForeignKey("transaction.id"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tag.id"), primary_key=True)


class Currency(Base):
    code: Mapped[str] = mapped_column(String(3), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(50))


class ExchangeRate(Base):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    base: Mapped[str] = mapped_column(String(3), nullable=False)
    quote: Mapped[str] = mapped_column(String(3), nullable=False)
    rate: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)

    __table_args__ = (UniqueConstraint("base", "quote", "date", name="uq_fx_snapshot"),)


class RecurringFrequency(str, Enum):
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    MONTHLY = "MONTHLY"
    YEARLY = "YEARLY"


class RecurringRule(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[TxnType] = mapped_column(SAEnum(TxnType), nullable=False)
    frequency: Mapped[RecurringFrequency] = mapped_column(SAEnum(RecurringFrequency), nullable=False)
    day_of_month: Mapped[int | None] = mapped_column(Integer)  # 1-28 권장
    weekday: Mapped[int | None] = mapped_column(Integer)  # 0=Mon .. 6=Sun
    amount: Mapped[float | None] = mapped_column(Numeric(18, 4), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    from_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    to_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("category.id"))
    memo: Mapped[str | None] = mapped_column(Text)
    payee_id: Mapped[int | None] = mapped_column(ForeignKey("payee.id"))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    last_generated_at: Mapped[date | None] = mapped_column(Date)
    is_variable_amount: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # --- Backward-compatibility shims (legacy account_id fields) -------------
    def __init__(self, **kwargs):  # type: ignore[override]
        # Map legacy fields to directional ones based on rule type
        if "account_id" in kwargs and "from_account_id" not in kwargs and "to_account_id" not in kwargs:
            t = kwargs.get("type")
            # Allow both enum and str
            t_val = t.value if hasattr(t, "value") else t
            if t_val == "INCOME":
                kwargs["to_account_id"] = kwargs.pop("account_id")
            else:
                # EXPENSE or TRANSFER default to from side
                kwargs["from_account_id"] = kwargs.pop("account_id")
        # Always consume legacy counter_account_id to avoid setting @property
        _cnt = kwargs.pop("counter_account_id", None)
        if _cnt is not None and "to_account_id" not in kwargs:
            kwargs["to_account_id"] = _cnt
        super().__init__(**kwargs)

    # Legacy-compatible hybrid properties: query/update use columns; instance access adapts by type
    @hybrid_property
    def account_id(self) -> int | None:  # type: ignore[override]
        if self.type == TxnType.INCOME:
            return self.to_account_id
        return self.from_account_id

    @account_id.expression  # type: ignore[no-redef]
    def account_id(cls):
        return cls.from_account_id

    @hybrid_property
    def counter_account_id(self) -> int | None:  # type: ignore[override]
        return self.to_account_id

    @counter_account_id.expression  # type: ignore[no-redef]
    def counter_account_id(cls):
        return cls.to_account_id

    from_account: Mapped["Account | None"] = relationship(
        "Account",
        foreign_keys=[from_account_id],
    )
    to_account: Mapped["Account | None"] = relationship(
        "Account",
        foreign_keys=[to_account_id],
    )

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_recurring_name"),
        CheckConstraint(
            "(type = 'TRANSFER' AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL AND category_id IS NULL)"
            " OR (type = 'EXPENSE' AND from_account_id IS NOT NULL)"
            " OR (type = 'INCOME' AND to_account_id IS NOT NULL)",
            name="ck_recurring_type_rules",
        ),
    )


class RecurringOccurrenceDraft(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rule_id: Mapped[int] = mapped_column(ForeignKey("recurringrule.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    occurred_at: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[float | None] = mapped_column(Numeric(18, 4), nullable=True)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)

    rule: Mapped["RecurringRule"] = relationship("RecurringRule", backref="occurrence_drafts")

    __table_args__ = (
        UniqueConstraint("rule_id", "occurred_at", name="uq_recurring_draft_rule_date"),
        Index("ix_recurring_draft_user_date", "user_id", "occurred_at"),
    )


class RecurringOccurrenceSkip(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rule_id: Mapped[int] = mapped_column(ForeignKey("recurringrule.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    occurred_at: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("rule_id", "occurred_at", name="uq_recurring_skip_rule_date"),
        Index("ix_recurring_skip_user_date", "user_id", "occurred_at"),
    )

class RecurringCandidateExclusion(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    signature_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("user_id", "signature_hash", name="uq_recurring_candidate_exclusion"),
        Index("ix_recurring_exclusion_user_created", "user_id", "created_at"),
    )


class CalendarEventType(str, Enum):
    ANNIVERSARY = "anniversary"
    MEMO = "memo"
    REMINDER = "reminder"


class CalendarEvent(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    type: Mapped[CalendarEventType] = mapped_column(SAEnum(CalendarEventType), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(9))

    __table_args__ = (
        Index("ix_calendar_event_user_date", "user_id", "date"),
    )


class StatisticsSetting(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False, unique=True)
    excluded_category_ids: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)


class StatisticsPreset(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    selected_category_ids: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_statistics_preset_user_name"),
        Index("ix_statistics_preset_user", "user_id"),
    )


# --- V2 Account schema (non-breaking addition) ---------------------------------

class AccountKind(str, Enum):
    """Unified account categories for V2 schema.

    BANK: deposit/savings-like bank accounts
    CARD: credit/debit card accounts
    POINT: points/wallets (e.g., Npay/Kpay/Samsung Pay)
    STOCK: brokerage/securities
    PENSION: retirement/pension
    LOAN: loan/credit line
    CASH: physical cash on hand
    VIRTUAL: virtual or synthetic buckets
    """

    BANK = "BANK"
    CARD = "CARD"
    POINT = "POINT"
    STOCK = "STOCK"
    PENSION = "PENSION"
    LOAN = "LOAN"
    CASH = "CASH"
    VIRTUAL = "VIRTUAL"


class AccountV2(Base, TimestampMixin):
    """New account model added alongside the legacy ``Account``.

    This table is separate (``account_v2``) to avoid any breaking change to
    the existing schema and operational data. It supports hierarchical
    parent/child accounts and a simplified, extensible field set.
    """

    __tablename__ = "account_v2"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[AccountKind] = mapped_column(SAEnum(AccountKind, name="accountkind"), nullable=False)
    provider: Mapped[str | None] = mapped_column(String(120))
    balance: Mapped[float | None] = mapped_column(Numeric(18, 4))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="KRW")
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("account_v2.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    extra_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        MutableDict.as_mutable(JSON),
        default=dict,
        nullable=False,
    )

    parent: Mapped["AccountV2 | None"] = relationship(
        "AccountV2",
        remote_side="AccountV2.id",
        back_populates="children",
        foreign_keys=[parent_id],
    )
    children: Mapped[list["AccountV2"]] = relationship(
        "AccountV2",
        back_populates="parent",
    )
    user: Mapped["User"] = relationship("User", back_populates="accounts_v2")

    __table_args__ = (
        CheckConstraint("parent_id IS NULL OR parent_id != id", name="ck_accountv2_parent_not_self"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        kind = self.type if isinstance(self.type, str) else getattr(self.type, "value", self.type)
        return (
            f"<AccountV2 id={self.id!r} name={self.name!r} type={kind!r} "
            f"provider={self.provider!r} currency={self.currency!r} balance={self.balance!r} "
            f"parent_id={self.parent_id!r} active={self.is_active!r}>"
        )
