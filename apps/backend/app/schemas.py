from __future__ import annotations

import math
import re
from datetime import date, time, datetime
import datetime as dt
from typing import Optional, Literal, Any

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    computed_field,
    field_validator,
    model_validator,
)

from .models import (
    AccountType,
    AccountUnifiedType,
    TxnType,
    RecurringFrequency,
    CalendarEventType,
    TransactionStatus,
    CreditCardStatementStatus,
)


class ResetRequest(BaseModel):
    user_id: int = Field(..., gt=0)


class ResetResult(BaseModel):
    removed: int
    details: dict[str, int] | None = None


class BackupInfo(BaseModel):
    filename: str
    size_bytes: int
    created_at: datetime
    memo: str | None = None
    pending_credit_card_statements: int = 0


class BackupCreateRequest(BaseModel):
    memo: str | None = Field(default=None, max_length=200)


class BackupListOut(BaseModel):
    backups: list[BackupInfo]


class BackupApplyRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=128)


class BackupApplyResult(BaseModel):
    applied: str


class BackupDeleteResult(BaseModel):
    deleted: str


class MemberOut(BaseModel):
    id: int
    email: EmailStr
    name: str
    is_active: bool
    display_name: str | None = None
    base_currency: str | None = None
    locale: str | None = None
    timezone: str | None = None


class MemberCreate(BaseModel):
    email: EmailStr
    display_name: str | None = Field(default=None, max_length=100)
    base_currency: str | None = Field(default=None, min_length=3, max_length=3)
    locale: str | None = Field(default=None, max_length=32)
    timezone: str | None = Field(default=None, max_length=64)
    is_active: bool = True


class MemberUpdate(BaseModel):
    email: EmailStr | None = None
    display_name: str | None = Field(default=None, max_length=100)
    base_currency: str | None = Field(default=None, min_length=3, max_length=3)
    locale: str | None = Field(default=None, max_length=32)
    timezone: str | None = Field(default=None, max_length=64)
    is_active: bool | None = None


class CreditCardTerms(BaseModel):
    billing_cutoff_day: int = Field(ge=1, le=31)
    payment_day: int = Field(ge=1, le=31)


class AccountCreate(BaseModel):
    user_id: int
    name: str = Field(min_length=1, max_length=100)
    type: AccountType
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    category: Optional[str] = Field(default=None, max_length=50)
    institution: Optional[str] = Field(default=None, max_length=120)
    current_balance: float = Field(
        default=0,
        validation_alias=AliasChoices("current_balance", "balance"),
    )
    available_balance: Optional[float] = None
    credit_limit: Optional[float] = None
    linked_account_id: Optional[int] = None
    opened_at: Optional[date] = None
    closed_at: Optional[date] = None
    memo: Optional[str] = Field(default=None, max_length=500)
    extra_metadata: dict[str, Any] | None = None
    credit_card_terms: CreditCardTerms | None = None
    auto_deduct: Optional[bool] = None
    billing_cutoff_day: Optional[int] = Field(default=None, ge=1, le=31)
    payment_day: Optional[int] = Field(default=None, ge=1, le=31)

    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="after")
    def validate_account(cls, values: "AccountCreate") -> "AccountCreate":
        auto_deduct = bool(values.auto_deduct) if values.auto_deduct is not None else False

        if values.type is AccountType.CREDIT_CARD:
            if values.linked_account_id is None:
                raise ValueError("linked_account_id is required for credit card accounts")
            terms = values.credit_card_terms
            if terms is None:
                if values.billing_cutoff_day is None or values.payment_day is None:
                    raise ValueError("credit card accounts require billing_cutoff_day and payment_day")
                terms = CreditCardTerms(
                    billing_cutoff_day=values.billing_cutoff_day,
                    payment_day=values.payment_day,
                )
                values.credit_card_terms = terms
            metadata = dict(values.extra_metadata or {})
            metadata.setdefault("billing_cutoff_day", values.credit_card_terms.billing_cutoff_day)
            metadata.setdefault("payment_day", values.credit_card_terms.payment_day)
            values.extra_metadata = metadata
        else:
            if values.credit_card_terms is not None:
                raise ValueError("credit_card_terms is only allowed for credit card accounts")
            if values.billing_cutoff_day is not None or values.payment_day is not None:
                raise ValueError("billing_cutoff_day/payment_day are only allowed for credit card accounts")
        if values.type is AccountType.CHECK_CARD:
            if auto_deduct and (values.linked_account_id is None):
                # Enforce at schema level for 422 as tests expect
                raise ValueError("auto_deduct requires a linked deposit account")
            if values.auto_deduct is None:
                values.auto_deduct = False
        else:
            if auto_deduct:
                raise ValueError("auto_deduct is only allowed for CHECK_CARD accounts")
            values.auto_deduct = False

        if values.extra_metadata is None:
            values.extra_metadata = {}
        return values


class AccountOut(BaseModel):
    id: int
    user_id: int
    name: str
    type: AccountType
    category: Optional[str]
    institution: Optional[str]
    currency: Optional[str]
    current_balance: float
    available_balance: Optional[float]
    credit_limit: Optional[float]
    linked_account_id: Optional[int]
    is_active: bool
    opened_at: Optional[date]
    closed_at: Optional[date]
    memo: Optional[str]
    extra_metadata: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @computed_field(return_type=float, alias="balance")
    def balance(self) -> float:
        return float(self.current_balance)

    @computed_field(return_type=AccountType, alias="account_type")
    def account_type(self) -> AccountType:
        return self.type

    @computed_field(return_type=bool, alias="is_archived")
    def is_archived(self) -> bool:
        return not self.is_active

    @computed_field(return_type=bool, alias="auto_deduct")
    def auto_deduct(self) -> bool:
        metadata = self.extra_metadata or {}
        raw = metadata.get("auto_deduct")
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, (int, float)):
            return bool(raw)
        if isinstance(raw, str):
            lowered = raw.strip().lower()
            return lowered in {"1", "true", "yes", "y", "on"}
        return False

    @computed_field(return_type=int | None, alias="billing_cutoff_day")
    def billing_cutoff_day(self) -> int | None:
        metadata = self.extra_metadata or {}
        value = metadata.get("billing_cutoff_day")
        return int(value) if value is not None else None

    @computed_field(return_type=int | None, alias="payment_day")
    def payment_day(self) -> int | None:
        metadata = self.extra_metadata or {}
        value = metadata.get("payment_day")
        return int(value) if value is not None else None

    @computed_field(return_type=AccountUnifiedType | None, alias="unified_type")
    def unified_type(self) -> AccountUnifiedType | None:
        try:
            return AccountType.unified_bucket(self.type)
        except Exception:
            return None


class AccountMergeRequest(BaseModel):
    target_account_id: int
    archive_source: bool = True
    combine_balances: bool = True


class AccountMergeResult(BaseModel):
    source_id: int
    target: AccountOut
    transactions_moved: int
    counter_links_updated: int
    recurring_updated: int
    recurring_counter_updated: int
    budgets_updated: int


class CategoryGroupRef(BaseModel):
    type: str  # 'I' | 'E' | 'T'
    code_gg: int

    @field_validator("type")
    def valid_type(cls, v: str):
        if v not in ("I", "E", "T"):
            raise ValueError("type must be I/E/T")
        return v


class CategoryGroupCreate(BaseModel):
    type: str  # 'I' | 'E' | 'T'
    code_gg: int
    name: str

    @field_validator("type")
    def valid_type(cls, v: str):
        if v not in ("I", "E", "T"):
            raise ValueError("type must be I/E/T")
        return v

    @field_validator("code_gg")
    def gg_range(cls, v: int):
        if not (0 <= v <= 99):
            raise ValueError("code_gg must be 0-99")
        return v


class CategoryGroupOut(BaseModel):
    id: int
    type: str
    code_gg: int
    name: str

    model_config = ConfigDict(from_attributes=True)


class CategoryGroupUpdate(BaseModel):
    name: Optional[str] = None
    code_gg: Optional[int] = None

    @field_validator("code_gg")
    def gg_range(cls, v: int):
        if v is None:
            return v
        if not (0 <= v <= 99):
            raise ValueError("code_gg must be 0-99")
        return v


class CategoryCreate(BaseModel):
    group_id: int
    code_cc: int
    name: str

    @field_validator("code_cc")
    def cc_range(cls, v: int):
        if not (0 <= v <= 99):
            raise ValueError("code_cc must be 0-99")
        return v


class CategoryOut(BaseModel):
    id: int
    group_id: int
    code_cc: int
    name: str
    full_code: str

    model_config = ConfigDict(from_attributes=True)


class TransactionCreate(BaseModel):
    user_id: int
    occurred_at: date
    occurred_time: Optional[time] = None
    type: TxnType
    from_account_id: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("from_account_id", "account_id"),
    )
    from_account_name: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("from_account_name", "account_name"),
    )
    to_account_id: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("to_account_id", "counter_account_id"),
    )
    to_account_name: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("to_account_name", "counter_account_name"),
    )
    card_account_id: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("card_account_id", "card_id"),
    )
    category_id: Optional[int] = None
    category_group_name: Optional[str] = None
    category_name: Optional[str] = None
    amount: float
    currency: str
    memo: Optional[str] = None
    payee_id: Optional[int] = None
    external_id: Optional[str] = Field(default=None, max_length=64)
    imported_source_id: Optional[str] = Field(default=None, max_length=128)
    transfer_flow: Optional[Literal["OUT", "IN"]] = None
    exclude_from_reports: bool = False
    is_card_charge: bool = False
    is_balance_neutral: bool = False
    billing_cycle_id: Optional[int] = None
    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="before")
    def _pre_normalize_legacy(cls, values: dict):
        # Normalize legacy keys into directional ones before field validation
        t = values.get("type")
        acc = values.get("account_id")
        cnt = values.get("counter_account_id")
        card = values.get("card_id")
        acc_name = values.get("account_name")
        cnt_name = values.get("counter_account_name")

        if card is not None and values.get("card_account_id") is None:
            values["card_account_id"] = card

        # Map legacy account_id according to transaction type
        if acc is not None and not values.get("from_account_id") and not values.get("to_account_id"):
            if t in (TxnType.INCOME, TxnType.SETTLEMENT):
                values["to_account_id"] = acc
            else:
                values["from_account_id"] = acc

        if cnt is not None and not values.get("to_account_id"):
            values["to_account_id"] = cnt

        # Map legacy name fields similarly
        if acc_name and not values.get("from_account_name") and not values.get("to_account_name"):
            if t in (TxnType.INCOME, TxnType.SETTLEMENT):
                values["to_account_name"] = acc_name
            else:
                values["from_account_name"] = acc_name
        if cnt_name and not values.get("to_account_name"):
            values["to_account_name"] = cnt_name

        # Normalize transfer_flow to upper-case for downstream logic
        if isinstance(values.get("transfer_flow"), str):
            values["transfer_flow"] = values["transfer_flow"].upper()

        # Remove legacy keys to avoid alias double-mapping into from_/to_ fields
        values.pop("account_id", None)
        values.pop("counter_account_id", None)
        values.pop("account_name", None)
        values.pop("counter_account_name", None)

        return values

    @field_validator("currency")
    def currency_len(cls, v: str) -> str:
        if len(v) != 3:
            raise ValueError("currency must be 3-letter code")
        return v.upper()

    @field_validator("amount")
    def validate_amount(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("amount must be finite")
        return v

    @model_validator(mode="after")
    def validate_references(self) -> "TransactionCreate":
        if not self.from_account_id and not self.from_account_name and not self.to_account_id and not self.to_account_name:
            raise ValueError("at least one of from_account or to_account identifiers is required")

        if self.type in (TxnType.EXPENSE, TxnType.SETTLEMENT):
            if not (self.from_account_id or self.from_account_name):
                raise ValueError("expense/settlement requires from_account")
        if self.type in (TxnType.INCOME, TxnType.SETTLEMENT):
            if not (self.to_account_id or self.to_account_name):
                raise ValueError("income/settlement requires to_account")
        if self.type == TxnType.TRANSFER:
            # Backward compatibility: allow single-sided transfers; pairing service will resolve
            # If both provided, ensure not identical when both are ints
            if self.from_account_id and self.to_account_id and self.from_account_id == self.to_account_id:
                raise ValueError("transfer from/to accounts must differ")
            if bool(self.category_group_name) ^ bool(self.category_name):
                raise ValueError("transfer requires both category names when provided")
        if self.transfer_flow and self.transfer_flow not in ("OUT", "IN"):
            raise ValueError("transfer_flow must be OUT or IN")

        if self.type in (TxnType.INCOME, TxnType.EXPENSE) and not self.category_id and not (
            self.category_group_name and self.category_name
        ):
            raise ValueError("category reference required for income/expense")

        if self.type == TxnType.SETTLEMENT:
            if self.transfer_flow is not None:
                raise ValueError("settlement cannot carry transfer_flow")
            if self.billing_cycle_id is None:
                raise ValueError("settlement requires billing_cycle_id")
            if self.card_account_id is None:
                raise ValueError("settlement requires card_account_id")
            if self.is_card_charge:
                raise ValueError("settlement cannot be marked as card charge")

        if self.is_card_charge:
            if self.type is not TxnType.EXPENSE:
                raise ValueError("card charges must be EXPENSE transactions")
            if self.card_account_id is None:
                raise ValueError("card charges require card_account_id")

        return self

    @computed_field(return_type=int | None)
    def account_id(self) -> int | None:
        # For legacy compatibility on input, surface the primary side by type
        if self.type == TxnType.INCOME:
            return self.to_account_id
        return self.from_account_id

    @computed_field(return_type=str | None)
    def account_name(self) -> str | None:
        if self.type == TxnType.INCOME:
            return self.to_account_name
        return self.from_account_name

    @computed_field(return_type=int | None)
    def counter_account_id(self) -> int | None:
        if self.type == TxnType.INCOME:
            return self.from_account_id
        return self.to_account_id

    @computed_field(return_type=str | None)
    def counter_account_name(self) -> str | None:
        if self.type == TxnType.INCOME:
            return self.from_account_name
        return self.to_account_name

    @computed_field(return_type=int | None)
    def card_id(self) -> int | None:
        return self.card_account_id


class AccountUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    type: Optional[AccountType] = None
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    category: Optional[str] = Field(default=None, max_length=50)
    institution: Optional[str] = Field(default=None, max_length=120)
    current_balance: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("current_balance", "balance"),
    )
    available_balance: Optional[float] = None
    credit_limit: Optional[float] = None
    linked_account_id: Optional[int] = None
    is_active: Optional[bool] = None
    opened_at: Optional[date] = None
    closed_at: Optional[date] = None
    memo: Optional[str] = Field(default=None, max_length=500)
    extra_metadata: Optional[dict[str, Any]] = None
    credit_card_terms: Optional[CreditCardTerms] = None
    auto_deduct: Optional[bool] = None
    billing_cutoff_day: Optional[int] = Field(default=None, ge=1, le=31)
    payment_day: Optional[int] = Field(default=None, ge=1, le=31)
    model_config = ConfigDict(extra="ignore")


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    code_cc: Optional[int] = None

    @field_validator("code_cc")
    def cc_range(cls, v: int):
        if v is None:
            return v
        if not (0 <= v <= 99):
            raise ValueError("code_cc must be 0-99")
        return v


class TransactionUpdate(BaseModel):
    occurred_at: Optional[date] = None
    occurred_time: Optional[time] = None
    type: Optional[TxnType] = None
    from_account_id: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("from_account_id", "account_id"),
    )
    to_account_id: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("to_account_id", "counter_account_id"),
    )
    card_account_id: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("card_account_id", "card_id"),
    )
    category_id: Optional[int] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    memo: Optional[str] = None
    payee_id: Optional[int] = None
    exclude_from_reports: Optional[bool] = None
    is_card_charge: Optional[bool] = None
    billing_cycle_id: Optional[int] = None
    imported_source_id: Optional[str] = Field(default=None, max_length=128)
    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="before")
    def _pre_normalize_legacy_update(cls, values: dict):
        t = values.get("type")
        acc = values.get("account_id")
        cnt = values.get("counter_account_id")
        card = values.get("card_id")
        acc_name = values.get("account_name")
        cnt_name = values.get("counter_account_name")

        if card is not None and values.get("card_account_id") is None:
            values["card_account_id"] = card

        if acc is not None and not values.get("from_account_id") and not values.get("to_account_id"):
            if t in (TxnType.INCOME, TxnType.SETTLEMENT):
                values["to_account_id"] = acc
            elif t in (TxnType.EXPENSE, TxnType.TRANSFER):
                values["from_account_id"] = acc
            else:
                # Unknown type at update time: set both so downstream logic can resolve by current tx.type
                values["from_account_id"] = acc
                values["to_account_id"] = acc
        if cnt is not None and not values.get("to_account_id"):
            values["to_account_id"] = cnt
        if acc_name and not values.get("from_account_name") and not values.get("to_account_name"):
            if t in (TxnType.INCOME, TxnType.SETTLEMENT):
                values["to_account_name"] = acc_name
            elif t in (TxnType.EXPENSE, TxnType.TRANSFER):
                values["from_account_name"] = acc_name
            else:
                values["from_account_name"] = acc_name
                values["to_account_name"] = acc_name
        if cnt_name and not values.get("to_account_name"):
            values["to_account_name"] = cnt_name
        if isinstance(values.get("transfer_flow"), str):
            values["transfer_flow"] = values["transfer_flow"].upper()

        # Remove legacy keys to avoid alias double-mapping
        values.pop("account_id", None)
        values.pop("counter_account_id", None)
        values.pop("account_name", None)
        values.pop("counter_account_name", None)
        return values


class BudgetUpdate(BaseModel):
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    category_id: Optional[int] = None
    account_id: Optional[int] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    rollover: Optional[bool] = None


class TransactionOut(BaseModel):
    id: int
    user_id: int
    occurred_at: date
    occurred_time: Optional[time]
    type: TxnType
    group_id: Optional[int]
    from_account_id: Optional[int]
    to_account_id: Optional[int]
    card_account_id: Optional[int]
    category_id: Optional[int]
    amount: float
    currency: str
    memo: Optional[str]
    payee_id: Optional[int]
    external_id: Optional[str]
    imported_source_id: Optional[str]
    is_card_charge: bool
    is_balance_neutral: bool
    is_auto_transfer_match: bool
    exclude_from_reports: bool
    linked_transaction_id: Optional[int]
    status: TransactionStatus
    billing_cycle_id: Optional[int]

    model_config = ConfigDict(from_attributes=True)

    @computed_field(return_type=int | None, alias="statement_id")
    def statement_id(self) -> int | None:
        return self.billing_cycle_id

    @computed_field(return_type=int | None, alias="account_id")
    def account_id(self) -> int | None:
        # For legacy compatibility, surface the primary side by type
        if self.type == TxnType.INCOME:
            return self.to_account_id
        return self.from_account_id

    @computed_field(return_type=int | None, alias="counter_account_id")
    def counter_account_id(self) -> int | None:
        if self.type == TxnType.INCOME:
            return self.from_account_id
        return self.to_account_id

    @computed_field(return_type=int | None, alias="card_id")
    def card_id(self) -> int | None:
        return self.card_account_id


class CreditCardStatementOut(BaseModel):
    id: int
    user_id: int
    account_id: int
    period_start: date
    period_end: date
    due_date: date
    total_amount: float
    status: CreditCardStatementStatus
    settlement_transaction_id: Optional[int]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CreditCardStatementSettleRequest(BaseModel):
    occurred_at: Optional[date] = None
    category_id: Optional[int] = None
    memo: Optional[str] = None
    create_card_entry: bool = True


class CreditCardAccountSummary(BaseModel):
    account_id: int
    user_id: int
    currency: Optional[str]
    outstanding_amount: float
    next_due_date: Optional[date]
    active_statement: Optional[CreditCardStatementOut] = None
    last_paid_statement: Optional[CreditCardStatementOut] = None


class BudgetCreate(BaseModel):
    user_id: int
    period: str  # MONTH/WEEK/CUSTOM
    period_start: date
    period_end: date
    category_id: Optional[int] = None
    account_id: Optional[int] = None
    amount: float
    currency: str
    rollover: bool = False

    @field_validator("currency")
    def currency_len(cls, v: str):
        if len(v) != 3:
            raise ValueError("currency must be 3-letter code")
        return v.upper()


class BudgetOut(BaseModel):
    id: int
    user_id: int
    period: str
    period_start: date
    period_end: date
    category_id: Optional[int]
    account_id: Optional[int]
    amount: float
    currency: str
    rollover: bool

    model_config = ConfigDict(from_attributes=True)


class AnalyticsFiltersOut(BaseModel):
    start: date | None = None
    end: date | None = None
    account_id: Optional[int] = None
    include_transfers: bool = True
    include_settlements: bool = False
    excluded_category_ids: list[int] = Field(default_factory=list)


class AnalyticsMonthlyFlowItem(BaseModel):
    month: str
    income: float
    expense: float
    net: float


class AnalyticsCategoryShareItem(BaseModel):
    category_group_id: Optional[int]
    category_group_name: str
    type: TxnType
    amount: float
    percentage: float


class AnalyticsTimelinePoint(BaseModel):
    occurred_at: date
    net_change: float
    running_total: float


class AnalyticsTimelineSeries(BaseModel):
    account_id: int
    account_name: str
    currency: Optional[str]
    points: list[AnalyticsTimelinePoint]


class AnalyticsUnifiedCategoryGroup(BaseModel):
    type: str  # 'I' | 'E'
    code_gg: int
    label: str
    group_ids_by_user: dict[int, int]
    names_by_user: dict[int, str]


class AnalyticsUnifiedCategory(BaseModel):
    full_code: str
    type: str  # 'I' | 'E'
    label: str
    category_ids_by_user: dict[int, int]
    names_by_user: dict[int, str]


class AnalyticsFilterOptionsOut(BaseModel):
    users: list[int]
    category_groups: list[AnalyticsUnifiedCategoryGroup]
    categories: list[AnalyticsUnifiedCategory]


class AnalyticsKpisOut(BaseModel):
    total_income: float
    total_expense: float
    net: float
    average_daily_expense: float
    transaction_count: int
    top_expense_category: Optional[AnalyticsCategoryShareItem] = None


class AnalyticsInsightOut(BaseModel):
    id: str
    title: str
    body: str
    severity: Literal["info", "warning", "positive"]


class AnalyticsAccountRef(BaseModel):
    id: int
    name: str
    currency: Optional[str]


class AnalyticsAccountVolatilityItem(BaseModel):
    account_id: int
    account_name: str
    currency: Optional[str]
    average_daily_change: float
    daily_stddev: float
    total_change: float


class AnalyticsAdvancedKpisOut(BaseModel):
    savings_rate: float | None
    savings_to_expense_ratio: float | None
    average_daily_net: float
    projected_runway_days: float | None
    projected_runout_date: date | None
    total_liquid_balance: float
    expense_concentration_index: float
    expense_concentration_level: Literal["low", "moderate", "high"]
    account_volatility: list[AnalyticsAccountVolatilityItem] = Field(default_factory=list)


class AnalyticsCategoryTrendItem(BaseModel):
    category_group_id: Optional[int]
    category_group_name: str
    type: TxnType
    month: str
    amount: float
    previous_month_amount: float | None
    mom_change: float | None
    qoq_change: float | None
    yoy_change: float | None


class AnalyticsCategoryMomentumOut(BaseModel):
    top_rising: list[AnalyticsCategoryTrendItem] = Field(default_factory=list)
    top_falling: list[AnalyticsCategoryTrendItem] = Field(default_factory=list)


class AnalyticsHeatmapBucket(BaseModel):
    day_of_week: int
    hour: int
    amount: float


class AnalyticsWeeklyHeatmapOut(BaseModel):
    buckets: list[AnalyticsHeatmapBucket] = Field(default_factory=list)
    max_value: float = 0.0


class AnalyticsAnomalyOut(BaseModel):
    transaction_id: int
    occurred_at: date
    account_id: int
    account_name: str
    category_group_name: str
    amount: float
    z_score: float
    type: TxnType
    memo: str | None = None


class AnalyticsIncomeDelayOut(BaseModel):
    rule_id: int
    rule_name: str
    expected_date: date
    last_seen_date: date | None
    delay_days: int
    account_name: str
    amount_hint: float | None


class AnalyticsRecurringCoverageItem(BaseModel):
    rule_id: int
    rule_name: str
    type: TxnType
    frequency: RecurringFrequency
    expected_occurrences: int
    actual_occurrences: int
    coverage_rate: float


class AnalyticsRecurringCoverageOut(BaseModel):
    total_rules: int
    rules_in_window: int
    overall_coverage_rate: float | None
    income_coverage_rate: float | None
    expense_coverage_rate: float | None
    uncovered_rules: list[AnalyticsRecurringCoverageItem] = Field(default_factory=list)


class AnalyticsForecastOut(BaseModel):
    next_month_income: float
    next_month_expense: float
    next_month_net: float
    methodology: str


class AnalyticsOverviewOut(BaseModel):
    filters: AnalyticsFiltersOut
    kpis: AnalyticsKpisOut
    monthly_flow: list[AnalyticsMonthlyFlowItem]
    category_share: list[AnalyticsCategoryShareItem]
    account_timeline: list[AnalyticsTimelineSeries]
    insights: list[AnalyticsInsightOut]
    accounts: list[AnalyticsAccountRef]
    advanced: AnalyticsAdvancedKpisOut
    category_trends: list[AnalyticsCategoryTrendItem]
    category_momentum: AnalyticsCategoryMomentumOut
    weekly_heatmap: AnalyticsWeeklyHeatmapOut
    expense_anomalies: list[AnalyticsAnomalyOut]
    income_alerts: list[AnalyticsIncomeDelayOut]
    recurring_coverage: AnalyticsRecurringCoverageOut
    forecast: AnalyticsForecastOut


class StatisticsSettingsIn(BaseModel):
    user_id: int
    excluded_category_ids: list[int] = Field(default_factory=list)


class StatisticsSettingsOut(BaseModel):
    user_id: int
    excluded_category_ids: list[int] = Field(default_factory=list)


class StatisticsPresetBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    memo: str | None = Field(default=None, max_length=2000)
    selected_category_ids: list[int] = Field(default_factory=list)


class StatisticsPresetCreate(StatisticsPresetBase):
    user_id: int


class StatisticsPresetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    memo: str | None = Field(default=None, max_length=2000)
    selected_category_ids: list[int] | None = None


class StatisticsPresetOut(StatisticsPresetBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# RecurringRule Schemas
class RecurringRuleCreate(BaseModel):
    user_id: int
    name: str
    type: TxnType
    frequency: RecurringFrequency
    day_of_month: Optional[int] = None
    weekday: Optional[int] = None
    amount: Optional[float] = None
    currency: str
    account_id: int
    counter_account_id: Optional[int] = None
    category_id: Optional[int] = None
    memo: Optional[str] = None
    payee_id: Optional[int] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_active: bool = True
    is_variable_amount: bool = False

    @field_validator("currency")
    def currency_len(cls, v: str):
        if len(v) != 3:
            raise ValueError("currency must be 3-letter code")
        return v.upper()

    @field_validator("amount")
    def amount_finite(cls, v: float | None):
        if v is None:
            return v
        if not math.isfinite(v):
            raise ValueError("amount must be finite")
        if v <= 0:
            raise ValueError("amount must be positive")
        return v

    @field_validator("day_of_month")
    def validate_day(cls, v: int | None):
        if v is not None and not (1 <= v <= 31):
            raise ValueError("day_of_month must be between 1 and 31")
        return v

    @field_validator("weekday")
    def validate_weekday(cls, v: int | None):
        if v is not None and not (0 <= v <= 6):
            raise ValueError("weekday must be between 0 and 6")
        return v

    @model_validator(mode="after")
    def require_amount_when_not_variable(self):
        if not self.is_variable_amount:
            if self.amount is None:
                raise ValueError("amount is required when is_variable_amount is false")
            if self.amount <= 0:
                raise ValueError("amount must be positive")
        return self


class RecurringRuleUpdate(BaseModel):
    name: Optional[str] = None
    frequency: Optional[RecurringFrequency] = None
    day_of_month: Optional[int] = None
    weekday: Optional[int] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    account_id: Optional[int] = None
    counter_account_id: Optional[int] = None
    category_id: Optional[int] = None
    memo: Optional[str] = None
    payee_id: Optional[int] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_active: Optional[bool] = None
    is_variable_amount: Optional[bool] = None

    @field_validator("currency")
    def currency_len(cls, v: str | None):
        if v is None:
            return v
        if len(v) != 3:
            raise ValueError("currency must be 3-letter code")
        return v.upper()

    @field_validator("amount")
    def amount_finite(cls, v: float | None):
        if v is None:
            return v
        if not math.isfinite(v):
            raise ValueError("amount must be finite")
        if v <= 0:
            raise ValueError("amount must be positive")
        return v

    @field_validator("day_of_month")
    def validate_day(cls, v: int | None):
        if v is not None and not (1 <= v <= 31):
            raise ValueError("day_of_month must be between 1 and 31")
        return v

    @field_validator("weekday")
    def validate_weekday(cls, v: int | None):
        if v is not None and not (0 <= v <= 6):
            raise ValueError("weekday must be between 0 and 6")
        return v

    @model_validator(mode="after")
    def validate_amount_pair(cls, values):
        is_variable = getattr(values, "is_variable_amount", None)
        amount = getattr(values, "amount", None)
        if is_variable is False and amount is None:
            raise ValueError("amount must be provided when setting is_variable_amount to false")
        return values


class RecurringRuleOut(BaseModel):
    id: int
    user_id: int
    name: str
    type: TxnType
    frequency: RecurringFrequency
    day_of_month: Optional[int]
    weekday: Optional[int]
    amount: Optional[float]
    currency: str
    account_id: int
    counter_account_id: Optional[int]
    category_id: Optional[int]
    memo: Optional[str]
    payee_id: Optional[int]
    start_date: Optional[date]
    end_date: Optional[date]
    is_active: bool
    last_generated_at: Optional[date]
    is_variable_amount: bool
    pending_occurrences: list[date] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class RecurringRuleConfirm(BaseModel):
    occurred_at: date
    amount: float
    memo: Optional[str] = None

    @field_validator("amount")
    def confirm_amount(cls, v: float):
        if not math.isfinite(v):
            raise ValueError("amount must be finite")
        if v <= 0:
            raise ValueError("amount must be positive")
        return v


class RecurringRuleHistoryItem(BaseModel):
    transaction_id: int
    occurred_at: date
    amount: float
    memo: Optional[str] = None
    delta_from_rule: Optional[float] = None


class RecurringRuleHistoryOut(BaseModel):
    rule_id: int
    user_id: int
    currency: str
    base_amount: Optional[float]
    count: int
    min_amount: Optional[float]
    max_amount: Optional[float]
    average_amount: Optional[float]
    min_delta: Optional[float]
    max_delta: Optional[float]
    average_delta: Optional[float]
    transactions: list[RecurringRuleHistoryItem]


class RecurringOccurrenceDraftUpsert(BaseModel):
    amount: Optional[float] = None
    memo: Optional[str] = None

    @field_validator("amount")
    def positive_or_none(cls, v: float | None):
        if v is None:
            return v
        if not math.isfinite(v):
            raise ValueError("amount must be finite")
        if v <= 0:
            raise ValueError("amount must be positive")
        return v


class RecurringOccurrenceDraftOut(BaseModel):
    occurred_at: date
    amount: Optional[float]
    memo: Optional[str]
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RecurringRulePreviewItem(BaseModel):
    occurred_at: date
    is_future: bool
    is_pending: bool
    draft_amount: Optional[float]
    draft_memo: Optional[str]
    draft_updated_at: Optional[datetime]


class RecurringRulePreviewOut(BaseModel):
    items: list[RecurringRulePreviewItem]
    total_count: int
    page: int
    page_size: int


class RecurringRuleBulkConfirmRequest(BaseModel):
    items: list[RecurringRuleConfirm] = Field(..., min_length=1)


class RecurringRuleBulkConfirmError(BaseModel):
    occurred_at: date
    detail: str


class RecurringRuleBulkConfirmResult(BaseModel):
    confirmed: list[TransactionOut]
    errors: list[RecurringRuleBulkConfirmError]


class RecurringRuleAttachRequest(BaseModel):
    transaction_ids: list[int] = Field(..., min_length=1)


class RecurringScanConsumeRequest(BaseModel):
    transaction_ids: list[int] = Field(..., min_length=1)
    reason: Literal["attached", "ignored"] = "attached"


class RecurringRuleAttachError(BaseModel):
    transaction_id: int
    detail: str


class RecurringRuleAttachResult(BaseModel):
    attached: list[TransactionOut]
    errors: list[RecurringRuleAttachError]


class RecurringRuleAttachToOccurrenceRequest(BaseModel):
    transaction_id: int
    # Occurrence date to link this transaction to; must match rule's schedule
    occurred_at: date


class RecurringRuleRetargetRequest(BaseModel):
    transaction_id: int
    occurred_at: date


class RecurringOccurrenceSkipRequest(BaseModel):
    occurred_at: date
    reason: str | None = None


class RecurringOccurrenceSkipOut(BaseModel):
    id: int
    rule_id: int
    user_id: int
    occurred_at: date
    reason: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RecurringRuleDetachRequest(BaseModel):
    transaction_id: int


class RecurringRuleDetachResult(BaseModel):
    detached: list[TransactionOut]
    errors: list[RecurringRuleAttachError]


# Recurring scan schemas
class RecurringScanRequest(BaseModel):
    user_id: int
    horizon_days: int = Field(default=180, ge=7, le=730)
    min_occurrences: int = Field(default=3, ge=2, le=36)
    include_transfers: bool = False
    # When true, ignore category_id during grouping for INCOME/EXPENSE to find patterns across categories
    ignore_category: bool = False


class RecurringScanHistoryItem(BaseModel):
    transaction_id: int
    occurred_at: date
    amount: float
    memo: str | None = None


class RecurringScanCandidateOut(BaseModel):
    user_id: int
    name: str
    type: TxnType
    frequency: RecurringFrequency
    day_of_month: int | None = None
    weekday: int | None = None
    amount: float | None = None
    is_variable_amount: bool
    currency: str
    account_id: int
    counter_account_id: int | None = None
    category_id: int | None = None
    memo: str | None = None
    payee_id: int | None = None
    occurrences: int
    first_date: date
    last_date: date
    average_interval_days: float | None = None
    amount_min: float | None = None
    amount_max: float | None = None
    amount_avg: float | None = None
    history: list[RecurringScanHistoryItem] = Field(default_factory=list)
    signature_hash: str


class RecurringCandidateExclusionBase(BaseModel):
    signature_hash: str = Field(..., min_length=8, max_length=64)
    snapshot: dict[str, Any]


class RecurringCandidateExclusionCreate(RecurringCandidateExclusionBase):
    user_id: int


class RecurringCandidateExclusionOut(RecurringCandidateExclusionBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BudgetSummaryOut(BaseModel):
    budget_id: int
    period_start: date
    period_end: date
    planned: float
    spent: float
    remaining: float
    execution_rate: float


class TransactionsBulkIn(BaseModel):
    user_id: int
    override: bool = False
    items: list[TransactionCreate]


class PotentialTransferMatch(BaseModel):
    """분산 업로드 시 기존 DB 트랜잭션과 매칭된 내부 이체 후보"""
    new_item_index: int  # items 배열에서의 인덱스
    # 새 항목(업로드)의 주요 표시 정보도 함께 내려주어 프론트가 안전하게 렌더링 가능
    new_item_occurred_at: str | None = None
    new_item_occurred_time: str | None = None
    new_item_amount: float | None = None
    new_item_account_name: str | None = None
    new_item_currency: str | None = None
    existing_txn_id: int
    existing_txn_occurred_at: str
    existing_txn_occurred_time: str | None
    existing_txn_amount: float
    existing_txn_account_name: str | None
    existing_txn_memo: str | None
    existing_txn_type: str
    confidence_score: int
    confidence_level: str  # "CERTAIN" | "SUSPECTED" | "UNLIKELY"


class TransactionsBulkOut(BaseModel):
    """대량 업로드 응답 - 생성된 트랜잭션 + DB 매칭 후보"""
    transactions: list[TransactionOut]
    db_transfer_matches: list[PotentialTransferMatch] = Field(default_factory=list)
    stats: dict = Field(default_factory=dict)  # {"created": 5, "db_matches": 3, ...}


class DbMatchDecision(BaseModel):
    """사용자의 DB 매칭 결정"""
    existing_txn_id: int
    new_item_index: int
    action: Literal["link", "separate"]  # link: TRANSFER로 연결, separate: 별도 거래로 등록


class DbMatchConfirmRequest(BaseModel):
    """DB 매칭 확인 요청"""
    user_id: int
    items: list[TransactionCreate]  # 원본 업로드 항목들
    decisions: list[DbMatchDecision]  # 사용자 결정


class DbMatchConfirmResult(BaseModel):
    """DB 매칭 확인 결과"""
    linked: int  # TRANSFER로 연결된 쌍 수
    created: int  # 별도 거래로 생성된 수
    updated: int  # 기존 트랜잭션 업데이트 수
    transactions: list[TransactionOut]  # 생성/업데이트된 트랜잭션


class TransactionsBulkDelete(BaseModel):
    user_id: int
    ids: list[int] = Field(..., min_length=1)


class TransactionsBulkDeleteResult(BaseModel):
    deleted: int
    deleted_ids: list[int]
    missing: list[int]


class TransactionsBulkMoveAccount(BaseModel):
    user_id: int
    transaction_ids: list[int] = Field(..., min_length=1)
    target_account_id: int


class TransactionsBulkMoveResult(BaseModel):
    updated: int
    missing: list[int]
    skipped: list[int]


class TransactionsBulkUpdate(BaseModel):
    user_id: int
    transaction_ids: list[int] = Field(..., min_length=1)
    updates: TransactionUpdate
    memo_mode: Optional[Literal["replace", "append"]] = "replace"
    append_delimiter: Optional[str] = Field(default=" ", max_length=16)


class TransactionsBulkUpdateResponse(BaseModel):
    updated: int
    items: list[TransactionOut]
    missing: list[int]
    skipped: list[int]


class CalendarEventCreate(BaseModel):
    user_id: int
    date: date
    type: CalendarEventType
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    color: Optional[str] = Field(default=None, max_length=9)

    @field_validator("color")
    def validate_color(cls, v: str | None):
        if v is None or v == "":
            return None
        if not re.match(r"^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$", v):
            raise ValueError("color must be hex format like #RRGGBB or #RRGGBBAA")
        return v.lower()


class CalendarEventUpdate(BaseModel):
    date: dt.date | None = None
    type: Optional[CalendarEventType] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    color: Optional[str] = Field(default=None, max_length=9)

    @field_validator("color")
    def validate_color(cls, v: str | None):
        if v is None or v == "":
            return None
        if not re.match(r"^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$", v):
            raise ValueError("color must be hex format like #RRGGBB or #RRGGBBAA")
        return v.lower()


class CalendarEventOut(BaseModel):
    id: int
    user_id: int
    date: date
    type: CalendarEventType
    title: str
    description: Optional[str]
    color: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ======================== Bulk Upload (Simple) ========================

class ParsedTransactionIn(BaseModel):
    """Client-parsed transaction shape used by the simple bulk-upload endpoint.

    date: ISO datetime string; stored as occurred_at (date) and occurred_time (time, optional)
    type: INCOME | EXPENSE | TRANSFER
    amount: positive number; will be signed by type (EXPENSE -> negative)
    category_main/sub: mapped to category_group_name/category_name when creating
    description: mapped to memo if present; falls back to memo
    account_name: human name to resolve/create account
    currency: 3-letter code
    """

    date: datetime
    type: TxnType
    amount: float
    memo: str | None = None
    category_main: str | None = None
    category_sub: str | None = None
    description: str | None = None
    account_name: str | None = None
    currency: str = Field(default="KRW", min_length=3, max_length=3)

    @field_validator("amount")
    def amount_positive(cls, v: float) -> float:
        if v is None or not math.isfinite(v):
            raise ValueError("amount must be finite number")
        if v <= 0:
            raise ValueError("amount must be greater than 0")
        return float(v)

    @field_validator("currency")
    def currency_upper(cls, v: str) -> str:
        return (v or "KRW").upper()


class TransactionImportResult(BaseModel):
    total_count: int
    success_count: int
    failed_count: int
    duplicates: int | None = 0
    errors: list[dict] | None = []

