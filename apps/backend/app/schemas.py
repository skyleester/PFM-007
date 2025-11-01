from __future__ import annotations

import math
import re
from datetime import date, time, datetime
import datetime as dt
from typing import Optional, Literal, Any

from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict, EmailStr, computed_field

from .models import (
    AccountType,
    BalanceType,
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


class AccountCreate(BaseModel):
    user_id: int
    name: str = Field(min_length=1, max_length=100)
    type: AccountType
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    balance: Optional[float] = 0
    linked_account_id: Optional[int] = None
    auto_deduct: bool = False
    billing_cutoff_day: Optional[int] = Field(default=None, ge=1, le=31)
    payment_day: Optional[int] = Field(default=None, ge=1, le=31)

    @model_validator(mode="after")
    def validate_linked_account(cls, values):
        if values.type == AccountType.CHECK_CARD:
            if values.auto_deduct and not values.linked_account_id:
                raise ValueError("linked_account_id is required when auto_deduct is enabled")
            if values.billing_cutoff_day is not None or values.payment_day is not None:
                raise ValueError("billing/payment days are only allowed for credit card accounts")
        elif values.type == AccountType.CREDIT_CARD:
            if not values.linked_account_id:
                raise ValueError("linked_account_id is required for credit card accounts")
            if values.billing_cutoff_day is None or values.payment_day is None:
                raise ValueError("billing_cutoff_day and payment_day are required for credit card accounts")
            if values.auto_deduct:
                raise ValueError("auto_deduct is not supported for credit card accounts")
        else:
            if values.linked_account_id is not None:
                raise ValueError("linked_account_id is only allowed for CHECK_CARD accounts")
            if values.auto_deduct:
                raise ValueError("auto_deduct is only available for CHECK_CARD accounts")
            if values.billing_cutoff_day is not None or values.payment_day is not None:
                raise ValueError("billing/payment days are only allowed for credit card accounts")
        return values


class AccountOut(BaseModel):
    id: int
    user_id: int
    name: str
    type: AccountType
    account_type: AccountType
    currency: Optional[str]
    balance: float
    is_archived: bool
    linked_account_id: Optional[int]
    balance_type: BalanceType
    auto_deduct: bool
    billing_cutoff_day: Optional[int]
    payment_day: Optional[int]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


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
    account_id: Optional[int] = None
    account_name: Optional[str] = None  # 이름으로 등록/검색 지원
    counter_account_id: Optional[int] = None
    counter_account_name: Optional[str] = None
    card_id: Optional[int] = None
    category_id: Optional[int] = None
    category_group_name: Optional[str] = None  # 대분류 이름
    category_name: Optional[str] = None  # 소분류 이름
    amount: float
    currency: str
    memo: Optional[str] = None
    payee_id: Optional[int] = None
    external_id: Optional[str] = Field(default=None, max_length=64)
    imported_source_id: Optional[str] = Field(default=None, max_length=128)
    transfer_flow: Optional[Literal["OUT", "IN"]] = None
    exclude_from_reports: bool = False
    is_card_charge: bool = False
    billing_cycle_id: Optional[int] = None

    @field_validator("currency")
    def currency_len(cls, v: str):
        if len(v) != 3:
            raise ValueError("currency must be 3-letter code")
        return v.upper()

    @field_validator("amount")
    def validate_amount(cls, v: float):
        if not math.isfinite(v):
            raise ValueError("amount must be finite")
        return v

    @field_validator("counter_account_id")
    def transfer_counter_optional(cls, v, info):
        # 단일 전표(상대 계정 없음) TRANSFER도 허용하기 위해 검증 완화
        return v

    @model_validator(mode="after")
    def validate_references(self):
        # account: account_id 또는 account_name 둘 중 하나는 필요
        if not self.account_id and not self.account_name:
            raise ValueError("account_id or account_name is required")

        if self.type in (TxnType.INCOME, TxnType.EXPENSE):
            # category: INCOME/EXPENSE에서는 category_id 또는 (category_group_name & category_name) 필요
            if not self.category_id and not (self.category_group_name and self.category_name):
                raise ValueError("category_id or (category_group_name & category_name) is required for income/expense")
        elif self.type == TxnType.TRANSFER:
            # transfer는 카테고리 선택 사항이지만, 부분 입력은 금지
            if bool(self.category_group_name) ^ bool(self.category_name):
                raise ValueError("TRANSFER requires both category_group_name and category_name when provided")
            if self.transfer_flow and self.transfer_flow not in ("OUT", "IN"):
                raise ValueError("transfer_flow must be OUT or IN")
        elif self.type == TxnType.SETTLEMENT:
            if not self.card_id:
                raise ValueError("card_id is required for settlement")
            if self.transfer_flow is not None:
                raise ValueError("transfer_flow is not allowed for settlement")
            if self.is_card_charge:
                raise ValueError("settlement cannot be marked as card charge")
            if self.billing_cycle_id is None:
                raise ValueError("billing_cycle_id is required for settlement")
        else:
            if self.transfer_flow is not None:
                raise ValueError("transfer_flow is only allowed for transfers")

        if self.is_card_charge and self.type != TxnType.EXPENSE:
            raise ValueError("card charges must be EXPENSE transactions")
        if self.is_card_charge and not self.card_id:
            raise ValueError("card charges require card_id")
        return self


class AccountUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    type: Optional[AccountType] = None
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    balance: Optional[float] = None
    is_archived: Optional[bool] = None
    linked_account_id: Optional[int] = None
    auto_deduct: Optional[bool] = None
    billing_cutoff_day: Optional[int] = Field(default=None, ge=1, le=31)
    payment_day: Optional[int] = Field(default=None, ge=1, le=31)


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
    type: Optional[TxnType] = None  # 타입 변경 지원 (외부 이체 → 수입/지출 변환 등)
    account_id: Optional[int] = None
    counter_account_id: Optional[int] = None
    category_id: Optional[int] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    memo: Optional[str] = None
    payee_id: Optional[int] = None
    exclude_from_reports: Optional[bool] = None
    card_id: Optional[int] = None
    is_card_charge: Optional[bool] = None
    billing_cycle_id: Optional[int] = None
    imported_source_id: Optional[str] = Field(default=None, max_length=128)


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
    account_id: int
    counter_account_id: Optional[int]
    card_id: Optional[int]
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
