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
from sqlalchemy.orm import Mapped, mapped_column, relationship

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


class UserProfile(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), unique=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(100))
    base_currency: Mapped[str | None] = mapped_column(String(3))
    locale: Mapped[str | None] = mapped_column(String(32))
    timezone: Mapped[str | None] = mapped_column(String(64))

    user: Mapped[User] = relationship(back_populates="profile")


class AccountType(str, Enum):
    DEPOSIT = "DEPOSIT"
    CHECK_CARD = "CHECK_CARD"
    CREDIT_CARD = "CREDIT_CARD"
    SAVINGS = "SAVINGS"
    LOAN = "LOAN"
    CREDIT_LINE = "CREDIT_LINE"
    RETIREMENT = "RETIREMENT"
    FUND = "FUND"
    STOCK = "STOCK"
    CRYPTO = "CRYPTO"
    OTHER = "OTHER"


class BalanceType(str, Enum):
    DIRECT = "DIRECT"
    LINKED = "LINKED"


class Account(Base, TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[AccountType] = mapped_column(SAEnum(AccountType), nullable=False)
    balance: Mapped[float] = mapped_column(Numeric(18, 4), default=0, nullable=False)
    currency: Mapped[str | None] = mapped_column(String(3))
    is_archived: Mapped[bool] = mapped_column(default=False, nullable=False)
    linked_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id", ondelete="SET NULL"))
    balance_type: Mapped[BalanceType] = mapped_column(
        SAEnum(BalanceType),
        default=BalanceType.DIRECT,
        nullable=False,
    )
    auto_deduct: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    billing_cutoff_day: Mapped[int | None] = mapped_column(Integer)
    payment_day: Mapped[int | None] = mapped_column(Integer)

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_account_name"),
        CheckConstraint("linked_account_id IS NULL OR linked_account_id != id", name="ck_account_link_not_self"),
        CheckConstraint(
            "(type NOT IN ('CHECK_CARD','CREDIT_CARD')) OR balance = 0",
            name="ck_account_card_zero_balance",
        ),
        CheckConstraint(
            "billing_cutoff_day IS NULL OR (billing_cutoff_day >= 1 AND billing_cutoff_day <= 31)",
            name="ck_account_billing_cutoff_range",
        ),
        CheckConstraint(
            "payment_day IS NULL OR (payment_day >= 1 AND payment_day <= 31)",
            name="ck_account_payment_day_range",
        ),
        CheckConstraint(
            "type != 'CREDIT_CARD' OR linked_account_id IS NOT NULL",
            name="ck_credit_card_requires_link",
        ),
        CheckConstraint(
            "type != 'CREDIT_CARD' OR (billing_cutoff_day IS NOT NULL AND payment_day IS NOT NULL)",
            name="ck_credit_card_requires_schedule",
        ),
    )

    @property
    def account_type(self) -> AccountType:
        return self.type


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
    type: Mapped[TxnType] = mapped_column(SAEnum(TxnType), nullable=False)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("transfergroup.id"))
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    counter_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    card_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("category.id"))
    amount: Mapped[float] = mapped_column(Numeric(18, 4), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    memo: Mapped[str | None] = mapped_column(Text)
    payee_id: Mapped[int | None] = mapped_column(ForeignKey("payee.id"))
    external_id: Mapped[str | None] = mapped_column(String(64))  # for idempotency/deduplication
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
        SAEnum(TransactionStatus),
        nullable=False,
        default=TransactionStatus.CLEARED,
    )
    billing_cycle_id: Mapped[int | None] = mapped_column(
        "statement_id",
        ForeignKey("creditcardstatement.id", ondelete="SET NULL"),
    )
    billing_cycle: Mapped["CreditCardStatement | None"] = relationship(
        "CreditCardStatement",
        back_populates="transactions",
        foreign_keys="Transaction.billing_cycle_id",
    )

    __table_args__ = (
        CheckConstraint(
            "(type = 'TRANSFER' AND counter_account_id IS NOT NULL) OR (type IN ('INCOME','EXPENSE','SETTLEMENT') AND counter_account_id IS NULL)",
            name="ck_txn_type_rules",
        ),
        CheckConstraint(
            "(is_card_charge = 0) OR (type = 'EXPENSE' AND card_id IS NOT NULL)",
            name="ck_txn_card_charge_requires_card",
        ),
        CheckConstraint(
            "(type != 'SETTLEMENT') OR card_id IS NOT NULL",
            name="ck_txn_settlement_requires_card",
        ),
        CheckConstraint(
            "(type != 'SETTLEMENT') OR is_balance_neutral = 0",
            name="ck_txn_settlement_not_neutral",
        ),
        Index("ix_txn_user_date", "user_id", "occurred_at"),
        Index("ix_txn_card_id", "card_id"),
        UniqueConstraint("user_id", "external_id", name="uq_txn_external_id"),
        UniqueConstraint("user_id", "imported_source_id", name="uq_txn_imported_source_id"),
        UniqueConstraint("linked_transaction_id", name="uq_txn_linked_transaction_id"),
        CheckConstraint("linked_transaction_id IS NULL OR linked_transaction_id != id", name="ck_txn_not_link_self"),
    )


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
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    counter_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("category.id"))
    memo: Mapped[str | None] = mapped_column(Text)
    payee_id: Mapped[int | None] = mapped_column(ForeignKey("payee.id"))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    last_generated_at: Mapped[date | None] = mapped_column(Date)
    is_variable_amount: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_recurring_name"),
        CheckConstraint("(type = 'TRANSFER' AND counter_account_id IS NOT NULL AND category_id IS NULL) OR (type IN ('INCOME','EXPENSE'))", name="ck_recurring_type_rules"),
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
