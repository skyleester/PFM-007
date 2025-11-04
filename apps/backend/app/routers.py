from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from datetime import date, datetime, timedelta, time, timezone
from collections import defaultdict
from typing import Literal, DefaultDict, Any
import calendar
import json
import hashlib
import re
import unicodedata
import math
import statistics
import shutil
import sqlite3
from pathlib import Path
from threading import Lock
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func
from sqlalchemy.engine.url import make_url

from .core.database import get_db
from .core.config import settings
from . import models
from .schemas import (
    AccountCreate,
    AccountOut,
    AccountUpdate,
    AccountMergeRequest,
    AccountMergeResult,
    CategoryGroupCreate,
    CategoryGroupOut,
    CategoryGroupUpdate,
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    TransactionCreate,
    TransactionOut,
    TransactionUpdate,
    BudgetCreate,
    BudgetOut,
    BudgetUpdate,
    RecurringRuleCreate,
    RecurringRuleOut,
    RecurringRuleUpdate,
    BudgetSummaryOut,
    TransactionsBulkIn,
    TransactionsBulkOut,
    PotentialTransferMatch,
    DbMatchDecision,
    DbMatchConfirmRequest,
    DbMatchConfirmResult,
    TransactionsBulkDelete,
    TransactionsBulkDeleteResult,
    TransactionsBulkMoveAccount,
    TransactionsBulkMoveResult,
    TransactionsBulkUpdate,
    TransactionsBulkUpdateResponse,
    ResetRequest,
    ResetResult,
    CalendarEventCreate,
    CalendarEventUpdate,
    CalendarEventOut,
    RecurringRuleConfirm,
    RecurringRuleHistoryOut,
    RecurringRuleHistoryItem,
    RecurringOccurrenceDraftUpsert,
    RecurringOccurrenceDraftOut,
    RecurringRulePreviewOut,
    RecurringRulePreviewItem,
    RecurringRuleBulkConfirmRequest,
    RecurringRuleBulkConfirmResult,
    RecurringRuleBulkConfirmError,
    RecurringRuleAttachRequest,
    RecurringRuleAttachResult,
    RecurringRuleAttachToOccurrenceRequest,
    RecurringRuleRetargetRequest,
    RecurringOccurrenceSkipRequest,
    RecurringOccurrenceSkipOut,
    RecurringRuleDetachRequest,
    RecurringRuleDetachResult,
    AnalyticsOverviewOut,
    AnalyticsFiltersOut,
    AnalyticsMonthlyFlowItem,
    AnalyticsCategoryShareItem,
    AnalyticsTimelineSeries,
    AnalyticsTimelinePoint,
    AnalyticsKpisOut,
    AnalyticsInsightOut,
    AnalyticsAccountRef,
    AnalyticsAdvancedKpisOut,
    AnalyticsCategoryTrendItem,
    AnalyticsCategoryMomentumOut,
    AnalyticsWeeklyHeatmapOut,
    AnalyticsHeatmapBucket,
    AnalyticsAnomalyOut,
    AnalyticsIncomeDelayOut,
    AnalyticsRecurringCoverageOut,
    AnalyticsRecurringCoverageItem,
    AnalyticsForecastOut,
    AnalyticsAccountVolatilityItem,
    AnalyticsFilterOptionsOut,
    AnalyticsUnifiedCategoryGroup,
    AnalyticsUnifiedCategory,
    RecurringScanRequest,
    RecurringScanCandidateOut,
    RecurringScanConsumeRequest,
    RecurringCandidateExclusionCreate,
    RecurringCandidateExclusionOut,
    StatisticsSettingsIn,
    StatisticsSettingsOut,
    StatisticsPresetCreate,
    StatisticsPresetOut,
    StatisticsPresetUpdate,
    CreditCardStatementOut,
    CreditCardStatementSettleRequest,
    CreditCardAccountSummary,
    MemberOut,
    MemberCreate,
    MemberUpdate,
    BackupInfo,
    BackupListOut,
    BackupCreateRequest,
    BackupApplyRequest,
    BackupApplyResult,
    BackupDeleteResult,
)


PENDING_LOOKBACK_DAYS = 120


router = APIRouter()

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]


def _detect_db_path() -> Path | None:
    try:
        url = make_url(settings.DATABASE_URL)
    except Exception:
        fallback = BACKEND_ROOT / "app.db"
        return fallback
    if not url.drivername.startswith("sqlite"):
        return None
    database = url.database or ""
    if database:
        candidate = Path(database)
        if not candidate.is_absolute():
            candidate = (REPO_ROOT / candidate).resolve()
    else:
        candidate = BACKEND_ROOT / "app.db"
    return candidate


DB_PATH = _detect_db_path()
BACKUPS_DIR = REPO_ROOT / "backups"
METADATA_FILE = BACKUPS_DIR / "metadata.json"
_METADATA_LOCK = Lock()


def _require_db_path() -> Path:
    if DB_PATH is None:
        raise HTTPException(status_code=400, detail="Backups are only supported for SQLite databases")
    return DB_PATH


def _copy_sqlite_database(source: Path, target: Path) -> None:
    temp_created = False
    try:
        source_uri = f"file:{source}?mode=ro"
        with sqlite3.connect(source_uri, uri=True) as src_conn:
            with sqlite3.connect(target) as dst_conn:
                temp_created = True
                src_conn.backup(dst_conn)
    except sqlite3.Error as exc:
        if temp_created and target.exists():
            target.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Failed to copy SQLite database for backup") from exc


def _sqlite_wal_files(db_path: Path) -> list[Path]:
    suffix = db_path.suffix
    files: list[Path] = []
    if suffix:
        files.append(db_path.with_suffix(f"{suffix}-wal"))
        files.append(db_path.with_suffix(f"{suffix}-shm"))
    else:
        files.append(Path(str(db_path) + "-wal"))
        files.append(Path(str(db_path) + "-shm"))
    return files


def _normalize_optional(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _ensure_backups_dir() -> None:
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)


def _load_backup_metadata() -> dict[str, dict[str, Any]]:
    if not METADATA_FILE.exists():
        return {}
    try:
        with METADATA_FILE.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            cleaned: dict[str, dict[str, Any]] = {}
            for key, value in data.items():
                if isinstance(value, dict):
                    cleaned[str(key)] = value
                else:
                    cleaned[str(key)] = {}
            return cleaned
    except Exception:
        return {}
    return {}


def _save_backup_metadata(data: dict[str, dict[str, Any]]) -> None:
    _ensure_backups_dir()
    temp_path = METADATA_FILE.with_suffix(".tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    temp_path.replace(METADATA_FILE)


def _backup_info_from_path(path: Path, metadata: dict[str, dict[str, Any]] | None = None) -> BackupInfo:
    stat = path.stat()
    created_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
    meta = metadata.get(path.name, {}) if metadata else {}
    memo = meta.get("memo")
    pending_statements = int(meta.get("pending_card_statements", 0) or 0)
    return BackupInfo(
        filename=path.name,
        size_bytes=stat.st_size,
        created_at=created_at,
        memo=memo if isinstance(memo, str) and memo.strip() else None,
        pending_credit_card_statements=max(pending_statements, 0),
    )


def _resolve_backup_path(filename: str) -> Path:
    safe_name = Path(filename).name
    if safe_name != filename:
        raise HTTPException(status_code=400, detail="Invalid backup filename")
    candidate = BACKUPS_DIR / safe_name
    if candidate.resolve().parent != BACKUPS_DIR.resolve():
        raise HTTPException(status_code=400, detail="Invalid backup path")
    if not candidate.exists():
        raise HTTPException(status_code=404, detail="Backup not found")
    if not candidate.is_file():
        raise HTTPException(status_code=400, detail="Backup is not a file")
    return candidate


def _time_to_str(value: str | time | None) -> str | None:
    """Return HH:MM:SS or None from time or string input."""
    if value is None:
        return None
    if isinstance(value, time):
        return value.strftime("%H:%M:%S")
    return str(value)


def _normalize_currency(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip().upper()
    return trimmed or None


def _normalize_label(value: str | None) -> str:
    """Normalize human labels for resilient matching across uploads/users.

    - Unicode NFKC normalize
    - lower-case
    - trim and collapse internal whitespace
    - remove common punctuation characters
    """
    if not value:
        return ""
    s = unicodedata.normalize("NFKC", value)
    s = s.strip().lower()
    # collapse whitespace sequences
    s = re.sub(r"\s+", " ", s)
    # drop lightweight punctuation often varying in CSVs
    s = re.sub(r"[·•··\-_/\\.,()\[\]{}]+", "", s)
    return s


def _member_to_schema(user: models.User, profile: models.UserProfile | None) -> MemberOut:
    display_name = profile.display_name if profile and profile.display_name else (user.email.split("@")[0] if user.email else f"user-{user.id}")
    return MemberOut(
        id=user.id,
        email=user.email,
        name=display_name,
        is_active=user.is_active,
        display_name=profile.display_name if profile else None,
        base_currency=profile.base_currency if profile else None,
        locale=profile.locale if profile else None,
        timezone=profile.timezone if profile else None,
    )


def _mode(values: list[int]) -> int | None:
    if not values:
        return None
    counts: dict[int, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    best = max(counts.items(), key=lambda kv: (kv[1], kv[0]))
    return best[0]


def _detect_frequency(sorted_dates: list[date]) -> tuple[models.RecurringFrequency | None, int | None, int | None, float | None]:
    if len(sorted_dates) < 2:
        return None, None, None, None
    deltas = [(sorted_dates[i] - sorted_dates[i - 1]).days for i in range(1, len(sorted_dates))]
    if not deltas:
        return None, None, None, None
    med = statistics.median(deltas)
    avg = sum(deltas) / len(deltas)
    # Monthly pattern (approx 1 month)
    if 27 <= med <= 32:
        doms = [d.day for d in sorted_dates]
        return models.RecurringFrequency.MONTHLY, _mode(doms), None, avg
    # Weekly pattern
    if 5 <= med <= 8:
        wds = [d.weekday() for d in sorted_dates]
        return models.RecurringFrequency.WEEKLY, None, _mode(wds), avg
    # Daily pattern
    if med <= 2 and len(sorted_dates) >= 5:
        return models.RecurringFrequency.DAILY, None, None, avg
    return None, None, None, avg


def _amount_stats(amounts: list[float]) -> tuple[float | None, float | None, float | None, bool]:
    if not amounts:
        return None, None, None, True
    vals = [abs(float(a)) for a in amounts]
    mn = min(vals)
    mx = max(vals)
    avg = sum(vals) / len(vals)
    spread = mx - mn
    variable = False
    if avg > 0:
        variable = (spread / avg) > 0.15
    else:
        variable = spread > 0
    return mn, mx, avg, variable


@router.get("/members", response_model=list[MemberOut])
def list_members(db: Session = Depends(get_db)):
    users = db.query(models.User).all()
    profiles = {p.user_id: p for p in db.query(models.UserProfile).all()}
    result = [_member_to_schema(u, profiles.get(u.id)) for u in users]
    result.sort(key=lambda item: item.name)
    return result


@router.post("/members", response_model=MemberOut, status_code=201)
def create_member(payload: MemberCreate, db: Session = Depends(get_db)):
    dup = db.query(models.User).filter(models.User.email == payload.email).first()
    if dup:
        raise HTTPException(status_code=409, detail="Email already exists")

    user = models.User(email=payload.email, is_active=payload.is_active)
    db.add(user)
    db.flush()

    profile = models.UserProfile(
        user_id=user.id,
        display_name=_normalize_optional(payload.display_name),
        base_currency=_normalize_currency(payload.base_currency),
        locale=_normalize_optional(payload.locale),
        timezone=_normalize_optional(payload.timezone),
    )
    db.add(profile)
    db.commit()
    db.refresh(user)
    db.refresh(profile)
    return _member_to_schema(user, profile)


@router.patch("/members/{member_id}", response_model=MemberOut)
def update_member(member_id: int, payload: MemberUpdate, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == member_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Member not found")

    profile = db.query(models.UserProfile).filter(models.UserProfile.user_id == member_id).first()
    if not profile:
        profile = models.UserProfile(user_id=member_id)
        db.add(profile)
        db.flush()

    if payload.email and payload.email != user.email:
        dup = (
            db.query(models.User)
            .filter(models.User.email == payload.email, models.User.id != member_id)
            .first()
        )
        if dup:
            raise HTTPException(status_code=409, detail="Email already exists")
        user.email = payload.email

    if payload.is_active is not None:
        user.is_active = payload.is_active

    if payload.display_name is not None:
        profile.display_name = _normalize_optional(payload.display_name)
    if payload.base_currency is not None:
        profile.base_currency = _normalize_currency(payload.base_currency)
    if payload.locale is not None:
        profile.locale = _normalize_optional(payload.locale)
    if payload.timezone is not None:
        profile.timezone = _normalize_optional(payload.timezone)

    db.commit()
    db.refresh(user)
    db.refresh(profile)
    return _member_to_schema(user, profile)


@router.delete("/members/{member_id}")
def delete_member(member_id: int, db: Session = Depends(get_db)):
    """멤버와 관련된 모든 데이터를 삭제합니다.
    
    - 트랜잭션, 계좌, 예산, 정기 규칙, 카드 명세서 등 모두 삭제
    - 마지막으로 프로필과 사용자 레코드 삭제
    """
    user = db.query(models.User).filter(models.User.id == member_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Member not found")
    
    # 1) 트랜잭션 삭제
    db.query(models.Transaction).filter(models.Transaction.user_id == member_id).delete(synchronize_session=False)
    
    # 2) 카드 명세서 삭제
    db.query(models.CreditCardStatement).filter(models.CreditCardStatement.user_id == member_id).delete(synchronize_session=False)
    
    # 3) 예산 삭제
    db.query(models.Budget).filter(models.Budget.user_id == member_id).delete(synchronize_session=False)
    
    # 4) 정기 규칙 및 드래프트 삭제
    db.query(models.RecurringOccurrenceDraft).filter(models.RecurringOccurrenceDraft.user_id == member_id).delete(synchronize_session=False)
    db.query(models.RecurringRule).filter(models.RecurringRule.user_id == member_id).delete(synchronize_session=False)
    
    # 5) 계좌 삭제
    db.query(models.Account).filter(models.Account.user_id == member_id).delete(synchronize_session=False)
    
    # 6) 프로필 삭제
    db.query(models.UserProfile).filter(models.UserProfile.user_id == member_id).delete(synchronize_session=False)
    
    # 7) 사용자 삭제
    db.delete(user)
    
    db.commit()
    return {"deleted": member_id}


@router.post("/category-groups", response_model=CategoryGroupOut, status_code=201)
def create_category_group(payload: CategoryGroupCreate, db: Session = Depends(get_db)):
    # uniqueness: (type, code_gg) globally
    dup = (
        db.query(models.CategoryGroup)
        .filter(
            models.CategoryGroup.type == payload.type,
            models.CategoryGroup.code_gg == payload.code_gg,
        )
        .first()
    )
    if dup:
        raise HTTPException(status_code=409, detail="Group code already exists")
    item = models.CategoryGroup(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/category-groups", response_model=list[CategoryGroupOut])
def list_category_groups(
    type: str | None = Query(None, pattern="^(I|E|T)$"),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(models.CategoryGroup)
    if type:
        q = q.filter(models.CategoryGroup.type == type)
    if search:
        q = q.filter(models.CategoryGroup.name.ilike(f"%{search}%"))
    q = q.order_by(models.CategoryGroup.type, models.CategoryGroup.code_gg, models.CategoryGroup.id)
    return q.all()


@router.get("/calendar-events", response_model=list[CalendarEventOut])
def list_calendar_events(
    user_id: list[int] = Query(...),
    start: date | None = Query(None),
    end: date | None = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(models.CalendarEvent).filter(models.CalendarEvent.user_id.in_(user_id))
    if start:
        q = q.filter(models.CalendarEvent.date >= start)
    if end:
        q = q.filter(models.CalendarEvent.date <= end)
    q = q.order_by(models.CalendarEvent.date, models.CalendarEvent.id)
    return q.all()


@router.post("/calendar-events", response_model=CalendarEventOut, status_code=201)
def create_calendar_event(payload: CalendarEventCreate, db: Session = Depends(get_db)):
    item = models.CalendarEvent(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/calendar-events/{event_id}", response_model=CalendarEventOut)
def update_calendar_event(
    event_id: int,
    payload: CalendarEventUpdate,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    event = (
        db.query(models.CalendarEvent)
        .filter(models.CalendarEvent.id == event_id, models.CalendarEvent.user_id == user_id)
        .first()
    )
    if not event:
        raise HTTPException(status_code=404, detail="Calendar event not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(event, key, value)
    db.commit()
    db.refresh(event)
    return event


@router.delete("/calendar-events/{event_id}", status_code=204)
def delete_calendar_event(
    event_id: int,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    event = (
        db.query(models.CalendarEvent)
        .filter(models.CalendarEvent.id == event_id, models.CalendarEvent.user_id == user_id)
        .first()
    )
    if not event:
        raise HTTPException(status_code=404, detail="Calendar event not found")
    db.delete(event)
    db.commit()
    return None


# TODO(PHASE2): Transaction endpoints duplicated in routers/transactions.py for
# modular rollout. Keep definitions here for comparison until legacy router is
# fully retired.
@router.get("/transactions", response_model=list[TransactionOut])
def list_transactions(
    response: Response,
    user_id: list[int] = Query(...),
    start: date | None = Query(None),
    end: date | None = Query(None),
    type: models.TxnType | None = Query(None),
    status: models.TransactionStatus | None = Query(None),
    billing_cycle_id: int | None = Query(None),
    account_id: int | None = Query(None),
    category_id: list[int] | None = Query(None),
    group_id: list[int] | None = Query(None),
    min_amount: float | None = Query(None),
    max_amount: float | None = Query(None),
    search: str | None = Query(None),
    exclude_settlements: bool = Query(False),
    sort_by: str = Query("occurred_at"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    category_alias = aliased(models.Category)
    group_alias = aliased(models.CategoryGroup)

    q = (
        db.query(models.Transaction)
        .filter(models.Transaction.user_id.in_(user_id))
        .outerjoin(category_alias, models.Transaction.category_id == category_alias.id)
        .outerjoin(group_alias, category_alias.group_id == group_alias.id)
    )
    if start:
        q = q.filter(models.Transaction.occurred_at >= start)
    if end:
        q = q.filter(models.Transaction.occurred_at <= end)
    if type:
        q = q.filter(models.Transaction.type == type)
    if exclude_settlements:
        q = q.filter(models.Transaction.type != models.TxnType.SETTLEMENT)
    if status:
        q = q.filter(models.Transaction.status == status)
    if billing_cycle_id:
        q = q.filter(models.Transaction.billing_cycle_id == billing_cycle_id)
    if account_id:
        q = q.filter(models.Transaction.account_id == account_id)
    if category_id:
        q = q.filter(category_alias.id.in_(category_id))
    if group_id:
        q = q.filter(group_alias.id.in_(group_id))
    # absolute amount filtering
    if min_amount is not None:
        q = q.filter(func.abs(models.Transaction.amount) >= min_amount)
    if max_amount is not None:
        q = q.filter(func.abs(models.Transaction.amount) <= max_amount)
    if search:
        q = q.filter(models.Transaction.memo.ilike(f"%{search}%"))
    sort_key = (sort_by or "occurred_at").lower()
    order_key = sort_order.lower() if sort_order else "desc"
    sort_columns: dict[str, list] = {
        "occurred_at": [models.Transaction.occurred_at],
        "amount": [models.Transaction.amount],
        "type": [models.Transaction.type],
        "currency": [models.Transaction.currency],
        "memo": [models.Transaction.memo],
        "category": [category_alias.full_code, category_alias.name],
        "category_group": [group_alias.type, group_alias.code_gg, group_alias.name],
    }
    selected_sort = sort_columns.get(sort_key, sort_columns["occurred_at"])
    order_exprs = [expr.desc() if order_key == "desc" else expr.asc() for expr in selected_sort]
    # stable ordering fallback
    order_exprs.append(models.Transaction.id.desc() if order_key == "desc" else models.Transaction.id.asc())
    total = q.count()
    response.headers["X-Total-Count"] = str(total)
    rows = (
        q.order_by(*order_exprs)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return rows


def _apply_balance(db: Session, account_id: int | None, delta: float) -> None:
    if account_id is None or delta == 0:
        return
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if acc:
        if acc.type in (models.AccountType.CHECK_CARD, models.AccountType.CREDIT_CARD):
            acc.balance = 0.0
            return
        acc.balance = float(acc.balance or 0.0) + float(delta)


def _apply_single_transfer_effect(db: Session, account_id: int, counter_account_id: int | None, amount: float) -> None:
    """Apply balance changes for a single-row transfer.

    `amount` is signed from the perspective of `account_id`. The counter account
    receives the opposite delta when provided and different from the source.
    """
    _apply_balance(db, account_id, amount)
    if counter_account_id and counter_account_id != account_id:
        _apply_balance(db, counter_account_id, -amount)


def _revert_single_transfer_effect(db: Session, account_id: int, counter_account_id: int | None, amount: float) -> None:
    """Revert previously applied single-row transfer balance changes."""
    _apply_balance(db, account_id, -amount)
    if counter_account_id and counter_account_id != account_id:
        _apply_balance(db, counter_account_id, amount)


def _is_effectively_neutral_entry(data: dict[str, object]) -> bool:
    return bool(data.get("is_balance_neutral") or data.get("exclude_from_reports"))


def _is_effectively_neutral_txn(tx: models.Transaction) -> bool:
    return bool(tx.is_balance_neutral or getattr(tx, "exclude_from_reports", False))


def _add_month(year: int, month: int, delta: int) -> tuple[int, int]:
    total = year * 12 + (month - 1) + delta
    new_year = total // 12
    new_month = total % 12 + 1
    return new_year, new_month


def _clamp_day(year: int, month: int, day: int) -> date:
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(day, last_day))


def _compute_credit_card_statement_window(account: models.Account, occurred_at: date) -> tuple[date, date, date]:
    if not account.billing_cutoff_day or not account.payment_day:
        raise HTTPException(status_code=400, detail="Credit card account schedule is not configured")
    cutoff_day = int(account.billing_cutoff_day)
    payment_day = int(account.payment_day)

    if occurred_at.day <= cutoff_day:
        end_year, end_month = occurred_at.year, occurred_at.month
    else:
        end_year, end_month = _add_month(occurred_at.year, occurred_at.month, 1)

    period_end = _clamp_day(end_year, end_month, cutoff_day)
    prev_year, prev_month = _add_month(end_year, end_month, -1)
    prev_period_end = _clamp_day(prev_year, prev_month, cutoff_day)
    period_start = prev_period_end + timedelta(days=1)

    due_year, due_month = _add_month(end_year, end_month, 1)
    due_date = _clamp_day(due_year, due_month, payment_day)

    return period_start, period_end, due_date


def _close_outdated_statements(db: Session, account_id: int, new_period_start: date) -> None:
    outdated = (
        db.query(models.CreditCardStatement)
        .filter(
            models.CreditCardStatement.account_id == account_id,
            models.CreditCardStatement.period_end < new_period_start,
            models.CreditCardStatement.status == models.CreditCardStatementStatus.PENDING,
        )
        .all()
    )
    for stmt in outdated:
        stmt.status = models.CreditCardStatementStatus.CLOSED
    if outdated:
        db.flush()


def _get_or_create_credit_card_statement(
    db: Session,
    account: models.Account,
    occurred_at: date,
) -> models.CreditCardStatement:
    period_start, period_end, due_date = _compute_credit_card_statement_window(account, occurred_at)
    _close_outdated_statements(db, account.id, period_start)

    stmt = (
        db.query(models.CreditCardStatement)
        .filter(
            models.CreditCardStatement.account_id == account.id,
            models.CreditCardStatement.period_start == period_start,
            models.CreditCardStatement.period_end == period_end,
        )
        .first()
    )
    if stmt:
        if stmt.status == models.CreditCardStatementStatus.CLOSED and occurred_at <= stmt.period_end:
            stmt.status = models.CreditCardStatementStatus.PENDING
        return stmt

    stmt = models.CreditCardStatement(
        user_id=account.user_id,
        account_id=account.id,
        period_start=period_start,
        period_end=period_end,
        due_date=due_date,
        total_amount=0.0,
        status=models.CreditCardStatementStatus.PENDING,
    )
    db.add(stmt)
    db.flush()
    return stmt


def _recalculate_statement_total(db: Session, statement: models.CreditCardStatement) -> None:
    sum_amount = (
        db.query(func.coalesce(func.sum(models.Transaction.amount), 0))
        .filter(
            models.Transaction.billing_cycle_id == statement.id,
            models.Transaction.status == models.TransactionStatus.PENDING_PAYMENT,
        )
        .scalar()
    )
    total = -float(sum_amount or 0)
    if total < 0:
        total = 0.0
    statement.total_amount = total
    db.flush()


def _update_credit_card_transaction(
    db: Session,
    tx: models.Transaction,
    changes: dict,
    *,
    current_account: models.Account | None = None,
    target_account: models.Account | None = None,
) -> models.Transaction:
    account = current_account or db.query(models.Account).filter(models.Account.id == tx.account_id).first()
    target_account_id = int(changes.get("account_id", tx.account_id))
    if target_account is None or target_account.id != target_account_id:
        target_account = db.query(models.Account).filter(models.Account.id == target_account_id).first()
    if not target_account or target_account.user_id != tx.user_id:
        raise HTTPException(status_code=400, detail="Invalid account for transaction")
    if target_account.type != models.AccountType.CREDIT_CARD:
        raise HTTPException(status_code=400, detail="Target account must be a credit card")
    if target_account_id != tx.account_id:
        raise HTTPException(status_code=400, detail="Credit card transactions cannot change account")
    account = target_account

    linked_account = None
    if account.linked_account_id:
        linked_account = (
            db.query(models.Account)
            .filter(models.Account.id == account.linked_account_id)
            .first()
        )

    occurred_at = changes.get("occurred_at", tx.occurred_at)
    statement = _get_or_create_credit_card_statement(db, account, occurred_at)
    old_statement = tx.billing_cycle

    for key, value in changes.items():
        setattr(tx, key, value)

    tx.billing_cycle_id = statement.id
    tx.is_balance_neutral = True
    tx.card_id = account.id
    tx.is_card_charge = True
    if tx.status != models.TransactionStatus.CLEARED:
        tx.status = models.TransactionStatus.PENDING_PAYMENT

    txn_currency = tx.currency or account.currency or (linked_account.currency if linked_account else None)
    if account.currency and txn_currency and txn_currency != account.currency:
        raise HTTPException(status_code=400, detail="Currency must match credit card account")
    if linked_account and linked_account.currency and txn_currency and txn_currency != linked_account.currency:
        raise HTTPException(status_code=400, detail="Currency must match linked deposit account")
    if not txn_currency:
        txn_currency = account.currency or (linked_account.currency if linked_account else None)
    if not txn_currency:
        raise HTTPException(status_code=400, detail="Currency is required for credit card transactions")
    tx.currency = txn_currency

    db.flush()
    if old_statement and old_statement.id != statement.id:
        _recalculate_statement_total(db, old_statement)
    _recalculate_statement_total(db, statement)
    return tx

def _sync_check_card_auto_deduct(
    db: Session,
    tx: models.Transaction,
    *,
    account: models.Account | None = None,
    remove: bool = False,
) -> None:
    account = account or db.query(models.Account).filter(models.Account.id == tx.account_id).first()
    if not account:
        return
    is_check_card = account.type == models.AccountType.CHECK_CARD
    if not is_check_card and not remove:
        return

    existing: models.Transaction | None = None
    if tx.linked_transaction_id:
        existing = (
            db.query(models.Transaction)
            .filter(models.Transaction.id == tx.linked_transaction_id)
            .first()
        )
    if not existing:
        existing = (
            db.query(models.Transaction)
            .filter(models.Transaction.linked_transaction_id == tx.id)
            .first()
        )

    def _delete_existing(target: models.Transaction | None) -> None:
        if not target:
            return
        if not _is_effectively_neutral_txn(target):
            _apply_balance(db, target.account_id, -float(target.amount))
        target.linked_transaction_id = None
        db.flush()
        db.delete(target)
        db.flush()
        tx.linked_transaction_id = None
        db.flush()

    # Always reflect CHECK_CARD usage to linked deposit if available.
    # auto_deduct flag is ignored to align with domain: debit card settles at usage time.
    if remove or not account.linked_account_id:
        _delete_existing(existing)
        return

    deposit = (
        db.query(models.Account)
        .filter(models.Account.id == account.linked_account_id, models.Account.user_id == account.user_id)
        .first()
    )
    if not deposit:
        _delete_existing(existing)
        return

    amount = float(tx.amount)
    if amount >= 0:
        _delete_existing(existing)
        return

    desired_currency = deposit.currency or tx.currency

    if existing:
        prior_account_id = existing.account_id
        prior_amount = float(existing.amount)
        if not _is_effectively_neutral_txn(existing):
            _apply_balance(db, prior_account_id, -prior_amount)
        existing.account_id = deposit.id
        existing.counter_account_id = account.id
        existing.user_id = tx.user_id
        existing.amount = amount
        existing.currency = desired_currency
        existing.occurred_at = tx.occurred_at
        existing.occurred_time = tx.occurred_time
        existing.memo = tx.memo
        existing.payee_id = tx.payee_id
        existing.type = models.TxnType.TRANSFER
        existing.group_id = None
        existing.external_id = None
        existing.is_auto_transfer_match = False
        existing.is_balance_neutral = False
        existing.exclude_from_reports = False
        existing.linked_transaction_id = tx.id
        db.flush()
        if not _is_effectively_neutral_txn(existing):
            _apply_balance(db, existing.account_id, float(existing.amount))
        tx.linked_transaction_id = existing.id
        db.flush()
        return

    deposit_tx = models.Transaction(
        user_id=tx.user_id,
        occurred_at=tx.occurred_at,
        occurred_time=tx.occurred_time,
        type=models.TxnType.TRANSFER,
        account_id=deposit.id,
        counter_account_id=account.id,
        category_id=None,
        amount=amount,
        currency=desired_currency,
        memo=tx.memo,
        payee_id=tx.payee_id,
        external_id=None,
        is_balance_neutral=False,
        is_auto_transfer_match=False,
        exclude_from_reports=False,
        linked_transaction_id=tx.id,
    )
    db.add(deposit_tx)
    db.flush()
    _apply_balance(db, deposit_tx.account_id, float(deposit_tx.amount))
    tx.linked_transaction_id = deposit_tx.id
    db.flush()


def _clear_linked_transaction_pointer(db: Session, tx: models.Transaction) -> None:
    other: models.Transaction | None = None
    if tx.linked_transaction_id:
        other = (
            db.query(models.Transaction)
            .filter(models.Transaction.id == tx.linked_transaction_id)
            .first()
        )
    if not other:
        other = (
            db.query(models.Transaction)
            .filter(models.Transaction.linked_transaction_id == tx.id)
            .first()
        )
    if other and other.linked_transaction_id == tx.id:
        other.linked_transaction_id = None
    tx.linked_transaction_id = None
    db.flush()


def _ensure_global_uncategorized_defaults(db: Session) -> None:
    """Ensure global default groups/categories (I/E/T 00-00 미분류) exist once."""
    for t in ("I", "E", "T"):
        group = (
            db.query(models.CategoryGroup)
            .filter(
                models.CategoryGroup.type == t,
                models.CategoryGroup.code_gg == 0,
            )
            .first()
        )
        if not group:
            group = models.CategoryGroup(type=t, code_gg=0, name="미분류")
            db.add(group)
            db.flush()
        else:
            if group.name != "미분류":
                group.name = "미분류"

        cat = (
            db.query(models.Category)
            .filter(
                models.Category.group_id == group.id,
                models.Category.code_cc == 0,
            )
            .first()
        )
        full_code = f"{t}0000"
        if not cat:
            db.add(
                models.Category(
                    group_id=group.id,
                    code_cc=0,
                    name="미분류",
                    full_code=full_code,
                )
            )
        else:
            cat.name = "미분류"
            cat.full_code = full_code


def _get_default_category_id(db: Session, *, txn_type: models.TxnType) -> int | None:
    if txn_type == models.TxnType.TRANSFER:
        return None

    type_code = "I" if txn_type == models.TxnType.INCOME else "E"
    group = (
        db.query(models.CategoryGroup)
        .filter(
            models.CategoryGroup.type == type_code,
            models.CategoryGroup.code_gg == 0,
        )
        .first()
    )
    if not group:
        _ensure_global_uncategorized_defaults(db)
        group = (
            db.query(models.CategoryGroup)
            .filter(models.CategoryGroup.type == type_code, models.CategoryGroup.code_gg == 0)
            .first()
        )
    if group is None:
        return None
    category = (
        db.query(models.Category)
        .filter(models.Category.group_id == group.id, models.Category.code_cc == 0)
        .first()
    )
    if not category:
        _ensure_global_uncategorized_defaults(db)
        category = (
            db.query(models.Category)
            .filter(models.Category.group_id == group.id, models.Category.code_cc == 0)
            .first()
        )
    return category.id if category else None


def _reset_transactions_for_user(db: Session, user_id: int) -> int:
    txns = db.query(models.Transaction).filter(models.Transaction.user_id == user_id).all()
    if not txns:
        return 0

    txn_ids = [tx.id for tx in txns]
    if txn_ids:
        db.query(models.TransactionTag).filter(models.TransactionTag.transaction_id.in_(txn_ids)).delete(synchronize_session=False)

    group_map: dict[int, list[models.Transaction]] = {}
    singles: list[models.Transaction] = []
    group_ids: set[int] = set()

    for tx in txns:
        if tx.group_id:
            gid = tx.group_id
            group_ids.add(gid)
            group_map.setdefault(gid, []).append(tx)
        else:
            singles.append(tx)

    for tx in singles:
        _sync_check_card_auto_deduct(db, tx, remove=True)
        if not _is_effectively_neutral_txn(tx):
            if tx.type == models.TxnType.TRANSFER and tx.is_auto_transfer_match and tx.counter_account_id:
                _revert_single_transfer_effect(db, tx.account_id, tx.counter_account_id, float(tx.amount))
            else:
                _apply_balance(db, tx.account_id, -float(tx.amount))
        db.delete(tx)

    for gid, rows in group_map.items():
        for tx in rows:
            _sync_check_card_auto_deduct(db, tx, remove=True)
            if not _is_effectively_neutral_txn(tx):
                _apply_balance(db, tx.account_id, -float(tx.amount))
            db.delete(tx)
    # ensure pending deletes are flushed before removing transfer groups (SQLite FK enforcement)
    db.flush()
    if group_ids:
        db.query(models.TransferGroup).filter(models.TransferGroup.id.in_(group_ids)).delete(synchronize_session=False)

    return len(txn_ids)


def _reset_credit_card_statements_for_user(db: Session, user_id: int) -> int:
    """Delete all credit card statements for a user and clear back-references.

    Assumes transactions referencing these statements are already deleted by
    _reset_transactions_for_user or will be removed in the same request.
    """
    stmts = (
        db.query(models.CreditCardStatement)
        .filter(models.CreditCardStatement.user_id == user_id)
        .all()
    )
    if not stmts:
        return 0
    stmt_ids = [s.id for s in stmts]  # Delete ALL statements, not just PENDING
    # Clear settlement_transaction_id references to avoid FK issues
    (
        db.query(models.CreditCardStatement)
        .filter(models.CreditCardStatement.id.in_(stmt_ids))
        .update({models.CreditCardStatement.settlement_transaction_id: None}, synchronize_session=False)
    )
    db.flush()
    (
        db.query(models.CreditCardStatement)
        .filter(models.CreditCardStatement.id.in_(stmt_ids))
        .delete(synchronize_session=False)
    )
    return len(stmt_ids)


def get_or_create_account_by_name(db: Session, user_id: int, name: str) -> models.Account:
    acc = (
        db.query(models.Account)
        .filter(models.Account.user_id == user_id, models.Account.name == name)
        .first()
    )
    if acc:
        return acc
    # 기본값: type=OTHER, currency는 사용자 프로필 기반 고려 가능. 일단 None.
    acc = models.Account(
        user_id=user_id,
        name=name,
        type=models.AccountType.OTHER,
        current_balance=0,
    )
    acc.auto_deduct = False
    db.add(acc)
    db.flush()
    return acc


def get_or_create_category_by_names(
    db: Session, group_name: str, category_name: str, type_hint: str | None = None
) -> models.Category:
    """Get or create a Category by human names, aligning codes across users.

    Behavior changes:
    - If a group with the same name and type exists for ANY user, try to reuse its code_gg for this user's group (if available).
    - If a category with the same name exists under a group with the same type/code_gg for ANY user, try to reuse its code_cc (if available) for this user's category.
    - Falls back to the next available code when conflicts occur within the current user.
    """
    # Determine target type
    t = type_hint if type_hint in ("I", "E", "T") else "E"

    # 1) Find or create group globally by name/type, aligning code_gg
    norm_group_name = _normalize_label(group_name)
    group: models.CategoryGroup | None = None
    all_groups_same_type = (
        db.query(models.CategoryGroup)
        .filter(models.CategoryGroup.type == t)
        .all()
    )
    for g in all_groups_same_type:
        if _normalize_label(g.name) == norm_group_name:
            group = g
            break
    if not group:
        ref_group = next((gg for gg in all_groups_same_type if _normalize_label(gg.name) == norm_group_name), None)
        desired_gg: int | None = ref_group.code_gg if ref_group else None
        if desired_gg is not None:
            conflict = (
                db.query(models.CategoryGroup)
                .filter(models.CategoryGroup.type == t, models.CategoryGroup.code_gg == desired_gg)
                .first()
            )
            if conflict is None:
                chosen_gg = desired_gg
            else:
                max_gg = (
                    db.query(models.CategoryGroup)
                    .filter(models.CategoryGroup.type == t)
                    .with_entities(models.CategoryGroup.code_gg)
                    .order_by(models.CategoryGroup.code_gg.desc())
                    .first()
                )
                chosen_gg = (max_gg[0] + 1) if max_gg and max_gg[0] < 99 else 1
        else:
            max_gg = (
                db.query(models.CategoryGroup)
                .filter(models.CategoryGroup.type == t)
                .with_entities(models.CategoryGroup.code_gg)
                .order_by(models.CategoryGroup.code_gg.desc())
                .first()
            )
            chosen_gg = (max_gg[0] + 1) if max_gg and max_gg[0] < 99 else 1

        group = models.CategoryGroup(type=t, code_gg=chosen_gg, name=group_name)
        db.add(group)
        db.flush()

    # 2) Find or create category under the group, trying to align code_cc
    # Find existing category in this group by normalized name
    norm_cat_name = _normalize_label(category_name)
    cat: models.Category | None = None
    user_group_cats = (
        db.query(models.Category)
        .filter(models.Category.group_id == group.id)
        .all()
    )
    for c in user_group_cats:
        if _normalize_label(c.name) == norm_cat_name:
            cat = c
            break
    if cat:
        return cat

    desired_cc: int | None = None
    # Reference category from any user in groups sharing same type and code_gg
    ref_group_ids = [gid for (gid,) in (
        db.query(models.CategoryGroup.id)
        .filter(
            models.CategoryGroup.type == group.type,
            models.CategoryGroup.code_gg == group.code_gg,
        )
        .all()
    )]
    if ref_group_ids:
        # Find a reference category across users by normalized name
        peer_cats = (
            db.query(models.Category)
            .filter(models.Category.group_id.in_(ref_group_ids))
            .all()
        )
        for pc in sorted(peer_cats, key=lambda x: x.code_cc):
            if _normalize_label(pc.name) == norm_cat_name:
                desired_cc = pc.code_cc
                break

    # Check if desired_cc is free for current user's group
    if desired_cc is not None:
        cc_conflict = (
            db.query(models.Category)
            .filter(models.Category.group_id == group.id, models.Category.code_cc == desired_cc)
            .first()
        )
        if cc_conflict is None:
            code_cc = desired_cc
        else:
            max_cc = (
                db.query(models.Category)
                .filter(models.Category.group_id == group.id)
                .with_entities(models.Category.code_cc)
                .order_by(models.Category.code_cc.desc())
                .first()
            )
            code_cc = (max_cc[0] + 1) if max_cc and max_cc[0] < 99 else 1
    else:
        max_cc = (
            db.query(models.Category)
            .filter(models.Category.group_id == group.id)
            .with_entities(models.Category.code_cc)
            .order_by(models.Category.code_cc.desc())
            .first()
        )
        code_cc = (max_cc[0] + 1) if max_cc and max_cc[0] < 99 else 1

    full_code = f"{group.type}{group.code_gg:02d}{code_cc:02d}"
    cat = models.Category(
        group_id=group.id,
        code_cc=code_cc,
        name=category_name,
        full_code=full_code,
    )
    db.add(cat)
    db.flush()
    return cat



@router.post("/credit-card-statements/{statement_id}/settle", response_model=CreditCardStatementOut)
def settle_credit_card_statement(
    statement_id: int,
    payload: CreditCardStatementSettleRequest,
    db: Session = Depends(get_db),
):
    statement = (
        db.query(models.CreditCardStatement)
        .filter(models.CreditCardStatement.id == statement_id)
        .first()
    )
    if not statement:
        raise HTTPException(status_code=404, detail="Statement not found")
    if statement.status == models.CreditCardStatementStatus.PAID:
        raise HTTPException(status_code=409, detail="Statement already settled")

    account = statement.account
    if account.type != models.AccountType.CREDIT_CARD:
        raise HTTPException(status_code=400, detail="Statement account is not a credit card")
    if not account.linked_account_id:
        raise HTTPException(status_code=400, detail="Credit card requires linked deposit for settlement")

    linked_account = (
        db.query(models.Account)
        .filter(models.Account.id == account.linked_account_id)
        .first()
    )
    if not linked_account:
        raise HTTPException(status_code=400, detail="Linked deposit account not found")

    _recalculate_statement_total(db, statement)
    outstanding = float(statement.total_amount or 0)
    if outstanding <= 0:
        raise HTTPException(status_code=400, detail="No pending amount to settle")

    # Use the statement's due_date as the settlement date, or allow manual override
    occurred_at = payload.occurred_at or statement.due_date

    category_id = payload.category_id
    if category_id is not None:
        cat = (
            db.query(models.Category)
            .filter(models.Category.id == category_id)
            .first()
        )
        if not cat:
            raise HTTPException(status_code=400, detail="Invalid category_id")
        group = db.query(models.CategoryGroup).filter(models.CategoryGroup.id == cat.group_id).first()
        if not group or group.type != "E":
            raise HTTPException(status_code=400, detail="Category must be an expense category")
    memo = payload.memo or f"{account.name} {statement.period_end.isoformat()} 결제"
    settlement_currency = linked_account.currency or account.currency
    if settlement_currency is None:
        user_profile = (
            db.query(models.UserProfile)
            .filter(models.UserProfile.user_id == account.user_id)
            .first()
        )
        if user_profile and user_profile.base_currency:
            settlement_currency = user_profile.base_currency
        else:
            raise HTTPException(status_code=400, detail="Unable to determine settlement currency")
    if account.currency and linked_account.currency and account.currency != linked_account.currency:
        raise HTTPException(status_code=400, detail="Credit card and linked deposit currency mismatch")
    card_currency = account.currency or settlement_currency

    settlement_tx = models.Transaction(
        user_id=account.user_id,
        occurred_at=occurred_at,
        occurred_time=None,
        type=models.TxnType.SETTLEMENT,
        account_id=linked_account.id,
    counter_account_id=account.id,
        card_id=account.id,
        category_id=category_id,
        amount=-outstanding,
        currency=settlement_currency,
        memo=memo,
        payee_id=None,
        external_id=None,
        imported_source_id=None,
        is_balance_neutral=False,
        is_auto_transfer_match=False,
        exclude_from_reports=False,
        status=models.TransactionStatus.CLEARED,
        billing_cycle_id=statement.id,
        is_card_charge=False,
    )
    db.add(settlement_tx)
    db.flush()
    _apply_balance(db, settlement_tx.account_id, float(settlement_tx.amount))

    card_entry: models.Transaction | None = None
    if payload.create_card_entry:
        card_entry = models.Transaction(
            user_id=account.user_id,
            occurred_at=occurred_at,
            occurred_time=None,
            type=models.TxnType.SETTLEMENT,
            account_id=account.id,
            counter_account_id=linked_account.id,
            category_id=None,
            amount=outstanding,
            currency=card_currency,
            memo=memo,
            payee_id=None,
            external_id=None,
            imported_source_id=None,
            card_id=account.id,
            is_balance_neutral=True,
            is_auto_transfer_match=False,
            exclude_from_reports=False,
            status=models.TransactionStatus.CLEARED,
            billing_cycle_id=statement.id,
            linked_transaction_id=settlement_tx.id,
            is_card_charge=False,
        )
        db.add(card_entry)
        db.flush()
        settlement_tx.linked_transaction_id = card_entry.id

    (
        db.query(models.Transaction)
        .filter(
            models.Transaction.billing_cycle_id == statement.id,
            models.Transaction.status == models.TransactionStatus.PENDING_PAYMENT,
        )
        .update({models.Transaction.status: models.TransactionStatus.CLEARED}, synchronize_session=False)
    )

    statement.status = models.CreditCardStatementStatus.PAID
    statement.settlement_transaction_id = settlement_tx.id
    statement.total_amount = 0.0
    _recalculate_statement_total(db, statement)

    db.commit()
    db.refresh(statement)
    return statement


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db)):
    # full_code는 API 입력 대신 서버에서 생성: group.type + gg + cc
    group = db.query(models.CategoryGroup).filter(models.CategoryGroup.id == payload.group_id).first()
    if not group:
        raise HTTPException(status_code=400, detail="Invalid group_id")
    # 중복 검사: group_id, code_cc 또는 full_code (global)
    dup = (
        db.query(models.Category)
        .filter(
            models.Category.group_id == payload.group_id,
            models.Category.code_cc == payload.code_cc,
        )
        .first()
    )
    if dup:
        raise HTTPException(status_code=409, detail="Category code already exists in group")
    # prevent creating CC=00 unless this is the uncategorized group and intended default
    if payload.code_cc == 0 and group.code_gg != 0:
        raise HTTPException(status_code=400, detail="CC=00 is reserved for default uncategorized")
    full_code = f"{group.type}{group.code_gg:02d}{payload.code_cc:02d}"
    item = models.Category(
        group_id=payload.group_id,
        code_cc=payload.code_cc,
        name=payload.name,
        full_code=full_code,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(
    response: Response,
    type: str | None = Query(None, pattern="^(I|E|T)$"),
    group_code: int | None = Query(None, ge=0, le=99),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    q = (
        db.query(models.Category)
        .join(models.CategoryGroup, models.Category.group_id == models.CategoryGroup.id)
    )
    if type:
        q = q.filter(models.CategoryGroup.type == type)
    if group_code is not None:
        q = q.filter(models.CategoryGroup.code_gg == group_code)
    if search:
        q = q.filter(models.Category.name.ilike(f"%{search}%"))
    total = q.count()
    response.headers["X-Total-Count"] = str(total)
    rows = (
        q.order_by(models.CategoryGroup.type, models.CategoryGroup.code_gg, models.Category.code_cc)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return rows


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def update_category(category_id: int, payload: CategoryUpdate, db: Session = Depends(get_db)):
    cat = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    data = payload.model_dump(exclude_unset=True)
    if "code_cc" in data:
        # protect default 00 from change
        if cat.code_cc == 0:
            raise HTTPException(status_code=400, detail="Default category (CC=00) code cannot be changed")
        if int(data["code_cc"]) == 0:
            raise HTTPException(status_code=400, detail="CC=00 is reserved and cannot be set")
        # uniqueness within (group_id, code_cc) globally
        dup = (
            db.query(models.Category)
            .filter(
                models.Category.group_id == cat.group_id,
                models.Category.code_cc == int(data["code_cc"]),
                models.Category.id != cat.id,
            )
            .first()
        )
        if dup:
            raise HTTPException(status_code=409, detail="Category code already exists in group")
        cat.code_cc = int(data["code_cc"])  # type: ignore
        # recalc full_code
        group = db.query(models.CategoryGroup).filter(models.CategoryGroup.id == cat.group_id).first()
        if group:
            cat.full_code = f"{group.type}{group.code_gg:02d}{cat.code_cc:02d}"
    if "name" in data:
        cat.name = data["name"]
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: int, reassign_to: int | None = Query(None), db: Session = Depends(get_db)):
    cat = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if cat.code_cc == 0:
        raise HTTPException(status_code=400, detail="Default category (CC=00) cannot be deleted")
    # check references
    ref = db.query(models.Transaction).filter(models.Transaction.category_id == category_id).first()
    if ref:
        # try default uncategorized if not provided
        target = None
        if not reassign_to:
            g1 = db.query(models.CategoryGroup).filter(models.CategoryGroup.id == cat.group_id).first()
            if g1:
                def_group = db.query(models.CategoryGroup).filter(
                    models.CategoryGroup.type == g1.type,
                    models.CategoryGroup.code_gg == 0,
                ).first()
                if def_group:
                    target = db.query(models.Category).filter(
                        models.Category.group_id == def_group.id,
                        models.Category.code_cc == 0,
                    ).first()
        else:
            target = db.query(models.Category).filter(models.Category.id == reassign_to).first()

        if not target:
            raise HTTPException(status_code=409, detail="Category in use; specify valid reassign_to or ensure default uncategorized exists")

        # type compatibility: same type
        g1 = db.query(models.CategoryGroup).filter(models.CategoryGroup.id == cat.group_id).first()
        g2 = db.query(models.CategoryGroup).filter(models.CategoryGroup.id == target.group_id).first()
        if not g1 or not g2 or g1.type != g2.type:
            raise HTTPException(status_code=400, detail="Reassign target must be same type")

        db.query(models.Transaction).filter(models.Transaction.category_id == category_id).update({models.Transaction.category_id: target.id})
    db.delete(cat)
    db.commit()
    return None


@router.post("/maintenance/reset-transactions", response_model=ResetResult)
def reset_transactions(payload: ResetRequest, db: Session = Depends(get_db)):
    removed_tx = _reset_transactions_for_user(db, payload.user_id)
    removed_statements = _reset_credit_card_statements_for_user(db, payload.user_id)
    db.commit()
    return ResetResult(removed=removed_tx + removed_statements, details={"transactions_removed": removed_tx, "statements_removed": removed_statements})


@router.post("/maintenance/reset-categories", response_model=ResetResult)
def reset_categories(payload: ResetRequest, db: Session = Depends(get_db)):
    removed_tx = _reset_transactions_for_user(db, payload.user_id)
    removed_statements = _reset_credit_card_statements_for_user(db, payload.user_id)
    recurring_cleared = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.user_id == payload.user_id)
        .delete(synchronize_session=False)
    )
    budgets_removed = (
        db.query(models.Budget)
        .filter(models.Budget.user_id == payload.user_id)
        .delete(synchronize_session=False)
    )
    # Global categories/groups are shared; don't delete them on user reset.
    cats_removed = 0
    groups_removed = 0
    _ensure_global_uncategorized_defaults(db)
    db.commit()
    return ResetResult(
        removed=cats_removed,
        details={
            "categories_removed": cats_removed,
            "groups_removed": groups_removed,
            "transactions_removed": removed_tx,
            "statements_removed": removed_statements,
            "budgets_removed": budgets_removed,
            "recurring_rules_detached": recurring_cleared,
        },
    )


@router.post("/maintenance/hard-reset-categories", response_model=ResetResult)
def hard_reset_categories(db: Session = Depends(get_db)):
    """강제 전역 초기화: 모든 카테고리/그룹을 제거하고 전역 기본값만 재생성한다.

    주의: 모든 트랜잭션/예산/정기규칙의 category_id를 NULL로 설정한다.
    """
    # 1) 참조 해제
    detached_tx = (
        db.query(models.Transaction)
        .filter(models.Transaction.category_id.isnot(None))
        .update({models.Transaction.category_id: None}, synchronize_session=False)
    )
    detached_budgets = (
        db.query(models.Budget)
        .filter(models.Budget.category_id.isnot(None))
        .update({models.Budget.category_id: None}, synchronize_session=False)
    )
    detached_rules = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.category_id.isnot(None))
        .update({models.RecurringRule.category_id: None}, synchronize_session=False)
    )

    # 2) 전체 삭제 (전역 카테고리/그룹)
    cats_removed = db.query(models.Category).delete(synchronize_session=False)
    groups_removed = db.query(models.CategoryGroup).delete(synchronize_session=False)

    # 3) 기본 전역 미분류 생성
    _ensure_global_uncategorized_defaults(db)
    db.commit()

    return ResetResult(
        removed=cats_removed + groups_removed,
        details={
            "categories_removed": cats_removed,
            "groups_removed": groups_removed,
            "transactions_category_detached": detached_tx,
            "budgets_category_detached": detached_budgets,
            "recurring_rules_category_detached": detached_rules,
        },
    )


@router.post("/maintenance/reset-accounts", response_model=ResetResult)
def reset_accounts(payload: ResetRequest, db: Session = Depends(get_db)):
    """사용자의 모든 계좌 및 관련 데이터를 삭제합니다.
    
    - 트랜잭션, 예산, 정기 규칙, 카드 명세서 모두 삭제
    - 마지막으로 계좌 자체를 삭제
    """
    # 1) 트랜잭션 삭제
    removed_tx = _reset_transactions_for_user(db, payload.user_id)
    
    # 2) 카드 명세서 삭제
    removed_statements = _reset_credit_card_statements_for_user(db, payload.user_id)
    
    # 3) 예산 삭제
    budgets_removed = (
        db.query(models.Budget)
        .filter(models.Budget.user_id == payload.user_id)
        .delete(synchronize_session=False)
    )
    
    # 4) 정기 규칙 삭제
    drafts_removed = (
        db.query(models.RecurringOccurrenceDraft)
        .filter(models.RecurringOccurrenceDraft.user_id == payload.user_id)
        .delete(synchronize_session=False)
    )
    rules_removed = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.user_id == payload.user_id)
        .delete(synchronize_session=False)
    )
    
    # 5) 계좌 삭제
    accounts_removed = (
        db.query(models.Account)
        .filter(models.Account.user_id == payload.user_id)
        .delete(synchronize_session=False)
    )
    
    db.commit()
    return ResetResult(
        removed=accounts_removed,
        details={
            "accounts_removed": accounts_removed,
            "transactions_removed": removed_tx,
            "statements_removed": removed_statements,
            "budgets_removed": budgets_removed,
            "recurring_rules_removed": rules_removed,
        },
    )


@router.post("/maintenance/reset-recurring", response_model=ResetResult)
def reset_recurring(payload: ResetRequest, db: Session = Depends(get_db)):
    """사용자 기준 정기 규칙 리셋.

    - 해당 사용자의 RecurringOccurrenceDraft 전부 삭제
    - 해당 사용자의 RecurringRule 전부 삭제
    - 해당 사용자의 트랜잭션 중 external_id가 rule- 접두사인 경우 연결 해제(external_id NULL)

    트랜잭션 자체는 삭제하지 않는다(사용자가 수동으로 붙인 기존 실거래 보존).
    """
    # 1) detach transactions that were linked to recurring occurrences
    detached_tx = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.user_id == payload.user_id,
            models.Transaction.external_id.isnot(None),
            models.Transaction.external_id.like("rule-%"),
        )
        .update({models.Transaction.external_id: None}, synchronize_session=False)
    )

    # 2) delete occurrence drafts for the user
    drafts_removed = (
        db.query(models.RecurringOccurrenceDraft)
        .filter(models.RecurringOccurrenceDraft.user_id == payload.user_id)
        .delete(synchronize_session=False)
    )

    # 3) delete recurring rules for the user
    rules_removed = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.user_id == payload.user_id)
        .delete(synchronize_session=False)
    )

    db.commit()
    return ResetResult(
        removed=rules_removed + drafts_removed,
        details={
            "recurring_rules_removed": rules_removed,
            "drafts_removed": drafts_removed,
            "transactions_detached": detached_tx,
        },
    )


@router.get("/maintenance/backups", response_model=BackupListOut)
def list_backups() -> BackupListOut:
    _ensure_backups_dir()
    with _METADATA_LOCK:
        metadata = _load_backup_metadata()
    backups: list[BackupInfo] = []
    for path in BACKUPS_DIR.glob("*.db"):
        if not path.is_file():
            continue
        backups.append(_backup_info_from_path(path, metadata))
    backups.sort(key=lambda item: item.created_at, reverse=True)
    return BackupListOut(backups=backups)


@router.post("/maintenance/backups", response_model=BackupInfo, status_code=201)
def create_backup(payload: BackupCreateRequest, db: Session = Depends(get_db)) -> BackupInfo:
    _ensure_backups_dir()
    db_path = _require_db_path()
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Database file not found")

    pending_statements = (
        db.query(models.CreditCardStatement)
        .filter(models.CreditCardStatement.status != models.CreditCardStatementStatus.PAID)
        .count()
    )

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    candidate = BACKUPS_DIR / f"app-{timestamp}.db"
    counter = 1
    while candidate.exists():
        candidate = BACKUPS_DIR / f"app-{timestamp}-{counter}.db"
        counter += 1

    _copy_sqlite_database(db_path, candidate)

    memo = (payload.memo or "").strip() or None
    with _METADATA_LOCK:
        metadata = _load_backup_metadata()
        metadata[candidate.name] = {
            "memo": memo,
            "pending_card_statements": pending_statements,
        }
        _save_backup_metadata(metadata)
        info = _backup_info_from_path(candidate, metadata)
    return info


@router.post("/maintenance/backups/apply", response_model=BackupApplyResult)
def apply_backup(payload: BackupApplyRequest, db: Session = Depends(get_db)) -> BackupApplyResult:
    backup_path = _resolve_backup_path(payload.filename)
    db_path = _require_db_path()
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Database file not found")
    engine = db.get_bind()
    db.close()
    if engine is not None:
        engine.dispose()
    for wal_path in _sqlite_wal_files(db_path):
        if wal_path.exists():
            wal_path.unlink()
    shutil.copy2(backup_path, db_path)
    return BackupApplyResult(applied=payload.filename)


@router.delete("/maintenance/backups/{filename}", response_model=BackupDeleteResult)
def delete_backup(filename: str) -> BackupDeleteResult:
    backup_path = _resolve_backup_path(filename)
    backup_path.unlink()
    with _METADATA_LOCK:
        metadata = _load_backup_metadata()
        if metadata.pop(filename, None) is not None:
            _save_backup_metadata(metadata)
    return BackupDeleteResult(deleted=filename)


@router.post("/transactions", response_model=TransactionOut, status_code=201)
def create_transaction(
    payload: TransactionCreate,
    db: Session = Depends(get_db),
    balance_neutral: bool = False,
    auto_transfer_match: bool = False,
):
    # Idempotency: (user_id, external_id)로 중복 방지
    if payload.external_id:
        exists = (
            db.query(models.Transaction)
            .filter(
                models.Transaction.user_id == payload.user_id,
                models.Transaction.external_id == payload.external_id,
            )
            .first()
        )
        if exists:
            return exists  # 멱등: 기존 리소스 반환

    data = payload.model_dump(exclude_unset=True)
    exclude_reports = bool(data.pop("exclude_from_reports", False))
    data["exclude_from_reports"] = exclude_reports
    data["is_balance_neutral"] = bool(data.get("is_balance_neutral") or balance_neutral or exclude_reports)
    data["is_auto_transfer_match"] = bool(data.get("is_auto_transfer_match") or auto_transfer_match)
    statement: models.CreditCardStatement | None = None
    neutral = _is_effectively_neutral_entry(data)

    # account_id 우선, 없으면 이름으로 생성/획득
    if not data.get("account_id"):
        if not payload.account_name:
            raise HTTPException(status_code=400, detail="account_id or account_name required")
        acc = get_or_create_account_by_name(db, payload.user_id, payload.account_name)
        data["account_id"] = acc.id

    account = (
        db.query(models.Account)
        .filter(models.Account.id == data["account_id"], models.Account.user_id == payload.user_id)
        .first()
    )
    if not account:
        raise HTTPException(status_code=400, detail="Invalid account_id for user")

    card_account: models.Account | None = None
    if data.get("card_id") is not None:
        card_account = (
            db.query(models.Account)
            .filter(
                models.Account.id == data["card_id"],
                models.Account.user_id == payload.user_id,
            )
            .first()
        )
        if not card_account or card_account.type != models.AccountType.CREDIT_CARD:
            raise HTTPException(status_code=400, detail="Invalid card_id for user")

    if account.type == models.AccountType.CREDIT_CARD:
        if payload.type not in (models.TxnType.EXPENSE, models.TxnType.INCOME):
            raise HTTPException(status_code=400, detail="Credit card transactions must be income or expense")
        card_account = account
        data["card_id"] = account.id
        data["is_balance_neutral"] = True
        data["is_card_charge"] = True
        data["exclude_from_reports"] = False
        neutral = True
        linked_account = None
        if account.linked_account_id:
            linked_account = (
                db.query(models.Account)
                .filter(models.Account.id == account.linked_account_id)
                .first()
            )
        statement = _get_or_create_credit_card_statement(db, account, payload.occurred_at)
        data["billing_cycle_id"] = statement.id
        data["status"] = models.TransactionStatus.PENDING_PAYMENT
        txn_currency = data.get("currency") or account.currency or (linked_account.currency if linked_account else None)
        if account.currency and txn_currency and txn_currency != account.currency:
            raise HTTPException(status_code=400, detail="Currency must match credit card account")
        if linked_account and linked_account.currency and txn_currency and txn_currency != linked_account.currency:
            raise HTTPException(status_code=400, detail="Currency must match linked deposit account")
        if not txn_currency and linked_account and linked_account.currency:
            txn_currency = linked_account.currency
        if not txn_currency and not account.currency:
            raise HTTPException(status_code=400, detail="Currency is required for credit card transactions")
        data["currency"] = txn_currency or account.currency

    if payload.type == models.TxnType.SETTLEMENT:
        if account.type == models.AccountType.CREDIT_CARD:
            raise HTTPException(status_code=400, detail="Settlement transactions must target a deposit or cash account")
        if data.get("card_id") is None:
            raise HTTPException(status_code=400, detail="card_id is required for settlement")
        if not card_account:
            card_account = (
                db.query(models.Account)
                .filter(
                    models.Account.id == data["card_id"],
                    models.Account.user_id == payload.user_id,
                )
                .first()
            )
        if not card_account or card_account.type != models.AccountType.CREDIT_CARD:
            raise HTTPException(status_code=400, detail="Settlement card_id must reference a credit card")
        statement_id = data.get("billing_cycle_id")
        if statement_id is None:
            raise HTTPException(status_code=400, detail="billing_cycle_id is required for settlement")
        stmt = (
            db.query(models.CreditCardStatement)
            .filter(
                models.CreditCardStatement.id == statement_id,
                models.CreditCardStatement.user_id == payload.user_id,
            )
            .first()
        )
        if not stmt:
            raise HTTPException(status_code=400, detail="Invalid billing_cycle_id for settlement")
        if stmt.account_id != card_account.id:
            raise HTTPException(status_code=400, detail="Statement does not belong to specified card")
        data["card_id"] = card_account.id
        data["is_balance_neutral"] = False
        data["is_card_charge"] = False
        neutral = False

    # 카테고리 처리 및 타입 일치 검증
    if payload.type in (models.TxnType.INCOME, models.TxnType.EXPENSE, models.TxnType.TRANSFER):
        expected = (
            "I"
            if payload.type == models.TxnType.INCOME
            else "E" if payload.type == models.TxnType.EXPENSE else "T"
        )
        has_category_input = bool(
            data.get("category_id") or (payload.category_group_name and payload.category_name)
        )
        if has_category_input:
            if not data.get("category_id"):
                if not (payload.category_group_name and payload.category_name):
                    raise HTTPException(status_code=400, detail="Category info incomplete")
                cat = get_or_create_category_by_names(
                    db,
                    group_name=payload.category_group_name,
                    category_name=payload.category_name,
                    type_hint=expected,
                )
                data["category_id"] = cat.id
            cat = db.query(models.Category).filter(models.Category.id == data["category_id"]).first()
            if not cat:
                raise HTTPException(status_code=400, detail="Invalid category_id")
            g = db.query(models.CategoryGroup).filter(models.CategoryGroup.id == cat.group_id).first()
            if not g or g.type != expected:
                raise HTTPException(status_code=400, detail="Category type mismatch with transaction type")
        elif payload.type != models.TxnType.TRANSFER:
            raise HTTPException(status_code=400, detail="category info required for income/expense")

    # 입력 전용 필드 제거
    for k in [
        "account_name",
        "counter_account_name",
        "category_group_name",
        "category_name",
        "transfer_flow",
    ]:
        data.pop(k, None)

    # TRANSFER 처리
    if payload.type == models.TxnType.TRANSFER:
        if not data.get("counter_account_id") and payload.counter_account_name:
            cacc = get_or_create_account_by_name(db, payload.user_id, payload.counter_account_name)
            data["counter_account_id"] = cacc.id

        if auto_transfer_match:
            if not data.get("counter_account_id"):
                raise HTTPException(status_code=400, detail="Auto-matched transfer requires counter account")
            direction = payload.transfer_flow or ("OUT" if float(data["amount"]) < 0 else "IN")
            magnitude = abs(float(data["amount"]))
            signed_amount = -magnitude if direction == "OUT" else magnitude
            data["amount"] = signed_amount
            data["is_balance_neutral"] = False
            data["is_auto_transfer_match"] = True
            data["exclude_from_reports"] = False
            item = models.Transaction(**data)
            db.add(item)
            _apply_single_transfer_effect(db, data["account_id"], data.get("counter_account_id"), signed_amount)
            db.commit()
            db.refresh(item)
            return item

        # 상대 계정이 없는 경우: 단일 전표로 기록(잔액 변화 없음)
        if not data.get("counter_account_id"):
            # DB 체크 제약 충족을 위해 counter_account_id를 자기 자신으로 설정
            data["counter_account_id"] = data["account_id"]
            item = models.Transaction(**data)
            db.add(item)
            if not neutral:
                _apply_balance(db, data["account_id"], float(data["amount"]))
            db.commit()
            db.refresh(item)
            return item
        # 상대 계정이 있는 경우: 자동 쌍 생성
        tg = models.TransferGroup()
        db.add(tg)
        db.flush()
        amount = data["amount"]
        transfer_category_id = data.get("category_id")
        # 출금 트랜잭션(요청 계정)
        out_tx = models.Transaction(**{
            **data,
            "group_id": tg.id,
            "amount": -abs(amount),
            "category_id": transfer_category_id,
            "is_auto_transfer_match": auto_transfer_match,
        })
        # 입금 트랜잭션(상대 계정)
        in_tx = models.Transaction(**{
            **data,
            "group_id": tg.id,
            "account_id": data["counter_account_id"],
            "counter_account_id": data["account_id"],
            "amount": abs(amount),
            "category_id": transfer_category_id,
            # 동일 external_id 사용 시 유니크 제약 충돌을 피하기 위해 쌍에는 external_id 미지정
            "external_id": None,
            "imported_source_id": None,
            "is_auto_transfer_match": auto_transfer_match,
        })
        if neutral:
            out_tx.is_balance_neutral = True
            in_tx.is_balance_neutral = True
        # 잔액 반영
        if not neutral:
            _apply_balance(db, data["account_id"], -abs(float(amount)))
            _apply_balance(db, data["counter_account_id"], abs(float(amount)))

        db.add_all([out_tx, in_tx])
        db.commit()
        db.refresh(out_tx)
        return out_tx

    item = models.Transaction(**data)
    db.add(item)
    db.flush()

    if not neutral and account.type not in (models.AccountType.CHECK_CARD, models.AccountType.CREDIT_CARD):
        _apply_balance(db, data["account_id"], float(data["amount"]))
    elif account.type == models.AccountType.CHECK_CARD:
        account.balance = 0.0
    elif account.type == models.AccountType.CREDIT_CARD:
        account.balance = 0.0
        if statement:
            _recalculate_statement_total(db, statement)

    if account.type == models.AccountType.CHECK_CARD:
        _sync_check_card_auto_deduct(db, item, account=account)

    db.commit()
    db.refresh(item)
    return item

@router.patch("/transactions/{txn_id}", response_model=TransactionOut)
def update_transaction(txn_id: int, payload: TransactionUpdate, db: Session = Depends(get_db)):
    tx = db.query(models.Transaction).filter(models.Transaction.id == txn_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return tx

    account = db.query(models.Account).filter(models.Account.id == tx.account_id).first()
    target_account = None
    target_account_id = changes.get("account_id", tx.account_id)
    if target_account_id == tx.account_id:
        target_account = account
    else:
        target_account = db.query(models.Account).filter(models.Account.id == target_account_id).first()

    if tx.billing_cycle_id or (account and account.type == models.AccountType.CREDIT_CARD) or (target_account and target_account.type == models.AccountType.CREDIT_CARD):
        updated = _update_credit_card_transaction(
            db,
            tx,
            changes,
            current_account=account,
            target_account=target_account,
        )
        db.commit()
        db.refresh(updated)
        return updated

    if tx.type == models.TxnType.TRANSFER and tx.group_id:
        siblings = (
            db.query(models.Transaction)
            .filter(models.Transaction.group_id == tx.group_id)
            .order_by(models.Transaction.id.asc())
            .all()
        )
        if len(siblings) != 2:
            raise HTTPException(status_code=409, detail="Invalid transfer pair state")

        out_tx = next((t for t in siblings if float(t.amount) < 0), siblings[0])
        in_tx = next((t for t in siblings if float(t.amount) > 0 and t.id != out_tx.id), siblings[1])

        old_src_id = out_tx.account_id
        old_dst_id = in_tx.account_id
        old_out_amt = float(out_tx.amount)
        old_in_amt = float(in_tx.amount)
        old_neutral = _is_effectively_neutral_txn(out_tx)

        if not old_neutral:
            _apply_balance(db, old_src_id, -old_out_amt)
            _apply_balance(db, old_dst_id, -old_in_amt)

        base_amount = abs(float(changes.get("amount", in_tx.amount)))
        new_src_id = int(changes.get("account_id", out_tx.account_id))

        out_tx.account_id = new_src_id
        out_tx.counter_account_id = old_dst_id
        out_tx.amount = -base_amount
        in_tx.account_id = old_dst_id
        in_tx.counter_account_id = new_src_id
        in_tx.amount = base_amount

        if "category_id" in changes:
            out_tx.category_id = changes["category_id"]
            in_tx.category_id = changes["category_id"]
        if "memo" in changes:
            out_tx.memo = changes["memo"]
            in_tx.memo = changes["memo"]
        if "currency" in changes:
            out_tx.currency = changes["currency"]
            in_tx.currency = changes["currency"]
        if "payee_id" in changes:
            out_tx.payee_id = changes["payee_id"]
            in_tx.payee_id = changes["payee_id"]
        if "occurred_at" in changes:
            out_tx.occurred_at = changes["occurred_at"]
            in_tx.occurred_at = changes["occurred_at"]
        if "occurred_time" in changes:
            out_tx.occurred_time = changes["occurred_time"]
            in_tx.occurred_time = changes["occurred_time"]
        if "exclude_from_reports" in changes:
            flag = bool(changes["exclude_from_reports"])
            out_tx.exclude_from_reports = flag
            in_tx.exclude_from_reports = flag
        if "is_balance_neutral" in changes:
            flag = bool(changes["is_balance_neutral"])
            out_tx.is_balance_neutral = flag
            in_tx.is_balance_neutral = flag

        new_neutral = _is_effectively_neutral_txn(out_tx)
        if not new_neutral:
            _apply_balance(db, out_tx.account_id, float(out_tx.amount))
            _apply_balance(db, in_tx.account_id, float(in_tx.amount))

        db.commit()
        db.refresh(tx)
        return tx

    if tx.type == models.TxnType.TRANSFER and not tx.group_id:
        if "category_id" in changes and changes["category_id"] is not None:
            cat = db.query(models.Category).filter(models.Category.id == changes["category_id"]).first()
            if not cat:
                raise HTTPException(status_code=400, detail="Invalid category_id")
            g = db.query(models.CategoryGroup).filter(models.CategoryGroup.id == cat.group_id).first()
            if not g or g.type != "T":
                raise HTTPException(status_code=400, detail="Category type mismatch with transaction type")

        old_account_id = tx.account_id
        old_counter_id = tx.counter_account_id
        old_amount = float(tx.amount)
        old_neutral = _is_effectively_neutral_txn(tx)

        if not old_neutral:
            if tx.is_auto_transfer_match and old_counter_id:
                _revert_single_transfer_effect(db, old_account_id, old_counter_id, old_amount)
            else:
                _apply_balance(db, old_account_id, -old_amount)

        for key, value in changes.items():
            setattr(tx, key, value)

        new_neutral = _is_effectively_neutral_txn(tx)
        if not new_neutral:
            if tx.is_auto_transfer_match and tx.counter_account_id:
                _apply_single_transfer_effect(db, tx.account_id, tx.counter_account_id, float(tx.amount))
            else:
                _apply_balance(db, tx.account_id, float(tx.amount))

        db.commit()
        db.refresh(tx)
        return tx

    # 타입 변경 처리
    old_type = tx.type
    new_type = changes.get("type", old_type)
    
    if new_type != old_type:
        # TRANSFER → INCOME/EXPENSE 또는 그 반대로 변환
        if old_type == models.TxnType.TRANSFER and new_type in (models.TxnType.INCOME, models.TxnType.EXPENSE):
            # TRANSFER → INCOME/EXPENSE: counter_account 제거, category 필요
            changes["counter_account_id"] = None
            if "category_id" not in changes or changes["category_id"] is None:
                raise HTTPException(status_code=400, detail="category_id required when converting TRANSFER to INCOME/EXPENSE")
        elif old_type in (models.TxnType.INCOME, models.TxnType.EXPENSE) and new_type == models.TxnType.TRANSFER:
            # INCOME/EXPENSE → TRANSFER: category 제거, counter_account 필요
            changes["category_id"] = None
            if "counter_account_id" not in changes or changes["counter_account_id"] is None:
                raise HTTPException(status_code=400, detail="counter_account_id required when converting to TRANSFER")
    
    if "category_id" in changes:
        target_type = new_type
        if target_type == models.TxnType.TRANSFER and changes["category_id"] is not None:
            raise HTTPException(status_code=400, detail="TRANSFER must not have category_id")
        if target_type in (models.TxnType.INCOME, models.TxnType.EXPENSE) and changes["category_id"] is not None:
            cat = db.query(models.Category).filter(models.Category.id == changes["category_id"]).first()
            if not cat:
                raise HTTPException(status_code=400, detail="Invalid category_id")
            g = db.query(models.CategoryGroup).filter(models.CategoryGroup.id == cat.group_id).first()
            expected = "I" if target_type == models.TxnType.INCOME else "E"
            if not g or g.type != expected:
                raise HTTPException(status_code=400, detail="Category type mismatch with transaction type")

    old_account_id = tx.account_id
    old_amount = float(tx.amount)
    old_neutral = _is_effectively_neutral_txn(tx)

    if not old_neutral:
        _apply_balance(db, old_account_id, -old_amount)

    for key, value in changes.items():
        setattr(tx, key, value)

    new_neutral = _is_effectively_neutral_txn(tx)
    if not new_neutral:
        _apply_balance(db, tx.account_id, float(tx.amount))

    _sync_check_card_auto_deduct(db, tx)

    db.commit()
    db.refresh(tx)
    return tx


@router.delete("/transactions/{txn_id}", status_code=204)
def delete_transaction(txn_id: int, db: Session = Depends(get_db)):
    tx = db.query(models.Transaction).filter(models.Transaction.id == txn_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    statement: models.CreditCardStatement | None = None
    if tx.billing_cycle_id:
        statement = (
            db.query(models.CreditCardStatement)
            .filter(models.CreditCardStatement.id == tx.billing_cycle_id)
            .first()
        )
    account = db.query(models.Account).filter(models.Account.id == tx.account_id).first()
    if account and account.type == models.AccountType.CHECK_CARD:
        _sync_check_card_auto_deduct(db, tx, remove=True)
    _clear_linked_transaction_pointer(db, tx)
    # transfer 그룹이면 쌍도 함께 삭제
    if tx.group_id:
        siblings = db.query(models.Transaction).filter(models.Transaction.group_id == tx.group_id).all()
        for s in siblings:
            # 잔액 되돌리기
            if not _is_effectively_neutral_txn(s):
                _apply_balance(db, s.account_id, -float(s.amount))
            db.delete(s)
    else:
        # 단일 전표(INCOME/EXPENSE/TRANSFER)는 현재 금액을 잔액에서 되돌린다
        if not _is_effectively_neutral_txn(tx):
            if tx.type == models.TxnType.TRANSFER and tx.is_auto_transfer_match and tx.counter_account_id:
                _revert_single_transfer_effect(db, tx.account_id, tx.counter_account_id, float(tx.amount))
            else:
                _apply_balance(db, tx.account_id, -float(tx.amount))
        db.delete(tx)
    db.flush()
    if statement:
        if statement.status != models.CreditCardStatementStatus.PAID:
            _recalculate_statement_total(db, statement)
    db.commit()
    return None


@router.post("/budgets", response_model=BudgetOut, status_code=201)
def create_budget(payload: BudgetCreate, db: Session = Depends(get_db)):
    # 중복 방지: user_id, category_id, period_start, period_end
    dup = (
        db.query(models.Budget)
        .filter(
            models.Budget.user_id == payload.user_id,
            models.Budget.category_id.is_(payload.category_id if payload.category_id is not None else None),
            models.Budget.period_start == payload.period_start,
            models.Budget.period_end == payload.period_end,
        )
        .first()
    )
    if dup:
        raise HTTPException(status_code=409, detail="Budget already exists for this period and category")

    item = models.Budget(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/budgets", response_model=list[BudgetOut])
def list_budgets(user_id: list[int] = Query(...), db: Session = Depends(get_db)):
    rows = (
        db.query(models.Budget)
        .filter(models.Budget.user_id.in_(user_id))
        .order_by(models.Budget.period_start.desc())
        .all()
    )
    return rows


@router.patch("/budgets/{budget_id}", response_model=BudgetOut)
def update_budget(budget_id: int, payload: BudgetUpdate, db: Session = Depends(get_db)):
    bd = db.query(models.Budget).filter(models.Budget.id == budget_id).first()
    if not bd:
        raise HTTPException(status_code=404, detail="Budget not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(bd, k, v)
    db.commit()
    db.refresh(bd)
    return bd


@router.delete("/budgets/{budget_id}", status_code=204)
def delete_budget(budget_id: int, db: Session = Depends(get_db)):
    bd = db.query(models.Budget).filter(models.Budget.id == budget_id).first()
    if not bd:
        raise HTTPException(status_code=404, detail="Budget not found")
    db.delete(bd)
    db.commit()
    return None


# ===== Recurring Rules =====

def _hash_recurring_candidate_key(key: tuple[Any, ...]) -> str:
    raw = json.dumps(key, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _load_excluded_candidate_hashes(db: Session, user_id: int) -> set[str]:
    rows = (
        db.query(models.RecurringCandidateExclusion.signature_hash)
        .filter(models.RecurringCandidateExclusion.user_id == user_id)
        .all()
    )
    return {row[0] for row in rows}


@router.post("/recurring/scan-candidates", response_model=list[RecurringScanCandidateOut])
def scan_recurring_candidates(payload: RecurringScanRequest, db: Session = Depends(get_db)):
    # Scan recent transactions and detect repeating patterns by (type, account, counter, category, currency, memo/payee signature)
    if payload.horizon_days <= 0:
        raise HTTPException(status_code=400, detail="horizon_days must be positive")
    start_date = date.today() - timedelta(days=payload.horizon_days)

    q = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.user_id == payload.user_id,
            models.Transaction.occurred_at >= start_date,
            models.Transaction.type.in_([models.TxnType.INCOME, models.TxnType.EXPENSE] + ([models.TxnType.TRANSFER] if payload.include_transfers else [])),
        )
        .order_by(models.Transaction.occurred_at.asc(), models.Transaction.id.asc())
    )
    rows: list[models.Transaction] = q.all()
    if not rows:
        return []

    excluded_hashes = _load_excluded_candidate_hashes(db, payload.user_id)

    def norm(s: str | None) -> str:
        if not s:
            return ""
        v = unicodedata.normalize("NFKC", s)
        v = v.strip().lower()
        v = re.sub(r"\s+", " ", v)
        v = re.sub(r"[\-_/\\.,()\[\]{}]+", "", v)
        return v

    groups: dict[tuple, list[models.Transaction]] = {}
    for tx in rows:
        if tx.type == models.TxnType.TRANSFER and not payload.include_transfers:
            continue
        # exclude txns already coming from a recurring rule (external_id starts with rule-)
        if tx.external_id and isinstance(tx.external_id, str) and tx.external_id.startswith("rule-"):
            continue
        # build signature
        # optionally ignore category for income/expense grouping
        category_key = None
        if tx.type in (models.TxnType.INCOME, models.TxnType.EXPENSE):
            category_key = None if payload.ignore_category else tx.category_id
        key = (
            tx.type.value,
            tx.account_id,
            tx.counter_account_id if tx.type == models.TxnType.TRANSFER else None,
            category_key if tx.type in (models.TxnType.INCOME, models.TxnType.EXPENSE) else None,
            tx.currency,
            norm(tx.memo)[:40],
            tx.payee_id or None,
        )
        groups.setdefault(key, []).append(tx)

    candidates: list[RecurringScanCandidateOut] = []
    for key, txns in groups.items():
        if len(txns) < payload.min_occurrences:
            continue
        unique_dates = sorted({t.occurred_at for t in txns if t.occurred_at is not None})
        if len(unique_dates) < payload.min_occurrences:
            continue
        freq, dom, wday, avg_interval = _detect_frequency(unique_dates)
        if not freq:
            continue
        signature_hash = _hash_recurring_candidate_key(key)
        if signature_hash in excluded_hashes:
            continue
        amts = [float(t.amount) for t in txns]
        mn, mx, avg, variable = _amount_stats(amts)
        # Decide representative amount sign per type
        base_amount = None
        if not variable and avg is not None:
            if txns[0].type == models.TxnType.EXPENSE:
                base_amount = abs(avg)
            elif txns[0].type == models.TxnType.INCOME:
                base_amount = abs(avg)
            else:
                base_amount = abs(avg)
        memo_value = txns[0].memo
        name = memo_value or ("이체" if txns[0].type == models.TxnType.TRANSFER else ("정기수입" if txns[0].type == models.TxnType.INCOME else "정기지출"))
        first_date = unique_dates[0]
        last_date = unique_dates[-1]
        # build history for backfill (date + actual signed amount + memo)
        history_items = []
        for t in txns:
            if not t.occurred_at:
                continue
            # keep original sign as stored
            history_items.append({
                "transaction_id": t.id,
                "occurred_at": t.occurred_at,
                "amount": float(t.amount),
                "memo": t.memo,
            })

        candidate = RecurringScanCandidateOut(
            user_id=txns[0].user_id,
            name=name,
            type=txns[0].type,
            frequency=freq,  # type: ignore[arg-type]
            day_of_month=dom,
            weekday=wday,
            amount=base_amount,
            is_variable_amount=variable,
            currency=txns[0].currency,
            account_id=txns[0].account_id,
            counter_account_id=txns[0].counter_account_id if txns[0].type == models.TxnType.TRANSFER else None,
            category_id=txns[0].category_id if txns[0].type in (models.TxnType.INCOME, models.TxnType.EXPENSE) else None,
            memo=memo_value,
            payee_id=txns[0].payee_id or None,
            occurrences=len(unique_dates),
            first_date=first_date,
            last_date=last_date,
            average_interval_days=avg_interval,
            amount_min=mn,
            amount_max=mx,
            amount_avg=avg,
            history=history_items,
            signature_hash=signature_hash,
        )
        candidates.append(candidate)

    # Prefer more confident candidates: more occurrences, then recentness
    candidates.sort(key=lambda c: (-c.occurrences, c.first_date))
    return candidates


@router.get("/recurring/exclusions", response_model=list[RecurringCandidateExclusionOut])
def list_recurring_exclusions(
    user_id: list[int] = Query(...),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(models.RecurringCandidateExclusion)
        .filter(models.RecurringCandidateExclusion.user_id.in_(user_id))
        .order_by(models.RecurringCandidateExclusion.created_at.desc())
        .all()
    )
    return rows


@router.post("/recurring/exclusions", response_model=RecurringCandidateExclusionOut, status_code=201)
def create_recurring_exclusion(
    payload: RecurringCandidateExclusionCreate,
    db: Session = Depends(get_db),
):
    existing = (
        db.query(models.RecurringCandidateExclusion)
        .filter(
            models.RecurringCandidateExclusion.user_id == payload.user_id,
            models.RecurringCandidateExclusion.signature_hash == payload.signature_hash,
        )
        .first()
    )
    if existing:
        existing.snapshot = payload.snapshot
        db.commit()
        db.refresh(existing)
        return existing

    item = models.RecurringCandidateExclusion(
        user_id=payload.user_id,
        signature_hash=payload.signature_hash,
        snapshot=payload.snapshot,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/recurring/exclusions/{exclusion_id}", status_code=204)
def delete_recurring_exclusion(
    exclusion_id: int,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    item = (
        db.query(models.RecurringCandidateExclusion)
        .filter(
            models.RecurringCandidateExclusion.id == exclusion_id,
            models.RecurringCandidateExclusion.user_id == user_id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Exclusion not found")

    db.delete(item)
    db.commit()
    return None


@router.get("/recurring-rules/{rule_id}/candidates", response_model=list[TransactionOut])
def list_rule_candidates(
    rule_id: int,
    user_id: int = Query(..., ge=1),
    start: date | None = Query(None),
    end: date | None = Query(None),
    include_linked: bool = Query(False, description="Include already-linked rule transactions"),
    db: Session = Depends(get_db),
):
    rule = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.id == rule_id, models.RecurringRule.user_id == user_id)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")

    q = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.user_id == user_id,
            models.Transaction.type == rule.type,
            models.Transaction.account_id == rule.account_id,
            models.Transaction.currency == rule.currency,
        )
    )
    if rule.type in (models.TxnType.INCOME, models.TxnType.EXPENSE):
        q = q.filter(models.Transaction.category_id == rule.category_id)
    if rule.type == models.TxnType.TRANSFER:
        q = q.filter(models.Transaction.counter_account_id == rule.counter_account_id)

    # Exclude txns already generated/linked by recurrence unless include_linked=True
    if not include_linked:
        q = q.filter(~models.Transaction.external_id.like(f"rule-{rule_id}-%"))

    if start:
        q = q.filter(models.Transaction.occurred_at >= start)
    if end:
        q = q.filter(models.Transaction.occurred_at <= end)

    # optionally we can try to align with schedule, but keep simple for now
    q = q.order_by(models.Transaction.occurred_at.desc(), models.Transaction.id.desc())
    return q.all()


@router.post("/recurring-rules/{rule_id}/attach", response_model=RecurringRuleAttachResult)
def attach_transactions_to_rule(
    rule_id: int,
    payload: RecurringRuleAttachRequest,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    rule = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.id == rule_id, models.RecurringRule.user_id == user_id)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")
    if rule.type == models.TxnType.TRANSFER:
        raise HTTPException(status_code=400, detail="Transfers are not supported for attachment")

    txs = (
        db.query(models.Transaction)
        .filter(models.Transaction.user_id == user_id, models.Transaction.id.in_(payload.transaction_ids))
        .all()
    )
    tx_by_id = {t.id: t for t in txs}
    attached: list[models.Transaction] = []
    errors: list[dict] = []
    used_external_ids: set[str] = set()  # Track external_ids being assigned in this batch
    for tid in payload.transaction_ids:
        tx = tx_by_id.get(tid)
        if not tx:
            errors.append({"transaction_id": tid, "detail": "Transaction not found"})
            continue
        # type/account/currency/category must match
        if tx.type != rule.type or tx.account_id != rule.account_id or tx.currency != rule.currency:
            errors.append({"transaction_id": tid, "detail": "Transaction does not match rule type/account/currency"})
            continue
        if rule.type in (models.TxnType.INCOME, models.TxnType.EXPENSE) and tx.category_id != rule.category_id:
            errors.append({"transaction_id": tid, "detail": "Transaction category mismatch"})
            continue
        if tx.external_id and tx.external_id.startswith("rule-"):
            errors.append({"transaction_id": tid, "detail": "Transaction already linked to a recurring rule"})
            continue
        if not tx.occurred_at:
            errors.append({"transaction_id": tid, "detail": "Transaction missing occurred_at"})
            continue

        # Validate schedule alignment; allow slight flexibility by accepting any date for now
        # If strict alignment needed, uncomment below:
        # try:
        #     _validate_occurrence_alignment(rule, tx.occurred_at)
        # except HTTPException as exc:
        #     errors.append({"transaction_id": tid, "detail": str(exc.detail)})
        #     continue

        # Determine closest scheduled occurrence date to align external_id, so pending occurrences get cleared.
        target_date = tx.occurred_at
        try:
            # search within +/- 3 days window for a scheduled occurrence, prefer exact match
            window_days = 3
            best_date = target_date
            best_delta = 10**9
            for offs in range(-window_days, window_days + 1):
                d = target_date + timedelta(days=offs)
                if any(x == d for x in _iter_occurrences(rule, d, d)):
                    delta = abs(offs)
                    if delta < best_delta:
                        best_date = d
                        best_delta = delta
                        if delta == 0:
                            break
            target_date = best_date
        except Exception:
            target_date = tx.occurred_at

        # Link by setting external_id with aligned date and ensure signed amount direction matches rule semantics
        ext_id = f"rule-{rule.id}-{target_date.isoformat()}"
        
        # Check if this external_id already exists in the database or is being used in this batch
        if ext_id in used_external_ids:
            errors.append({"transaction_id": tid, "detail": f"Another transaction in this batch already aligned to {target_date.isoformat()}"})
            continue
        
        existing_tx = (
            db.query(models.Transaction)
            .filter(
                models.Transaction.user_id == user_id,
                models.Transaction.external_id == ext_id,
                models.Transaction.id != tid,
            )
            .first()
        )
        if existing_tx:
            errors.append({"transaction_id": tid, "detail": f"Another transaction (ID {existing_tx.id}) already linked to this rule occurrence"})
            continue
        
        used_external_ids.add(ext_id)
        tx.external_id = ext_id
        # amount sign normalize: income positive, expense negative
        amt = float(tx.amount)
        if rule.type == models.TxnType.EXPENSE and amt > 0:
            tx.amount = -amt
        if rule.type == models.TxnType.INCOME and amt < 0:
            tx.amount = -amt
        attached.append(tx)

    db.commit()
    return RecurringRuleAttachResult(
        attached=[TransactionOut.model_validate(t, from_attributes=True) for t in attached],
        errors=errors,  # type: ignore[arg-type]
    )
@router.post("/recurring-rules/{rule_id}/consume", response_model=RecurringRuleAttachResult)
def consume_recurring_candidates(
    rule_id: int,
    payload: RecurringScanConsumeRequest,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    """Mark scan candidates as attached or ignored for a rule.

    - reason="attached" behaves like the attach endpoint (delegates logic here for consistency).
    - reason="ignored" marks the transactions as ignored by setting an external_id with an "-ignored" suffix,
      which excludes them from future scans/candidates without affecting balances.
    """
    rule = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.id == rule_id, models.RecurringRule.user_id == user_id)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")
    if rule.type == models.TxnType.TRANSFER:
        raise HTTPException(status_code=400, detail="Transfers are not supported for attachment")

    txs = (
        db.query(models.Transaction)
        .filter(models.Transaction.user_id == user_id, models.Transaction.id.in_(payload.transaction_ids))
        .all()
    )
    tx_by_id = {t.id: t for t in txs}
    attached: list[models.Transaction] = []
    errors: list[dict] = []
    used_external_ids: set[str] = set()  # Track external_ids being assigned in this batch

    for tid in payload.transaction_ids:
        tx = tx_by_id.get(tid)
        if not tx:
            errors.append({"transaction_id": tid, "detail": "Transaction not found"})
            continue
        # type/account/currency/category must match
        if tx.type != rule.type or tx.account_id != rule.account_id or tx.currency != rule.currency:
            errors.append({"transaction_id": tid, "detail": "Transaction does not match rule type/account/currency"})
            continue
        if rule.type in (models.TxnType.INCOME, models.TxnType.EXPENSE) and tx.category_id != rule.category_id:
            errors.append({"transaction_id": tid, "detail": "Transaction category mismatch"})
            continue
        if tx.external_id and tx.external_id.startswith("rule-"):
            errors.append({"transaction_id": tid, "detail": "Transaction already linked to a recurring rule"})
            continue
        if not tx.occurred_at:
            errors.append({"transaction_id": tid, "detail": "Transaction missing occurred_at"})
            continue

        # Determine closest scheduled occurrence date for consistent external_id
        target_date = tx.occurred_at
        try:
            window_days = 3
            best_date = target_date
            best_delta = 10**9
            for offs in range(-window_days, window_days + 1):
                d = target_date + timedelta(days=offs)
                if any(x == d for x in _iter_occurrences(rule, d, d)):
                    delta = abs(offs)
                    if delta < best_delta:
                        best_date = d
                        best_delta = delta
                        if delta == 0:
                            break
            target_date = best_date
        except Exception:
            target_date = tx.occurred_at

        if payload.reason == "attached":
            # behave like attach: normalize sign and link
            ext_id = f"rule-{rule.id}-{target_date.isoformat()}"
            
            # Check for duplicates in this batch or database
            if ext_id in used_external_ids:
                errors.append({"transaction_id": tid, "detail": f"Another transaction in this batch already aligned to {target_date.isoformat()}"})
                continue
            
            existing_tx = (
                db.query(models.Transaction)
                .filter(
                    models.Transaction.user_id == user_id,
                    models.Transaction.external_id == ext_id,
                    models.Transaction.id != tid,
                )
                .first()
            )
            if existing_tx:
                errors.append({"transaction_id": tid, "detail": f"Another transaction (ID {existing_tx.id}) already linked to this rule occurrence"})
                continue
            
            used_external_ids.add(ext_id)
            tx.external_id = ext_id
            amt = float(tx.amount)
            if rule.type == models.TxnType.EXPENSE and amt > 0:
                tx.amount = -amt
            if rule.type == models.TxnType.INCOME and amt < 0:
                tx.amount = -amt
            attached.append(tx)
        else:
            # mark as ignored without touching amount
            ext_id = f"rule-{rule.id}-{target_date.isoformat()}-ignored"
            
            # Check for duplicates in this batch or database
            if ext_id in used_external_ids:
                errors.append({"transaction_id": tid, "detail": f"Another transaction in this batch already marked as ignored for {target_date.isoformat()}"})
                continue
            
            existing_tx = (
                db.query(models.Transaction)
                .filter(
                    models.Transaction.user_id == user_id,
                    models.Transaction.external_id == ext_id,
                    models.Transaction.id != tid,
                )
                .first()
            )
            if existing_tx:
                errors.append({"transaction_id": tid, "detail": f"Another transaction (ID {existing_tx.id}) already ignored for this rule occurrence"})
                continue
            
            used_external_ids.add(ext_id)
            tx.external_id = ext_id
            # not included in attached list

    db.commit()
    return RecurringRuleAttachResult(
        attached=[TransactionOut.model_validate(t, from_attributes=True) for t in attached],
        errors=errors,  # type: ignore[arg-type]
    )


@router.post("/recurring-rules/{rule_id}/attach-to-occurrence", response_model=RecurringRuleAttachResult)
def attach_transaction_to_occurrence(
    rule_id: int,
    payload: RecurringRuleAttachToOccurrenceRequest,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    """Attach a single transaction to a specific occurrence date for a rule.

    This allows manually aligning to a shifted billing date (e.g., due to holidays) by selecting
    the occurrence date explicitly. Only one transaction is attached per request.
    """
    rule = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.id == rule_id, models.RecurringRule.user_id == user_id)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")
    if rule.type == models.TxnType.TRANSFER:
        raise HTTPException(status_code=400, detail="Transfers are not supported for attachment")

    tx = (
        db.query(models.Transaction)
        .filter(models.Transaction.user_id == user_id, models.Transaction.id == payload.transaction_id)
        .first()
    )
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Validate basic attributes
    if tx.type != rule.type or tx.account_id != rule.account_id or tx.currency != rule.currency:
        return RecurringRuleAttachResult(attached=[], errors=[{"transaction_id": tx.id, "detail": "Transaction does not match rule type/account/currency"}])
    if rule.type in (models.TxnType.INCOME, models.TxnType.EXPENSE) and tx.category_id != rule.category_id:
        return RecurringRuleAttachResult(attached=[], errors=[{"transaction_id": tx.id, "detail": "Transaction category mismatch"}])
    if tx.external_id and tx.external_id.startswith("rule-"):
        return RecurringRuleAttachResult(attached=[], errors=[{"transaction_id": tx.id, "detail": "Transaction already linked to a recurring rule"}])

    # Resolve desired date to nearest scheduled occurrence within tolerance (±7d)
    desired_date = payload.occurred_at
    target_date = _resolve_occurrence_date(rule, desired_date, tolerance_days=7)
    if target_date is None:
        return RecurringRuleAttachResult(attached=[], errors=[{"transaction_id": tx.id, "detail": f"{desired_date.isoformat()} is not near any scheduled occurrence for this rule"}])

    # Enforce uniqueness by external_id key
    ext_id = f"rule-{rule.id}-{target_date.isoformat()}"
    existing_tx = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.user_id == user_id,
            models.Transaction.external_id == ext_id,
            models.Transaction.id != tx.id,
        )
        .first()
    )
    if existing_tx:
        return RecurringRuleAttachResult(attached=[], errors=[{"transaction_id": tx.id, "detail": f"Another transaction (ID {existing_tx.id}) already linked to this occurrence"}])

    # Normalize amount sign based on rule
    amt = float(tx.amount)
    if rule.type == models.TxnType.EXPENSE and amt > 0:
        tx.amount = -amt
    if rule.type == models.TxnType.INCOME and amt < 0:
        tx.amount = -amt

    tx.external_id = ext_id
    db.commit()

    return RecurringRuleAttachResult(
        attached=[TransactionOut.model_validate(tx, from_attributes=True)],
        errors=[],
    )


@router.post("/recurring-rules/{rule_id}/retarget", response_model=RecurringRuleAttachResult)
def retarget_linked_transaction(
    rule_id: int,
    payload: RecurringRuleRetargetRequest,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    """Move an already linked rule transaction to a different occurrence date.

    Useful when a transaction was linked to an occurrence but the date didn't fit the schedule,
    and needs to be re-aligned to a valid occurrence.
    """
    rule = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.id == rule_id, models.RecurringRule.user_id == user_id)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")

    tx = (
        db.query(models.Transaction)
        .filter(models.Transaction.user_id == user_id, models.Transaction.id == payload.transaction_id)
        .first()
    )
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Must already be linked to this rule
    if not tx.external_id or not tx.external_id.startswith(f"rule-{rule_id}-"):
        return RecurringRuleAttachResult(attached=[], errors=[{"transaction_id": payload.transaction_id, "detail": "Transaction is not linked to this rule"}])

    desired_date = payload.occurred_at
    target_date = _resolve_occurrence_date(rule, desired_date, tolerance_days=7)
    if target_date is None:
        return RecurringRuleAttachResult(attached=[], errors=[{"transaction_id": payload.transaction_id, "detail": f"{desired_date.isoformat()} is not near any scheduled occurrence for this rule"}])

    ext_id = f"rule-{rule.id}-{target_date.isoformat()}"
    existing_tx = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.user_id == user_id,
            models.Transaction.external_id == ext_id,
            models.Transaction.id != tx.id,
        )
        .first()
    )
    if existing_tx:
        return RecurringRuleAttachResult(attached=[], errors=[{"transaction_id": payload.transaction_id, "detail": f"Another transaction (ID {existing_tx.id}) already linked to this occurrence"}])

    tx.external_id = ext_id
    db.commit()
    return RecurringRuleAttachResult(attached=[TransactionOut.model_validate(tx, from_attributes=True)], errors=[])

@router.post("/recurring-rules", response_model=RecurringRuleOut, status_code=201)
def create_recurring_rule(payload: RecurringRuleCreate, db: Session = Depends(get_db)):
    # 간단 검증: TRANSFER는 counter_account_id 필수, category 금지
    if payload.type == models.TxnType.TRANSFER:
        if not payload.counter_account_id:
            raise HTTPException(status_code=400, detail="TRANSFER requires counter_account_id")
        if payload.category_id is not None:
            raise HTTPException(status_code=400, detail="TRANSFER must not have category")
        if payload.is_variable_amount:
            raise HTTPException(status_code=400, detail="Transfers cannot use variable amounts")
    else:
        if payload.amount is None and not payload.is_variable_amount:
            raise HTTPException(status_code=400, detail="amount is required unless variable amount is enabled")

    normalized_name = payload.name.strip()
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Recurring rule name must not be empty")

    # 멱등 보장: 동일 사용자/이름 규칙이 이미 있으면 해당 항목을 그대로 반환 (201 대신 200)
    existing = (
        db.query(models.RecurringRule)
        .filter(
            models.RecurringRule.user_id == payload.user_id,
            models.RecurringRule.name == normalized_name,
        )
        .first()
    )
    if existing is not None:
        # preview/list와 일관되게 pending_occurrences를 계산하지는 않지만, 스키마 기본값([])으로 충분함
        return Response(
            content=RecurringRuleOut.model_validate(existing, from_attributes=True).model_dump_json(),
            media_type="application/json",
            status_code=200,
        )
    data = payload.model_dump()
    data["name"] = normalized_name
    if payload.type in (models.TxnType.INCOME, models.TxnType.EXPENSE) and data.get("category_id") is None:
        default_category_id = _get_default_category_id(db, txn_type=payload.type)
        data["category_id"] = default_category_id
    item = models.RecurringRule(**data)
    db.add(item)
    try:
        db.commit()
    except Exception as e:  # guard against race: unique name per user
        # Defer import to avoid global dependency
        try:
            from sqlalchemy.exc import IntegrityError  # type: ignore
        except Exception:
            IntegrityError = Exception  # type: ignore
        if isinstance(e, IntegrityError):
            db.rollback()
            # Return the existing rule to ensure idempotency
            existing2 = (
                db.query(models.RecurringRule)
                .filter(
                    models.RecurringRule.user_id == payload.user_id,
                    models.RecurringRule.name == normalized_name,
                )
                .first()
            )
            if existing2 is not None:
                return Response(
                    content=RecurringRuleOut.model_validate(existing2, from_attributes=True).model_dump_json(),
                    media_type="application/json",
                    status_code=200,
                )
        # re-raise unknown errors
        raise
    db.refresh(item)
    return item


@router.get("/recurring-rules", response_model=list[RecurringRuleOut])
def list_recurring_rules(user_id: list[int] = Query(...), db: Session = Depends(get_db)):
    today = date.today()
    rules = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.user_id.in_(user_id))
        .order_by(models.RecurringRule.id.desc())
        .all()
    )
    for rule in rules:
        setattr(rule, "pending_occurrences", _pending_occurrences_for_rule(rule, db=db, today=today))
    return rules


@router.get("/recurring-rules/{rule_id}", response_model=RecurringRuleOut)
def get_recurring_rule(
    rule_id: int,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    rule = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.id == rule_id, models.RecurringRule.user_id == user_id)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")
    setattr(rule, "pending_occurrences", _pending_occurrences_for_rule(rule, db=db, today=date.today()))
    return rule


def _validate_recurring_update(rule: models.RecurringRule, changes: dict) -> None:
    resulting_counter = changes.get("counter_account_id", rule.counter_account_id)
    resulting_category = changes.get("category_id", rule.category_id)

    if rule.type == models.TxnType.TRANSFER:
        if not resulting_counter:
            raise HTTPException(status_code=400, detail="TRANSFER requires counter_account_id")
        if resulting_category is not None:
            raise HTTPException(status_code=400, detail="TRANSFER must not have category")
    else:
        if "counter_account_id" in changes and changes["counter_account_id"] not in (None, rule.counter_account_id):
            raise HTTPException(status_code=400, detail="counter_account_id is only allowed for transfers")

    effective_variable = changes.get("is_variable_amount", rule.is_variable_amount)
    effective_amount = changes.get("amount", rule.amount)

    if effective_variable:
        if rule.type == models.TxnType.TRANSFER:
            raise HTTPException(status_code=400, detail="Transfers cannot use variable amounts")
    else:
        if effective_amount is None or float(effective_amount) <= 0:
            raise HTTPException(status_code=400, detail="amount must be positive when variable amount is disabled")


@router.patch("/recurring-rules/{rule_id}", response_model=RecurringRuleOut)
def update_recurring_rule(
    rule_id: int,
    payload: RecurringRuleUpdate,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    rule = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.id == rule_id, models.RecurringRule.user_id == user_id)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return rule

    _validate_recurring_update(rule, changes)

    if rule.type in (models.TxnType.INCOME, models.TxnType.EXPENSE):
        if changes.get("category_id") is None:
            changes["category_id"] = _get_default_category_id(db, txn_type=rule.type)
        elif rule.category_id is None:
            rule.category_id = _get_default_category_id(db, txn_type=rule.type)
            db.flush()

    for key, value in changes.items():
        setattr(rule, key, value)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/recurring-rules/{rule_id}", status_code=204)
def delete_recurring_rule(
    rule_id: int,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    rule = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.id == rule_id, models.RecurringRule.user_id == user_id)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")
    db.delete(rule)
    db.commit()
    return None


def _iter_occurrences(rule: models.RecurringRule, start: date, end: date):
    if end < start:
        return

    window_start = start
    if rule.start_date and rule.start_date > window_start:
        window_start = rule.start_date

    window_end = end
    if rule.end_date and rule.end_date < window_end:
        window_end = rule.end_date

    if window_start > window_end:
        return

    if rule.frequency == models.RecurringFrequency.DAILY:  # type: ignore[attr-defined]
        current = window_start
        while current <= window_end:
            yield current
            current += timedelta(days=1)
        return

    if rule.frequency == models.RecurringFrequency.WEEKLY:  # type: ignore[attr-defined]
        weekday = rule.weekday if rule.weekday is not None else window_start.weekday()
        current = window_start + timedelta((weekday - window_start.weekday()) % 7)
        while current <= window_end:
            yield current
            current += timedelta(days=7)
        return

    if rule.frequency == models.RecurringFrequency.MONTHLY:  # type: ignore[attr-defined]
        day = rule.day_of_month if rule.day_of_month else window_start.day
        year = window_start.year
        month = window_start.month

        def _build_month_candidate(y: int, m: int) -> date:
            days_in_month = calendar.monthrange(y, m)[1]
            return date(y, m, min(day, days_in_month))

        candidate = _build_month_candidate(year, month)
        if candidate < window_start:
            month += 1
            if month > 12:
                month = 1
                year += 1
            candidate = _build_month_candidate(year, month)

        while candidate <= window_end:
            yield candidate
            month += 1
            if month > 12:
                month = 1
                year += 1
            candidate = _build_month_candidate(year, month)
        return

    if rule.frequency == models.RecurringFrequency.YEARLY:  # type: ignore[attr-defined]
        anchor = rule.start_date or window_start
        month = anchor.month
        day = rule.day_of_month if rule.day_of_month else anchor.day
        year = anchor.year

        def _build_year_candidate(y: int) -> date:
            days_in_month = calendar.monthrange(y, month)[1]
            return date(y, month, min(day, days_in_month))

        candidate = _build_year_candidate(max(window_start.year, year))
        while candidate < window_start:
            year = candidate.year + 1
            candidate = _build_year_candidate(year)

        while candidate <= window_end:
            yield candidate
            year = candidate.year + 1
            candidate = _build_year_candidate(year)
        return

def _resolve_occurrence_date(rule: models.RecurringRule, desired: date, *, tolerance_days: int = 7) -> date | None:
    start = desired - timedelta(days=tolerance_days)
    end = desired + timedelta(days=tolerance_days)
    occurrences = list(_iter_occurrences(rule, start, end))
    if not occurrences:
        return None
    return min(occurrences, key=lambda d: (abs((d - desired).days), d))


def _signed_amount_for_rule(rule: models.RecurringRule, amount: float) -> float:
    magnitude = abs(amount)
    if rule.type == models.TxnType.EXPENSE:
        return -magnitude
    return magnitude


def _pending_occurrences_for_rule(rule: models.RecurringRule, *, db: Session, today: date) -> list[date]:
    if not getattr(rule, "is_variable_amount", False) or not rule.is_active:
        return []

    lookback_start = today - timedelta(days=PENDING_LOOKBACK_DAYS)
    effective_start = max(lookback_start, rule.start_date or lookback_start)
    occurrences = list(_iter_occurrences(rule, effective_start, today))
    if not occurrences:
        return []

    keys = [f"rule-{rule.id}-{occ.isoformat()}" for occ in occurrences]
    existing_rows = (
        db.query(models.Transaction.occurred_at)
        .filter(
            models.Transaction.user_id == rule.user_id,
            models.Transaction.external_id.in_(keys),
        )
        .all()
    )
    confirmed_dates = {row[0] for row in existing_rows}

    # Exclude skipped occurrences
    skipped_rows = (
        db.query(models.RecurringOccurrenceSkip.occurred_at)
        .filter(models.RecurringOccurrenceSkip.rule_id == rule.id)
        .all()
    )
    skipped_dates = {row[0] for row in skipped_rows}

    return [occ for occ in occurrences if occ not in confirmed_dates and occ not in skipped_dates]

@router.post("/recurring-rules/{rule_id}/detach", response_model=RecurringRuleDetachResult)
def detach_recurring_link(
    rule_id: int,
    payload: RecurringRuleDetachRequest,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    """Unlink a transaction from this recurring rule by clearing its external_id.

    This is safe-guarded to only operate on transactions that are currently linked to this rule (external_id starts with rule-<rule_id>-).
    """
    rule = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.id == rule_id, models.RecurringRule.user_id == user_id)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")

    tx = (
        db.query(models.Transaction)
        .filter(models.Transaction.user_id == user_id, models.Transaction.id == payload.transaction_id)
        .first()
    )
    if not tx:
        return RecurringRuleDetachResult(detached=[], errors=[{"transaction_id": payload.transaction_id, "detail": "Transaction not found"}])

    if not tx.external_id or not tx.external_id.startswith(f"rule-{rule_id}-"):
        return RecurringRuleDetachResult(detached=[], errors=[{"transaction_id": payload.transaction_id, "detail": "Transaction is not linked to this rule"}])

    tx.external_id = None
    db.commit()
    return RecurringRuleDetachResult(detached=[TransactionOut.model_validate(tx, from_attributes=True)], errors=[])

@router.post("/recurring-rules/{rule_id}/skip", response_model=RecurringOccurrenceSkipOut)
def skip_recurring_occurrence(
    rule_id: int,
    payload: RecurringOccurrenceSkipRequest,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    rule = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.id == rule_id, models.RecurringRule.user_id == user_id)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")

    occ_date = payload.occurred_at
    if not any(d == occ_date for d in _iter_occurrences(rule, occ_date, occ_date)):
        raise HTTPException(status_code=400, detail="Date is not a scheduled occurrence for this rule")

    # Ensure no linked transaction already exists for this occurrence
    ext_id = f"rule-{rule.id}-{occ_date.isoformat()}"
    exists = (
        db.query(models.Transaction.id)
        .filter(
            models.Transaction.user_id == user_id,
            models.Transaction.external_id == ext_id,
        )
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail="Occurrence already has a linked transaction")

    # Return existing skip if present
    existing = (
        db.query(models.RecurringOccurrenceSkip)
        .filter(models.RecurringOccurrenceSkip.rule_id == rule_id, models.RecurringOccurrenceSkip.occurred_at == occ_date)
        .first()
    )
    if existing:
        return RecurringOccurrenceSkipOut.model_validate(existing, from_attributes=True)

    item = models.RecurringOccurrenceSkip(rule_id=rule_id, user_id=user_id, occurred_at=occ_date, reason=_normalize_optional(payload.reason))
    db.add(item)
    db.commit()
    db.refresh(item)
    return RecurringOccurrenceSkipOut.model_validate(item, from_attributes=True)

@router.delete("/recurring-rules/{rule_id}/skip/{occurred_at}")
def unskip_recurring_occurrence(
    rule_id: int,
    occurred_at: date,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    rule = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.id == rule_id, models.RecurringRule.user_id == user_id)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")
    item = (
        db.query(models.RecurringOccurrenceSkip)
        .filter(
            models.RecurringOccurrenceSkip.rule_id == rule_id,
            models.RecurringOccurrenceSkip.user_id == user_id,
            models.RecurringOccurrenceSkip.occurred_at == occurred_at,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Skip not found")
    db.delete(item)
    db.commit()
    return {"deleted": True}

@router.get("/recurring-rules/{rule_id}/skips", response_model=list[RecurringOccurrenceSkipOut])
def list_recurring_skips(
    rule_id: int,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    rule = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.id == rule_id, models.RecurringRule.user_id == user_id)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")
    rows = (
        db.query(models.RecurringOccurrenceSkip)
        .filter(models.RecurringOccurrenceSkip.rule_id == rule_id, models.RecurringOccurrenceSkip.user_id == user_id)
        .order_by(models.RecurringOccurrenceSkip.occurred_at.desc())
        .all()
    )
    return [RecurringOccurrenceSkipOut.model_validate(x, from_attributes=True) for x in rows]


def _fetch_occurrence_drafts(db: Session, rule_id: int, dates: list[date]) -> dict[date, models.RecurringOccurrenceDraft]:
    if not dates:
        return {}
    rows = (
        db.query(models.RecurringOccurrenceDraft)
        .filter(
            models.RecurringOccurrenceDraft.rule_id == rule_id,
            models.RecurringOccurrenceDraft.occurred_at.in_(dates),
        )
        .all()
    )
    return {row.occurred_at: row for row in rows}


def _remove_occurrence_draft(db: Session, rule_id: int, occurred_at: date) -> None:
    db.query(models.RecurringOccurrenceDraft).filter(
        models.RecurringOccurrenceDraft.rule_id == rule_id,
        models.RecurringOccurrenceDraft.occurred_at == occurred_at,
    ).delete(synchronize_session=False)


def find_potential_transfer_matches(
    db: Session,
    items: list[TransactionCreate],
    user_id: int,
    time_tolerance_minutes: int = 5
) -> list[dict]:
    """
    기존 DB 트랜잭션 중 새로 업로드할 항목과 시간+금액이 일치하는 것을 찾아
    분산 업로드된 내부 이체 쌍 후보를 반환합니다.
    
    Returns:
        List of dicts with keys: new_item, existing_txn_id, confidence
    """
    potential_matches = []

    def _parse_occurred_time(raw_time: time | str | None) -> time | None:
        if raw_time is None:
            return None
        if isinstance(raw_time, time):
            return raw_time
        if isinstance(raw_time, str):
            parts = raw_time.split(":")
            if len(parts) not in (2, 3):
                return None
            try:
                hour = int(parts[0])
                minute = int(parts[1])
                second = int(parts[2]) if len(parts) == 3 else 0
            except ValueError:
                return None
            return time(hour=hour, minute=minute, second=second)
        return None

    for idx, item in enumerate(items):
        # 통화/금액/날짜 정보가 없으면 스킵
        if item.amount is None or item.currency is None or item.occurred_at is None:
            continue

        base_time = _parse_occurred_time(getattr(item, "occurred_time", None))
        time_min: time | None = None
        time_max: time | None = None
        if base_time:
            base_dt = datetime.combine(item.occurred_at, base_time)
            min_dt = base_dt - timedelta(minutes=time_tolerance_minutes)
            max_dt = base_dt + timedelta(minutes=time_tolerance_minutes)

            if min_dt.date() < item.occurred_at:
                time_min = time(0, 0, 0)
            else:
                time_min = min_dt.time()

            if max_dt.date() > item.occurred_at:
                time_max = time(23, 59, 59)
            else:
                time_max = max_dt.time()
        
        # DB에서 매칭 후보 검색
        query = db.query(models.Transaction).filter(
            models.Transaction.user_id == user_id,
            models.Transaction.occurred_at == item.occurred_at,
            models.Transaction.currency == (item.currency or "KRW"),
        )

        # 금액 절대값 일치 (반대 부호)
        query = query.filter(models.Transaction.amount == -item.amount)
        
        # 시간 범위 필터
        if time_min is not None and time_max is not None:
            query = query.filter(
                models.Transaction.occurred_time >= time_min,
                models.Transaction.occurred_time <= time_max
            )
        
        # 동일 external_id는 제외 (idempotent 업로드 시나리오)
        if item.external_id:
            query = query.filter(models.Transaction.external_id != item.external_id)
        
        candidates = query.all()
        
        for existing in candidates:
            # 동일 계좌는 제외
            if item.account_id and existing.account_id == item.account_id:
                continue
            if item.account_name:
                existing_account = getattr(existing, "account", None)
                if existing_account and item.account_name == getattr(existing_account, "name", None):
                    continue
            if item.counter_account_id and existing.account_id == item.counter_account_id:
                continue  # 이미 연결된 상대 계좌와 동일
            # 부호 반대가 아니면 잔액 상쇄 불가
            if (item.amount >= 0 and existing.amount >= 0) or (item.amount <= 0 and existing.amount <= 0):
                continue
            
            # 신뢰도 간단 계산 (시간+금액 일치는 이미 확인됨)
            confidence_score = 50  # 기본 50점 (시간+금액 일치)
            confidence_score += 20  # 부호 반대 확인
            
            # 메모 유사도
            memo1 = (item.memo or "").lower().strip()
            memo2 = (getattr(existing, "memo", "") or "").lower().strip()
            if memo1 and memo2:
                if memo1 == memo2:
                    confidence_score += 20
                elif memo1 in memo2 or memo2 in memo1:
                    confidence_score += 10
            
            # 카테고리 힌트 (이체 관련 키워드)
            transfer_keywords = ["이체", "transfer", "계좌이체", "내계좌"]
            item_text = f"{item.category_group_name or ''} {item.category_name or ''} {memo1}".lower()
            existing_text = ""
            existing_category = getattr(existing, "category", None)
            if existing_category:
                group = getattr(existing_category, "group", None)
                existing_text = f"{getattr(group, 'name', '')} {getattr(existing_category, 'name', '')} {memo2}".lower()
            
            if any(kw in item_text for kw in transfer_keywords) and any(kw in existing_text for kw in transfer_keywords):
                confidence_score += 15
            
            level = "UNLIKELY"
            if confidence_score >= 80:
                level = "CERTAIN"
            elif confidence_score >= 50:
                level = "SUSPECTED"

            potential_matches.append({
                "new_item_index": idx,
                "new_item": item,
                "existing_txn_id": existing.id,
                "existing_txn": {
                    "occurred_at": str(existing.occurred_at),
                    "occurred_time": _time_to_str(existing.occurred_time),
                    "amount": float(existing.amount),
                    "account_name": getattr(getattr(existing, "account", None), "name", None),
                    "memo": getattr(existing, "memo", None),
                    "type": existing.type.value,
                },
                "confidence_score": confidence_score,
                "confidence_level": level
            })
    
    return potential_matches


@router.post("/transactions/bulk", response_model=TransactionsBulkOut)
def bulk_upsert_transactions(payload: TransactionsBulkIn, response: Response, db: Session = Depends(get_db)):
    """
    대량 트랜잭션 생성 엔드포인트
    
    TransactionBulkService를 사용하여 비즈니스 로직 처리
    응답에 DB 매칭 후보 정보를 포함하여 프론트엔드에서 사용자 확인 가능
    """
    # 사용자 검증
    user = db.query(models.User).filter(models.User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found for bulk upload")

    if not payload.items:
        return TransactionsBulkOut(transactions=[], db_transfer_matches=[], stats={})

    # DB 매칭 후보를 먼저 찾기 (업로드 전)
    potential_matches = find_potential_transfer_matches(
        db=db,
        items=payload.items,
        user_id=payload.user_id,
        time_tolerance_minutes=1  # 60초 tolerance
    )
    
    # 매칭 후보를 스키마 형식으로 변환
    db_matches = []
    for match_dict in potential_matches:
        item_index = match_dict.get("new_item_index", -1)
        if item_index == -1:
            continue
        # 새 항목의 요약 정보도 포함 (시간 문자열화)
        new_item = payload.items[item_index]
        db_matches.append(
            PotentialTransferMatch(
                new_item_index=item_index,
                new_item_occurred_at=str(new_item.occurred_at) if getattr(new_item, "occurred_at", None) else None,
                new_item_occurred_time=_time_to_str(getattr(new_item, "occurred_time", None)),
                new_item_amount=float(new_item.amount) if getattr(new_item, "amount", None) is not None else None,
                new_item_account_name=getattr(new_item, "account_name", None),
                new_item_currency=getattr(new_item, "currency", None),
                existing_txn_id=match_dict["existing_txn_id"],
                existing_txn_occurred_at=match_dict["existing_txn"]["occurred_at"],
                existing_txn_occurred_time=match_dict["existing_txn"]["occurred_time"],
                existing_txn_amount=match_dict["existing_txn"]["amount"],
                existing_txn_account_name=match_dict["existing_txn"]["account_name"],
                existing_txn_memo=match_dict["existing_txn"]["memo"],
                existing_txn_type=match_dict["existing_txn"]["type"],
                confidence_score=match_dict["confidence_score"],
                confidence_level=match_dict["confidence_level"],
            )
        )
    
    # 서비스 초기화 및 실행
    from app.services import TransactionBulkService
    
    service = TransactionBulkService(db)
    created, metadata = service.bulk_create(
        user_id=payload.user_id,
        items=payload.items,
        override=payload.override
    )
    
    # 통계 정보 구성
    stats = {
        "created": len(created),
        "duplicate_transfers": metadata.get("duplicate_transfers", 0),
        "settlement_duplicates": metadata.get("settlement_duplicates", 0),
        "db_transfer_matches": metadata.get("db_transfer_matches", 0),
        "existing_duplicates": metadata.get("existing_duplicates", 0),
        "natural_duplicates": metadata.get("natural_duplicates", 0),
    }
    
    # 메타데이터를 응답 헤더에도 추가 (하위 호환성)
    if metadata["duplicate_transfers"]:
        response.headers["X-Duplicate-Transfers"] = str(metadata["duplicate_transfers"])
    if metadata["settlement_duplicates"]:
        response.headers["X-Settlement-Duplicates"] = str(metadata["settlement_duplicates"])
    if metadata.get("db_transfer_matches"):
        response.headers["X-DB-Transfer-Matches"] = str(metadata["db_transfer_matches"])
    if metadata.get("existing_duplicates"):
        response.headers["X-Existing-Duplicates"] = str(metadata["existing_duplicates"])
    if metadata.get("natural_duplicates"):
        response.headers["X-Natural-Duplicates"] = str(metadata["natural_duplicates"])
    
    return TransactionsBulkOut(
        transactions=created,
        db_transfer_matches=db_matches,
        stats=stats
    )


@router.post("/transactions/bulk-confirm-matches", response_model=DbMatchConfirmResult)
def confirm_db_matches(payload: DbMatchConfirmRequest, db: Session = Depends(get_db)):
    """
    사용자가 확인한 DB 매칭 결정을 처리합니다.
    
    - link: 기존 DB 트랜잭션과 새 항목을 TRANSFER로 연결
    - separate: 새 항목을 별도 거래로 등록
    """
    from app.services import TransactionBulkService
    
    user = db.query(models.User).filter(models.User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")
    
    linked_count = 0
    created_count = 0
    updated_count = 0
    all_transactions = []
    fallback_separate_items: list[TransactionCreate] = []
    
    # 결정 맵 생성 (existing_txn_id -> DbMatchDecision)
    decision_map = {d.existing_txn_id: d for d in payload.decisions}
    
    # 연결할 항목들 처리
    link_decisions = [d for d in payload.decisions if d.action == "link"]
    separate_decisions = [d for d in payload.decisions if d.action == "separate"]
    
    # 1. TRANSFER로 연결할 항목들 처리
    for decision in link_decisions:
        existing_txn = db.query(models.Transaction).filter(
            models.Transaction.id == decision.existing_txn_id,
            models.Transaction.user_id == payload.user_id
        ).first()
        
        if not existing_txn:
            continue
        
        if decision.new_item_index < 0 or decision.new_item_index >= len(payload.items):
            raise HTTPException(status_code=400, detail=f"new item index {decision.new_item_index} out of range")

        new_item = payload.items[decision.new_item_index]

        # external_id / imported_source_id는 (user_id, value) 조합이 UNIQUE 이므로
        # 이미 DB에 존재한다면 새로 생성하는 전표에는 부여하지 않는다.
        base_external_id = getattr(new_item, "external_id", None)
        resolved_external_id = None
        if base_external_id:
            # 기본 suffix로 기존 transaction id를 붙여 고유값 생성
            candidate = f"{base_external_id}-matched-{decision.existing_txn_id}"
            # external_id 길이 제한(64)을 넘지 않도록 자름
            candidate = candidate[:64]
            counter = 1
            while (
                db.query(models.Transaction.id)
                .filter(models.Transaction.user_id == payload.user_id)
                .filter(models.Transaction.external_id == candidate)
                .first()
            ):
                candidate = f"{base_external_id}-matched-{decision.existing_txn_id}-{counter}"
                candidate = candidate[:64]
                counter += 1
            resolved_external_id = candidate

        if resolved_external_id is None:
            # external_id가 없던 항목은 새 prefix로 생성 (멱등성 확보)
            candidate = f"link-{decision.existing_txn_id}-{decision.new_item_index}"
            candidate = candidate[:64]
            counter = 1
            while (
                db.query(models.Transaction.id)
                .filter(models.Transaction.user_id == payload.user_id)
                .filter(models.Transaction.external_id == candidate)
                .first()
            ):
                candidate = f"link-{decision.existing_txn_id}-{decision.new_item_index}-{counter}"
                candidate = candidate[:64]
                counter += 1
            resolved_external_id = candidate

        resolved_imported_source_id = getattr(new_item, "imported_source_id", None)
        if resolved_imported_source_id:
            existing_source = (
                db.query(models.Transaction.id)
                .filter(models.Transaction.user_id == payload.user_id)
                .filter(models.Transaction.imported_source_id == resolved_imported_source_id)
                .first()
            )
            if existing_source:
                resolved_imported_source_id = None
        
        # 새 항목의 계정 ID를 선행 해석하여 동일 계좌 케이스를 걸러낸다
        if new_item.account_id:
            new_account_id = new_item.account_id
        elif new_item.account_name:
            account = db.query(models.Account).filter(
                models.Account.user_id == payload.user_id,
                models.Account.name == new_item.account_name
            ).first()
            if not account:
                raise HTTPException(
                    status_code=400,
                    detail=f"Account not found: {new_item.account_name}"
                )
            new_account_id = account.id
        else:
            raise HTTPException(status_code=400, detail="account_id or account_name required")

        # 기존 전표의 기본 계좌와 동일하면 TRANSFER 불가 → 별도 생성으로 폴백
        old_primary_account_id = existing_txn.account_id
        if new_account_id == old_primary_account_id:
            fallback_separate_items.append(new_item)
            continue
        
    # 단일 전표 전환에는 그룹이 필수는 아님(쌍 생성이 아니므로). 중간 flush를 피한다.

        # 기존 전표의 현재 상태 기록 (잔액 되돌리기용)
        old_amount = float(existing_txn.amount)
        old_neutral = _is_effectively_neutral_txn(existing_txn)
        old_type = existing_txn.type

        # 기존 전표의 잔액 영향 되돌리기
        if not old_neutral:
            if old_type == models.TxnType.TRANSFER and existing_txn.is_auto_transfer_match and existing_txn.counter_account_id:
                _revert_single_transfer_effect(db, existing_txn.account_id, existing_txn.counter_account_id, old_amount)
            else:
                _apply_balance(db, old_primary_account_id, -old_amount)

        # 방향/부호 결정: 단일 전표 TRANSFER로 전환 (OUT은 음수, IN은 양수)
        new_amount = float(new_item.amount)
        # 기본 케이스: 음수 쪽을 출금(from)으로 본다
        if (old_amount < 0 and new_amount > 0) or (old_amount < 0 and new_amount == 0):
            # 기존이 출금, 새 항목이 입금
            source_account_id = old_primary_account_id
            counter_account_id = new_account_id
            signed_amount = -abs(old_amount)
        elif (old_amount > 0 and new_amount < 0) or (old_amount == 0 and new_amount < 0):
            # 기존이 입금, 새 항목이 출금
            source_account_id = new_account_id
            counter_account_id = old_primary_account_id
            signed_amount = -abs(new_amount)
        else:
            # 둘 다 같은 부호거나 0인 비정상 케이스: 기존 부호 기준으로 보정
            if old_amount < 0:
                source_account_id = old_primary_account_id
                counter_account_id = new_account_id
                signed_amount = -abs(old_amount)
            else:
                source_account_id = new_account_id
                counter_account_id = old_primary_account_id
                signed_amount = -abs(new_amount or old_amount or 0)

        # 기존 전표를 단일 TRANSFER로 재구성 (직접 컬럼 지정으로 타입 의존 하이브리드 부작용 회피)
        existing_txn.type = models.TxnType.TRANSFER
        existing_txn.category_id = None  # TRANSFER는 카테고리 없음
        existing_txn.is_balance_neutral = False
        existing_txn.is_auto_transfer_match = True
        existing_txn.from_account_id = source_account_id
        existing_txn.to_account_id = counter_account_id
        existing_txn.amount = signed_amount

        # 새 항목의 메모/통화 등 보존할 값이 있으면 병합(선택적으로 기존 비어있을 때만)
        if not existing_txn.memo and new_item.memo:
            existing_txn.memo = new_item.memo
        if not existing_txn.currency and new_item.currency:
            existing_txn.currency = new_item.currency

        # 단일 전표 TRANSFER 잔액 반영
        if not _is_effectively_neutral_txn(existing_txn):
            _apply_single_transfer_effect(db, existing_txn.account_id, existing_txn.counter_account_id, float(existing_txn.amount))

        linked_count += 1
        updated_count += 1
        all_transactions.extend([existing_txn])
    
    # 2. 별도 거래로 등록할 항목들 처리
    separate_items = [payload.items[d.new_item_index] for d in separate_decisions]
    
    # 3. 결정되지 않은 나머지 항목들도 자동으로 별도 등록
    decided_indices = {d.new_item_index for d in payload.decisions}
    undecided_items = [item for i, item in enumerate(payload.items) if i not in decided_indices]
    
    # 별도 등록 + 미결정 항목 합쳐서 생성
    items_to_create = separate_items + fallback_separate_items + undecided_items
    if items_to_create:
        service = TransactionBulkService(db)
        created, _ = service.bulk_create(
            user_id=payload.user_id,
            items=items_to_create,
            override=False
        )
        created_count = len(created)
        all_transactions.extend(created)
    
    db.commit()
    
    # TransactionOut 스키마로 변환
    result_transactions = []
    for txn in all_transactions:
        db.refresh(txn)
        result_transactions.append(TransactionOut.model_validate(txn))
    
    return DbMatchConfirmResult(
        linked=linked_count,
        created=created_count,
        updated=updated_count,
        transactions=result_transactions
    )


# Keep legacy export name for modular routers that still reference it.
bulk_confirm_db_matches = confirm_db_matches


@router.post("/transactions/bulk-delete", response_model=TransactionsBulkDeleteResult)
def bulk_delete_transactions(payload: TransactionsBulkDelete, db: Session = Depends(get_db)):
    unique_ids = list(dict.fromkeys(payload.ids))
    if not unique_ids:
        return TransactionsBulkDeleteResult(deleted=0, deleted_ids=[], missing=[])

    existing = (
        db.query(models.Transaction)
        .filter(models.Transaction.user_id == payload.user_id, models.Transaction.id.in_(unique_ids))
        .all()
    )
    found_map = {tx.id: tx for tx in existing}
    missing = [txn_id for txn_id in unique_ids if txn_id not in found_map]

    group_ids = {tx.group_id for tx in existing if tx.group_id is not None}
    group_members: list[models.Transaction] = []
    if group_ids:
        group_members = (
            db.query(models.Transaction)
            .filter(
                models.Transaction.user_id == payload.user_id,
                models.Transaction.group_id.in_(group_ids),
            )
            .all()
        )

    to_delete: dict[int, models.Transaction] = {tx.id: tx for tx in existing}
    for tx in group_members:
        to_delete[tx.id] = tx

    if not to_delete:
        return TransactionsBulkDeleteResult(deleted=0, deleted_ids=[], missing=missing)

    deleted_ids = list(to_delete.keys())
    for tx in to_delete.values():
        _sync_check_card_auto_deduct(db, tx, remove=True)
        if not _is_effectively_neutral_txn(tx):
            if tx.type == models.TxnType.TRANSFER and tx.is_auto_transfer_match and tx.counter_account_id:
                _revert_single_transfer_effect(db, tx.account_id, tx.counter_account_id, float(tx.amount))
            else:
                _apply_balance(db, tx.account_id, -float(tx.amount))
        db.delete(tx)

    db.commit()
    return TransactionsBulkDeleteResult(deleted=len(deleted_ids), deleted_ids=deleted_ids, missing=missing)


@router.post("/transactions/bulk-move-account", response_model=TransactionsBulkMoveResult)
def bulk_move_transactions_account(payload: TransactionsBulkMoveAccount, db: Session = Depends(get_db)):
    if not payload.transaction_ids:
        return TransactionsBulkMoveResult(updated=0, missing=[], skipped=[])

    target_account = (
        db.query(models.Account)
        .filter(
            models.Account.id == payload.target_account_id,
            models.Account.user_id == payload.user_id,
        )
        .first()
    )
    if not target_account:
        raise HTTPException(status_code=400, detail="Target account not found")

    txns = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.user_id == payload.user_id,
            models.Transaction.id.in_(payload.transaction_ids),
        )
        .all()
    )

    found_ids = {tx.id for tx in txns}
    missing = [txn_id for txn_id in payload.transaction_ids if txn_id not in found_ids]
    skipped: list[int] = []
    updated = 0
    target_id = target_account.id

    for tx in txns:
        if tx.account_id == target_id:
            skipped.append(tx.id)
            continue
        if tx.type == models.TxnType.TRANSFER and tx.group_id:
            skipped.append(tx.id)
            continue

        old_account_id = tx.account_id
        amount_value = float(tx.amount)

        if tx.type == models.TxnType.TRANSFER:
            if not _is_effectively_neutral_txn(tx):
                if tx.is_auto_transfer_match and tx.counter_account_id:
                    _revert_single_transfer_effect(db, old_account_id, tx.counter_account_id, amount_value)
                else:
                    _apply_balance(db, old_account_id, -amount_value)
            tx.account_id = target_id
            if not _is_effectively_neutral_txn(tx):
                if tx.is_auto_transfer_match and tx.counter_account_id:
                    _apply_single_transfer_effect(db, tx.account_id, tx.counter_account_id, float(tx.amount))
                else:
                    _apply_balance(db, tx.account_id, float(tx.amount))
            _sync_check_card_auto_deduct(db, tx)
            updated += 1
            continue

        if not _is_effectively_neutral_txn(tx):
            _apply_balance(db, old_account_id, -amount_value)
        tx.account_id = target_id
        if not _is_effectively_neutral_txn(tx):
            _apply_balance(db, target_id, amount_value)
        _sync_check_card_auto_deduct(db, tx)
        updated += 1

    if updated:
        db.commit()
    else:
        db.rollback()

    return TransactionsBulkMoveResult(updated=updated, missing=missing, skipped=skipped)


bulk_move_transactions_between_accounts = bulk_move_transactions_account


@router.post("/transactions/bulk-update", response_model=TransactionsBulkUpdateResponse)
def bulk_update_transactions(payload: TransactionsBulkUpdate, db: Session = Depends(get_db)):
    if not payload.transaction_ids:
        return TransactionsBulkUpdateResponse(updated=0, items=[], missing=[], skipped=[])

    txns = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.user_id == payload.user_id,
            models.Transaction.id.in_(payload.transaction_ids),
        )
        .all()
    )

    found_map = {tx.id: tx for tx in txns}
    missing = [tid for tid in payload.transaction_ids if tid not in found_map]
    skipped: list[int] = []
    updated_items: list[models.Transaction] = []

    changes_base = payload.updates.model_dump(exclude_unset=True)

    # Guardrails: Prevent illegal cross-type/category updates in bulk without explicit validation per item
    def _validate_category(tx: models.Transaction, category_id: int | None) -> None:
        if category_id is None:
            return
        cat = db.query(models.Category).filter(models.Category.id == category_id).first()
        if not cat:
            raise HTTPException(status_code=400, detail="Invalid category_id")
        g = db.query(models.CategoryGroup).filter(models.CategoryGroup.id == cat.group_id).first()
        if not g:
            raise HTTPException(status_code=400, detail="Invalid category group for category")
        if tx.type == models.TxnType.TRANSFER and category_id is not None:
            raise HTTPException(status_code=400, detail="TRANSFER must not have category_id")
        if tx.type in (models.TxnType.INCOME, models.TxnType.EXPENSE):
            expected = "I" if tx.type == models.TxnType.INCOME else "E"
            if g.type != expected:
                raise HTTPException(status_code=400, detail="Category type mismatch with transaction type")

    for tx in txns:
        local_changes = dict(changes_base)

        # Memo mode: append
        if payload.memo_mode == "append" and "memo" in local_changes and local_changes["memo"] is not None:
            base_memo = tx.memo or ""
            addition = str(local_changes["memo"])
            delim = payload.append_delimiter or " "
            local_changes["memo"] = (base_memo + (delim if base_memo and addition else "") + addition) if addition else base_memo

        # Validate category compatibility upfront
        if "category_id" in local_changes:
            try:
                _validate_category(tx, local_changes["category_id"])  # type: ignore[arg-type]
            except HTTPException:
                # skip incompatible ones to avoid partial failure breaking whole batch
                skipped.append(tx.id)
                db.rollback()
                continue

        try:
            # Credit card transactions and settlements use dedicated update flow
            account = db.query(models.Account).filter(models.Account.id == tx.account_id).first()
            target_account_id = int(local_changes.get("account_id", tx.account_id)) if "account_id" in local_changes else tx.account_id
            target_account = account if target_account_id == tx.account_id else db.query(models.Account).filter(models.Account.id == target_account_id).first()

            if tx.billing_cycle_id or (account and account.type == models.AccountType.CREDIT_CARD) or (target_account and target_account.type == models.AccountType.CREDIT_CARD):
                _update_credit_card_transaction(db, tx, local_changes, current_account=account, target_account=target_account)
                updated_items.append(tx)
                continue

            if tx.type == models.TxnType.TRANSFER and tx.group_id:
                # For grouped transfer pairs, update amount/memo/category/currency/occurred fields consistently
                siblings = (
                    db.query(models.Transaction)
                    .filter(models.Transaction.group_id == tx.group_id)
                    .order_by(models.Transaction.id.asc())
                    .all()
                )
                if len(siblings) != 2:
                    skipped.append(tx.id)
                    continue
                out_tx = next((t for t in siblings if float(t.amount) < 0), siblings[0])
                in_tx = next((t for t in siblings if float(t.amount) > 0 and t.id != out_tx.id), siblings[1])

                old_out_amt = float(out_tx.amount)
                old_in_amt = float(in_tx.amount)
                old_neutral = _is_effectively_neutral_txn(out_tx)
                if not old_neutral:
                    _apply_balance(db, out_tx.account_id, -old_out_amt)
                    _apply_balance(db, in_tx.account_id, -old_in_amt)

                base_amount = abs(float(local_changes.get("amount", in_tx.amount)))
                out_tx.amount = -base_amount
                in_tx.amount = base_amount

                for key in ("category_id", "memo", "currency", "payee_id", "occurred_at", "occurred_time", "exclude_from_reports", "is_balance_neutral"):
                    if key in local_changes:
                        setattr(out_tx, key, local_changes[key])
                        setattr(in_tx, key, local_changes[key])

                new_neutral = _is_effectively_neutral_txn(out_tx)
                if not new_neutral:
                    _apply_balance(db, out_tx.account_id, float(out_tx.amount))
                    _apply_balance(db, in_tx.account_id, float(in_tx.amount))
                updated_items.append(tx)
                continue

            # Single-row transfers or income/expense/default
            old_account_id = tx.account_id
            old_amount = float(tx.amount)
            old_neutral = _is_effectively_neutral_txn(tx)
            if not old_neutral:
                if tx.type == models.TxnType.TRANSFER and tx.is_auto_transfer_match and tx.counter_account_id:
                    _revert_single_transfer_effect(db, tx.account_id, tx.counter_account_id, old_amount)
                else:
                    _apply_balance(db, old_account_id, -old_amount)

            # Apply changes
            for key, value in local_changes.items():
                setattr(tx, key, value)

            new_neutral = _is_effectively_neutral_txn(tx)
            if not new_neutral:
                if tx.type == models.TxnType.TRANSFER and tx.is_auto_transfer_match and tx.counter_account_id:
                    _apply_single_transfer_effect(db, tx.account_id, tx.counter_account_id, float(tx.amount))
                else:
                    _apply_balance(db, tx.account_id, float(tx.amount))

            _sync_check_card_auto_deduct(db, tx)
            updated_items.append(tx)
        except HTTPException:
            db.rollback()
            skipped.append(tx.id)
            continue

    if updated_items:
        db.commit()
    else:
        db.rollback()

    # refresh and serialize
    for tx in updated_items:
        db.refresh(tx)

    return TransactionsBulkUpdateResponse(
        updated=len(updated_items),
        items=[TransactionOut.model_validate(tx, from_attributes=True) for tx in updated_items],
        missing=missing,
        skipped=skipped,
    )


@router.get("/recurring-rules/{rule_id}/preview", response_model=RecurringRulePreviewOut)
def preview_recurring_rule(
    rule_id: int,
    start: date = Query(...),
    end: date = Query(...),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    rule = db.query(models.RecurringRule).filter(models.RecurringRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")
    all_dates = list(_iter_occurrences(rule, start, end))
    total_count = len(all_dates)
    if total_count == 0:
        return RecurringRulePreviewOut(items=[], total_count=0, page=1, page_size=page_size)

    page_count = max(1, math.ceil(total_count / page_size))
    current_page = min(page, page_count)
    offset = (current_page - 1) * page_size
    page_dates = all_dates[offset : offset + page_size]

    today = date.today()
    draft_map = _fetch_occurrence_drafts(db, rule.id, page_dates)

    past_dates = [d for d in page_dates if d <= today]
    existing_dates: set[date] = set()
    if past_dates:
        keys = [f"rule-{rule.id}-{d.isoformat()}" for d in past_dates]
        rows = (
            db.query(models.Transaction.occurred_at)
            .filter(
                models.Transaction.user_id == rule.user_id,
                models.Transaction.external_id.in_(keys),
            )
            .all()
        )
        existing_dates = {row[0] for row in rows}

    items: list[RecurringRulePreviewItem] = []
    for occurred_at in page_dates:
        draft = draft_map.get(occurred_at)
        is_future = occurred_at > today
        is_pending = (
            rule.is_variable_amount
            and rule.is_active
            and not is_future
            and occurred_at not in existing_dates
        )
        draft_amount = float(draft.amount) if draft and draft.amount is not None else None
        items.append(
            RecurringRulePreviewItem(
                occurred_at=occurred_at,
                is_future=is_future,
                is_pending=is_pending,
                draft_amount=draft_amount,
                draft_memo=draft.memo if draft else None,
                draft_updated_at=draft.updated_at if draft else None,
            )
        )

    return RecurringRulePreviewOut(
        items=items,
        total_count=total_count,
        page=current_page,
        page_size=page_size,
    )


@router.put("/recurring-rules/{rule_id}/drafts/{occurred_at}", response_model=RecurringOccurrenceDraftOut)
def upsert_recurring_occurrence_draft(
    rule_id: int,
    occurred_at: date,
    payload: RecurringOccurrenceDraftUpsert,
    db: Session = Depends(get_db),
):
    rule = db.query(models.RecurringRule).filter(models.RecurringRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")
    if not rule.is_active:
        raise HTTPException(status_code=400, detail="Inactive recurring rule")
    if not rule.is_variable_amount:
        raise HTTPException(status_code=400, detail="Only variable amount rules support drafts")
    if rule.type == models.TxnType.TRANSFER:
        raise HTTPException(status_code=400, detail="Transfers cannot store drafts")

    today = date.today()
    if occurred_at < today:
        raise HTTPException(status_code=400, detail="Cannot store draft for past occurrence")
    if rule.start_date and occurred_at < rule.start_date:
        raise HTTPException(status_code=400, detail="Occurred date precedes rule start_date")
    if rule.end_date and occurred_at > rule.end_date:
        raise HTTPException(status_code=400, detail="Occurred date exceeds rule end_date")

    _validate_occurrence_alignment(rule, occurred_at)

    draft = (
        db.query(models.RecurringOccurrenceDraft)
        .filter(
            models.RecurringOccurrenceDraft.rule_id == rule.id,
            models.RecurringOccurrenceDraft.occurred_at == occurred_at,
        )
        .first()
    )

    if not draft:
        draft = models.RecurringOccurrenceDraft(rule_id=rule.id, user_id=rule.user_id, occurred_at=occurred_at)
        db.add(draft)

    draft.amount = payload.amount
    draft.memo = payload.memo
    db.commit()
    db.refresh(draft)
    return draft


@router.delete("/recurring-rules/{rule_id}/drafts/{occurred_at}", status_code=204)
def delete_recurring_occurrence_draft(
    rule_id: int,
    occurred_at: date,
    db: Session = Depends(get_db),
):
    rule = db.query(models.RecurringRule).filter(models.RecurringRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")

    deleted = (
        db.query(models.RecurringOccurrenceDraft)
        .filter(
            models.RecurringOccurrenceDraft.rule_id == rule.id,
            models.RecurringOccurrenceDraft.occurred_at == occurred_at,
        )
        .delete(synchronize_session=False)
    )
    if deleted:
        db.commit()
    else:
        db.rollback()
    return None


@router.post("/recurring-rules/{rule_id}/generate", response_model=list[TransactionOut])
def generate_recurring_transactions(
    rule_id: int,
    start: date = Query(...),
    end: date = Query(...),
    db: Session = Depends(get_db),
):
    # 기간 내 발생일 계산 후 트랜잭션 멱등 생성
    rule = db.query(models.RecurringRule).filter(models.RecurringRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")
    if not rule.is_active:
        raise HTTPException(status_code=400, detail="Inactive recurring rule")
    if rule.is_variable_amount:
        raise HTTPException(status_code=400, detail="Variable amount rule requires confirmation with amount")
    if rule.amount is None or float(rule.amount) <= 0:
        raise HTTPException(status_code=400, detail="Recurring rule has no base amount")
    base_amount = float(rule.amount)

    category_id: int | None = None
    if rule.type in (models.TxnType.INCOME, models.TxnType.EXPENSE):
        category_id = rule.category_id or _get_default_category_id(db, txn_type=rule.type)
        if rule.category_id is None and category_id is not None:
            rule.category_id = category_id
            db.flush()

    results: list[models.Transaction] = []
    for d in _iter_occurrences(rule, start, end):
        ext_id = f"rule-{rule.id}-{d.isoformat()}"
        exists = (
            db.query(models.Transaction)
            .filter(models.Transaction.user_id == rule.user_id, models.Transaction.external_id == ext_id)
            .first()
        )
        if exists:
            results.append(exists)
            continue
        if rule.type == models.TxnType.TRANSFER:
            payload = TransactionCreate(
                user_id=rule.user_id,
                occurred_at=d,
                type=models.TxnType.TRANSFER,
                account_id=rule.account_id,
                counter_account_id=rule.counter_account_id,
                amount=abs(base_amount),
                currency=rule.currency,
                memo=rule.memo,
                external_id=ext_id,
            )
        else:
            signed_amount = _signed_amount_for_rule(rule, base_amount)
            payload = TransactionCreate(
                user_id=rule.user_id,
                occurred_at=d,
                type=rule.type,
                account_id=rule.account_id,
                category_id=category_id,
                amount=signed_amount,
                currency=rule.currency,
                memo=rule.memo,
                external_id=ext_id,
            )
        # create_transaction 재사용
        created = create_transaction(payload, db)
        results.append(created)
    if results:
        latest_occurrence = max((tx.occurred_at for tx in results if tx.occurred_at is not None), default=None)
        if latest_occurrence:
            rule.last_generated_at = latest_occurrence
    db.commit()
    return results


def _validate_occurrence_alignment(rule: models.RecurringRule, occurred_at: date) -> None:
    if not any(d == occurred_at for d in _iter_occurrences(rule, occurred_at, occurred_at)):
        raise HTTPException(status_code=400, detail="Date does not align with rule schedule")


def _confirm_variable_occurrence(
    *,
    db: Session,
    rule: models.RecurringRule,
    occurred_at: date,
    amount: float,
    memo: str | None,
) -> models.Transaction:
    today = date.today()
    if rule.start_date and occurred_at < rule.start_date:
        raise HTTPException(status_code=400, detail="Occurred date precedes rule start_date")
    if rule.end_date and occurred_at > rule.end_date:
        raise HTTPException(status_code=400, detail="Occurred date exceeds rule end_date")
    if occurred_at > today:
        raise HTTPException(status_code=400, detail="Occurred date cannot be in the future")

    _validate_occurrence_alignment(rule, occurred_at)

    ext_id = f"rule-{rule.id}-{occurred_at.isoformat()}"
    existing = (
        db.query(models.Transaction)
        .filter(models.Transaction.user_id == rule.user_id, models.Transaction.external_id == ext_id)
        .first()
    )
    if existing:
        _remove_occurrence_draft(db, rule.id, occurred_at)
        if rule.last_generated_at is None or occurred_at > rule.last_generated_at:
            rule.last_generated_at = occurred_at
        db.commit()
        return existing

    signed_amount = _signed_amount_for_rule(rule, amount)
    memo_value = memo if memo is not None else rule.memo

    category_id: int | None = None
    if rule.type in (models.TxnType.INCOME, models.TxnType.EXPENSE):
        category_id = rule.category_id or _get_default_category_id(db, txn_type=rule.type)
        if rule.category_id is None and category_id is not None:
            rule.category_id = category_id
            db.flush()

    tx_payload = TransactionCreate(
        user_id=rule.user_id,
        occurred_at=occurred_at,
        type=rule.type,
        account_id=rule.account_id,
        category_id=category_id,
        amount=signed_amount,
        currency=rule.currency,
        memo=memo_value,
        external_id=ext_id,
    )

    created = create_transaction(tx_payload, db)

    if rule.last_generated_at is None or occurred_at > rule.last_generated_at:
        rule.last_generated_at = occurred_at
    _remove_occurrence_draft(db, rule.id, occurred_at)
    db.commit()
    db.refresh(created)
    return created


@router.post("/recurring-rules/{rule_id}/confirm", response_model=TransactionOut)
def confirm_variable_recurring_occurrence(
    rule_id: int,
    payload: RecurringRuleConfirm,
    db: Session = Depends(get_db),
):
    rule = db.query(models.RecurringRule).filter(models.RecurringRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")
    if not rule.is_active:
        raise HTTPException(status_code=400, detail="Inactive recurring rule")
    if not rule.is_variable_amount:
        raise HTTPException(status_code=400, detail="Rule does not accept variable confirmations")
    if rule.type == models.TxnType.TRANSFER:
        raise HTTPException(status_code=400, detail="Transfers cannot use variable amounts")
    if not rule.category_id:
        raise HTTPException(status_code=400, detail="Variable recurring rule must have category")

    return _confirm_variable_occurrence(
        db=db,
        rule=rule,
        occurred_at=payload.occurred_at,
        amount=payload.amount,
        memo=payload.memo,
    )


@router.post("/recurring-rules/{rule_id}/confirm-bulk", response_model=RecurringRuleBulkConfirmResult)
def confirm_variable_recurring_bulk(
    rule_id: int,
    payload: RecurringRuleBulkConfirmRequest,
    db: Session = Depends(get_db),
):
    rule = db.query(models.RecurringRule).filter(models.RecurringRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")
    if not rule.is_active:
        raise HTTPException(status_code=400, detail="Inactive recurring rule")
    if not rule.is_variable_amount:
        raise HTTPException(status_code=400, detail="Rule does not accept variable confirmations")
    if rule.type == models.TxnType.TRANSFER:
        raise HTTPException(status_code=400, detail="Transfers cannot use variable amounts")
    if not rule.category_id:
        raise HTTPException(status_code=400, detail="Variable recurring rule must have category")

    confirmed: list[models.Transaction] = []
    errors: list[RecurringRuleBulkConfirmError] = []

    for item in payload.items:
        try:
            tx = _confirm_variable_occurrence(
                db=db,
                rule=rule,
                occurred_at=item.occurred_at,
                amount=item.amount,
                memo=item.memo,
            )
            confirmed.append(tx)
        except HTTPException as exc:  # type: ignore[assignment]
            db.rollback()
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            errors.append(RecurringRuleBulkConfirmError(occurred_at=item.occurred_at, detail=detail))
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            errors.append(RecurringRuleBulkConfirmError(occurred_at=item.occurred_at, detail=str(exc)))

    confirmed_payloads = [TransactionOut.model_validate(tx, from_attributes=True) for tx in confirmed]
    if errors:
        # ensure rule state reflects latest confirmations even when partial failures occurred
        db.expire(rule, [])

    return RecurringRuleBulkConfirmResult(confirmed=confirmed_payloads, errors=errors)


@router.get("/recurring-rules/{rule_id}/history", response_model=RecurringRuleHistoryOut)
def get_recurring_rule_history(
    rule_id: int,
    user_id: int = Query(..., ge=1),
    limit: int = Query(50, ge=1, le=365),
    db: Session = Depends(get_db),
):
    rule = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.id == rule_id, models.RecurringRule.user_id == user_id)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="RecurringRule not found")

    q = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.user_id == user_id,
            models.Transaction.external_id.like(f"rule-{rule_id}-%"),
        )
        .order_by(models.Transaction.occurred_at.desc(), models.Transaction.id.desc())
    )

    rows = q.limit(limit).all()

    history_items: list[RecurringRuleHistoryItem] = []
    magnitudes: list[float] = []
    base_amount = float(rule.amount) if rule.amount is not None else None

    for txn in rows:
        amount_abs = abs(float(txn.amount))
        magnitudes.append(amount_abs)
        delta = amount_abs - base_amount if base_amount is not None else None
        history_items.append(
            RecurringRuleHistoryItem(
                transaction_id=txn.id,
                occurred_at=txn.occurred_at,
                amount=amount_abs,
                memo=txn.memo,
                delta_from_rule=delta,
            )
        )

    count = len(magnitudes)
    min_amount = min(magnitudes) if magnitudes else None
    max_amount = max(magnitudes) if magnitudes else None
    average_amount = (sum(magnitudes) / count) if count else None

    def _delta_value(value: float | None) -> float | None:
        if value is None or base_amount is None:
            return None
        return value - base_amount

    min_delta = _delta_value(min_amount)
    max_delta = _delta_value(max_amount)
    average_delta = _delta_value(average_amount)

    return RecurringRuleHistoryOut(
        rule_id=rule.id,
        user_id=user_id,
        currency=rule.currency,
        base_amount=base_amount,
        count=count,
        min_amount=min_amount,
        max_amount=max_amount,
        average_amount=average_amount,
        min_delta=min_delta,
        max_delta=max_delta,
        average_delta=average_delta,
        transactions=history_items,
    )


def _month_key(value: date) -> str:
    return value.strftime("%Y-%m")


def _build_monthly_flow(transactions: list[models.Transaction]) -> list[AnalyticsMonthlyFlowItem]:
    buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"income": 0.0, "expense": 0.0})
    for txn in transactions:
        month = _month_key(txn.occurred_at)
        bucket = buckets[month]
        amount = float(txn.amount)
        if txn.type == models.TxnType.INCOME:
            bucket["income"] += abs(amount)
        elif txn.type == models.TxnType.EXPENSE:
            bucket["expense"] += abs(amount)
    items: list[AnalyticsMonthlyFlowItem] = []
    for month in sorted(buckets.keys()):
        values = buckets[month]
        income = values["income"]
        expense = values["expense"]
        items.append(
            AnalyticsMonthlyFlowItem(
                month=month,
                income=income,
                expense=expense,
                net=income - expense,
            )
        )
    return items


def _build_category_share(
    transactions: list[models.Transaction],
    categories: dict[int, models.Category],
    groups: dict[int, models.CategoryGroup],
) -> list[AnalyticsCategoryShareItem]:
    # Aggregate by logical category group key (type + code_gg) across members to prevent per-user splits.
    totals: DefaultDict[tuple[models.TxnType, str], float] = defaultdict(float)
    labels: dict[tuple[models.TxnType, str], tuple[int | None, str]] = {}

    for txn in transactions:
        if txn.type not in (models.TxnType.INCOME, models.TxnType.EXPENSE):
            continue
        txn_type_effective = txn.type
        logical_key: str = "UNCLF"
        label: str = "미분류"
        group_id_for_label: int | None = None
        if txn.category_id is not None and txn.category_id in categories:
            cat = categories[txn.category_id]
            group = groups.get(cat.group_id)
            if group:
                logical_key = f"{group.type}:{group.code_gg:02d}"
                label = f"{group.type}{group.code_gg:02d} {group.name}"
                group_id_for_label = group.id
                txn_type_effective = models.TxnType.INCOME if group.type == "I" else models.TxnType.EXPENSE
        amount = abs(float(txn.amount))
        key = (txn_type_effective, logical_key)
        totals[key] += amount
        labels[key] = (group_id_for_label, label)

    results: list[AnalyticsCategoryShareItem] = []
    for txn_type in (models.TxnType.INCOME, models.TxnType.EXPENSE):
        relevant_keys = [key for key in totals.keys() if key[0] == txn_type]
        if not relevant_keys:
            continue
        type_total = sum(totals[key] for key in relevant_keys) or 1.0
        for key in sorted(relevant_keys, key=lambda item: totals[item], reverse=True):
            _, logical_key = key
            group_id, label = labels[key]
            amount = totals[key]
            results.append(
                AnalyticsCategoryShareItem(
                    category_group_id=group_id,
                    category_group_name=label,
                    type=txn_type,
                    amount=amount,
                    percentage=amount / type_total,
                )
            )

    return results


def _build_kpis(
    transactions: list[models.Transaction],
    category_share: list[AnalyticsCategoryShareItem],
) -> AnalyticsKpisOut:
    total_income = 0.0
    total_expense = 0.0
    transaction_count = 0
    day_set: set[date] = set()

    for txn in transactions:
        if txn.type == models.TxnType.INCOME:
            total_income += abs(float(txn.amount))
            transaction_count += 1
            day_set.add(txn.occurred_at)
        elif txn.type == models.TxnType.EXPENSE:
            total_expense += abs(float(txn.amount))
            transaction_count += 1
            day_set.add(txn.occurred_at)

    average_daily_expense = total_expense / len(day_set) if day_set else 0.0
    net = total_income - total_expense
    top_expense_category = next((item for item in category_share if item.type == models.TxnType.EXPENSE), None)

    return AnalyticsKpisOut(
        total_income=total_income,
        total_expense=total_expense,
        net=net,
        average_daily_expense=average_daily_expense,
        transaction_count=transaction_count,
        top_expense_category=top_expense_category,
    )


def _build_account_timeline(
    transactions: list[models.Transaction],
    accounts: dict[int, models.Account],
) -> list[AnalyticsTimelineSeries]:
    grouped: dict[int, dict[date, float]] = defaultdict(lambda: defaultdict(float))
    for txn in transactions:
        amount = float(txn.amount)
        if txn.type == models.TxnType.EXPENSE:
            amount = -abs(amount)
            grouped[txn.account_id][txn.occurred_at] += amount
        elif txn.type == models.TxnType.INCOME:
            amount = abs(amount)
            grouped[txn.account_id][txn.occurred_at] += amount
        elif txn.type == models.TxnType.TRANSFER:
            # For transfers, attribute outflows (negative) to the source account and
            # inflows (positive) to the destination account to avoid canceling within one series.
            if amount < 0:
                grouped[txn.account_id][txn.occurred_at] += amount
            else:
                target_acc = txn.counter_account_id or txn.account_id
                grouped[target_acc][txn.occurred_at] += amount
        else:
            grouped[txn.account_id][txn.occurred_at] += amount

    series_list: list[AnalyticsTimelineSeries] = []
    for account_id, day_map in grouped.items():
        running = 0.0
        points: list[AnalyticsTimelinePoint] = []
        for occurred_at, day_amount in sorted(day_map.items(), key=lambda item: item[0]):
            running += day_amount
            points.append(
                AnalyticsTimelinePoint(
                    occurred_at=occurred_at,
                    net_change=day_amount,
                    running_total=running,
                )
            )
        account = accounts.get(account_id)
        series_list.append(
            AnalyticsTimelineSeries(
                account_id=account_id,
                account_name=account.name if account else f"계정 {account_id}",
                currency=account.currency if account else None,
                points=points,
            )
        )

    series_list.sort(key=lambda item: item.account_name)
    return series_list


def _build_insights(kpis: AnalyticsKpisOut, monthly_flow: list[AnalyticsMonthlyFlowItem]) -> list[AnalyticsInsightOut]:
    insights: list[AnalyticsInsightOut] = []
    if kpis.net >= 0:
        insights.append(
            AnalyticsInsightOut(
                id="net-positive",
                title="흑자 흐름",
                body=f"현재 선택 범위에서 {int(round(kpis.net)):,}원 흑자를 기록했습니다.",
                severity="positive",
            )
        )
    else:
        insights.append(
            AnalyticsInsightOut(
                id="net-negative",
                title="적자 주의",
                body=f"현재 선택 범위에서 {int(round(abs(kpis.net))):,}원 적자를 기록했습니다. 절감이 필요한 영역을 확인해 보세요.",
                severity="warning",
            )
        )

    if kpis.top_expense_category:
        insights.append(
            AnalyticsInsightOut(
                id="top-category",
                title="최대 지출 카테고리",
                body=f"{kpis.top_expense_category.category_group_name} 지출이 {int(round(kpis.top_expense_category.amount)):,}원으로 가장 큽니다.",
                severity="info",
            )
        )

    if len(monthly_flow) >= 2:
        last = monthly_flow[-1]
        prev = monthly_flow[-2]
        delta = last.expense - prev.expense
        if prev.expense:
            ratio = abs(delta) / prev.expense
            if ratio > 0.2:
                label = "증가" if delta > 0 else "감소"
                severity: Literal["warning", "positive"] = "warning" if delta > 0 else "positive"
                insights.append(
                    AnalyticsInsightOut(
                        id="expense-trend",
                        title="최근 지출 변화",
                        body=f"{last.month} 지출이 {label}하여 {int(round(delta)):,}원 {label}했습니다.",
                        severity=severity,
                    )
                )

    return insights
def _month_floor(value: date) -> date:
    return date(value.year, value.month, 1)


def _add_months(base: date, delta: int) -> date:
    year = base.year + (base.month - 1 + delta) // 12
    month = (base.month - 1 + delta) % 12 + 1
    return date(year, month, 1)


def _resolve_group_label(
    category_id: int | None,
    categories: dict[int, models.Category],
    groups: dict[int, models.CategoryGroup],
) -> tuple[int | None, str]:
    if category_id is not None and category_id in categories:
        category = categories[category_id]
        group = groups.get(category.group_id)
        if group:
            label = f"{group.type}{group.code_gg:02d} {group.name}"
            return category.group_id, label
    return None, "미분류"


def _build_category_trends(
    transactions: list[models.Transaction],
    categories: dict[int, models.Category],
    groups: dict[int, models.CategoryGroup],
) -> list[AnalyticsCategoryTrendItem]:
    month_totals: dict[tuple[models.TxnType, int | None], dict[date, float]] = defaultdict(lambda: defaultdict(float))

    for txn in transactions:
        if txn.type not in (models.TxnType.INCOME, models.TxnType.EXPENSE):
            continue
        group_id, _ = _resolve_group_label(txn.category_id, categories, groups)
        month_date = _month_floor(txn.occurred_at)
        amount = abs(float(txn.amount))
        month_totals[(txn.type, group_id)][month_date] += amount

    items: list[AnalyticsCategoryTrendItem] = []
    for (txn_type, group_id), month_map in month_totals.items():
        if not month_map:
            continue
        month_dates = sorted(month_map.keys())
        latest_month = month_dates[-1]
        current_amount = month_map.get(latest_month, 0.0)

        prev_month = _add_months(latest_month, -1)
        prev_amount = month_map.get(prev_month)
        mom_change = None
        if prev_amount is not None and prev_amount > 0:
            mom_change = (current_amount - prev_amount) / prev_amount

        qoq_current = sum(
            month_map.get(_add_months(latest_month, offset), 0.0)
            for offset in (-2, -1, 0)
        )
        qoq_prev = sum(
            month_map.get(_add_months(latest_month, offset), 0.0)
            for offset in (-5, -4, -3)
        )
        qoq_change = None
        if qoq_prev > 0:
            qoq_change = (qoq_current - qoq_prev) / qoq_prev

        yoy_prev_month = _add_months(latest_month, -12)
        yoy_amount = month_map.get(yoy_prev_month)
        yoy_change = None
        if yoy_amount is not None and yoy_amount > 0:
            yoy_change = (current_amount - yoy_amount) / yoy_amount

        label_group = None
        if group_id is not None:
            group = groups.get(group_id)
            if group:
                label_group = f"{group.type}{group.code_gg:02d} {group.name}"
        category_group_name = label_group or "미분류"

        items.append(
            AnalyticsCategoryTrendItem(
                category_group_id=group_id,
                category_group_name=category_group_name,
                type=txn_type,
                month=_month_key(latest_month),
                amount=current_amount,
                previous_month_amount=prev_amount,
                mom_change=mom_change,
                qoq_change=qoq_change,
                yoy_change=yoy_change,
            )
        )

    items.sort(
        key=lambda item: (
            0 if item.type == models.TxnType.EXPENSE else 1,
            -(item.amount),
            item.category_group_name,
        )
    )
    return items


def _build_category_momentum(trends: list[AnalyticsCategoryTrendItem]) -> AnalyticsCategoryMomentumOut:
    expense_items = [item for item in trends if item.type == models.TxnType.EXPENSE]
    rising_candidates = [item for item in expense_items if item.mom_change is not None and item.mom_change > 0]
    rising = sorted(rising_candidates, key=lambda item: item.mom_change or 0.0, reverse=True)[:3]
    falling_candidates = [item for item in expense_items if item.mom_change is not None and item.mom_change < 0]
    falling = sorted(falling_candidates, key=lambda item: item.mom_change or 0.0)[:3]
    return AnalyticsCategoryMomentumOut(top_rising=rising, top_falling=falling)


def _build_weekly_heatmap(transactions: list[models.Transaction]) -> AnalyticsWeeklyHeatmapOut:
    totals: dict[tuple[int, int], float] = defaultdict(float)
    max_value = 0.0
    for txn in transactions:
        if txn.type != models.TxnType.EXPENSE:
            continue
        weekday = txn.occurred_at.weekday()
        hour = txn.occurred_time.hour if isinstance(txn.occurred_time, time) else 12
        amount = abs(float(txn.amount))
        key = (weekday, hour)
        totals[key] += amount
        if totals[key] > max_value:
            max_value = totals[key]

    buckets = [
        AnalyticsHeatmapBucket(day_of_week=day, hour=hour, amount=value)
        for (day, hour), value in sorted(totals.items())
    ]
    return AnalyticsWeeklyHeatmapOut(buckets=buckets, max_value=max_value)


def _build_account_volatility(series_list: list[AnalyticsTimelineSeries]) -> list[AnalyticsAccountVolatilityItem]:
    items: list[AnalyticsAccountVolatilityItem] = []
    for series in series_list:
        changes = [float(point.net_change) for point in series.points]
        if not changes:
            avg = 0.0
            stddev = 0.0
        else:
            avg = statistics.mean(changes)
            stddev = statistics.pstdev(changes) if len(changes) > 1 else 0.0
        total_change = sum(changes)
        items.append(
            AnalyticsAccountVolatilityItem(
                account_id=series.account_id,
                account_name=series.account_name,
                currency=series.currency,
                average_daily_change=avg,
                daily_stddev=stddev,
                total_change=total_change,
            )
        )

    items.sort(key=lambda item: abs(item.daily_stddev), reverse=True)
    return items


def _build_advanced_metrics(
    transactions: list[models.Transaction],
    accounts: dict[int, models.Account],
    kpis: AnalyticsKpisOut,
    category_share: list[AnalyticsCategoryShareItem],
    account_timeline: list[AnalyticsTimelineSeries],
    start: date | None,
    end: date | None,
) -> AnalyticsAdvancedKpisOut:
    if transactions:
        min_day = min(txn.occurred_at for txn in transactions)
        max_day = max(txn.occurred_at for txn in transactions)
    else:
        min_day = start or date.today()
        max_day = end or start or date.today()

    range_start = start or min_day
    range_end = end or max_day
    total_days = max((range_end - range_start).days + 1, 1)
    net = kpis.net
    average_daily_net = net / total_days

    total_balance = 0.0
    for account in accounts.values():
        balance_value = float(account.balance)
        if balance_value > 0:
            total_balance += balance_value

    projected_runway_days = None
    projected_runout_date = None
    reference_date = range_end if end else date.today()
    if average_daily_net < 0 and total_balance > 0:
        runway = total_balance / abs(average_daily_net)
        projected_runway_days = runway
        projected_runout_date = reference_date + timedelta(days=math.ceil(runway))

    expense_items = [item for item in category_share if item.type == models.TxnType.EXPENSE]
    if expense_items:
        concentration_index = sum((item.percentage or 0.0) ** 2 for item in expense_items)
    else:
        concentration_index = 0.0

    if concentration_index < 0.15:
        level: Literal["low", "moderate", "high"] = "low"
    elif concentration_index < 0.25:
        level = "moderate"
    else:
        level = "high"

    savings_rate = net / kpis.total_income if kpis.total_income else None
    savings_to_expense_ratio = net / kpis.total_expense if kpis.total_expense else None

    account_volatility = _build_account_volatility(account_timeline)

    return AnalyticsAdvancedKpisOut(
        savings_rate=savings_rate,
        savings_to_expense_ratio=savings_to_expense_ratio,
        average_daily_net=average_daily_net,
        projected_runway_days=projected_runway_days,
        projected_runout_date=projected_runout_date,
        total_liquid_balance=total_balance,
        expense_concentration_index=concentration_index,
        expense_concentration_level=level,
        account_volatility=account_volatility,
    )


def _detect_expense_anomalies(
    transactions: list[models.Transaction],
    accounts: dict[int, models.Account],
    categories: dict[int, models.Category],
    groups: dict[int, models.CategoryGroup],
) -> list[AnalyticsAnomalyOut]:
    expenses = [txn for txn in transactions if txn.type == models.TxnType.EXPENSE]
    amounts = [abs(float(txn.amount)) for txn in expenses]
    if len(amounts) < 2:
        return []

    mean_value = statistics.mean(amounts)
    stddev = statistics.pstdev(amounts)
    if stddev == 0:
        return []

    median_value = statistics.median(amounts)

    anomalies: list[AnalyticsAnomalyOut] = []
    for txn, amount in zip(expenses, amounts):
        z_score = (amount - mean_value) / stddev
        is_outlier = z_score >= 2.0
        if not is_outlier and median_value > 0 and amount >= median_value * 2.5:
            is_outlier = True
        if not is_outlier:
            continue
        _, group_label = _resolve_group_label(txn.category_id, categories, groups)
        account = accounts.get(txn.account_id)
        account_name = account.name if account else f"계좌 {txn.account_id}"
        anomalies.append(
            AnalyticsAnomalyOut(
                transaction_id=txn.id,
                occurred_at=txn.occurred_at,
                account_id=txn.account_id,
                account_name=account_name,
                category_group_name=group_label,
                amount=amount,
                z_score=z_score,
                type=txn.type,
                memo=txn.memo,
            )
        )

    anomalies.sort(key=lambda item: item.z_score, reverse=True)
    return anomalies[:10]


def _grace_days_for_frequency(freq: models.RecurringFrequency) -> int:
    if freq == models.RecurringFrequency.DAILY:
        return 1
    if freq == models.RecurringFrequency.WEEKLY:
        return 2
    if freq == models.RecurringFrequency.MONTHLY:
        return 4
    if freq == models.RecurringFrequency.YEARLY:
        return 14
    return 3


def _expected_dates_for_rule(
    rule: models.RecurringRule,
    window_start: date,
    window_end: date,
) -> list[date]:
    if rule.start_date and rule.start_date > window_end:
        return []
    if rule.end_date and rule.end_date < window_start:
        return []

    effective_start = max(window_start, rule.start_date) if rule.start_date else window_start
    effective_end = min(window_end, rule.end_date) if rule.end_date else window_end
    if effective_start > effective_end:
        return []

    dates: list[date] = []
    if rule.frequency == models.RecurringFrequency.DAILY:
        current = effective_start
        while current <= effective_end:
            dates.append(current)
            current = current + timedelta(days=1)
        return dates

    if rule.frequency == models.RecurringFrequency.WEEKLY:
        if rule.weekday is None:
            return []
        offset = (rule.weekday - effective_start.weekday()) % 7
        current = effective_start + timedelta(days=offset)
        while current <= effective_end:
            dates.append(current)
            current = current + timedelta(days=7)
        return dates

    if rule.frequency == models.RecurringFrequency.MONTHLY:
        base_day = rule.day_of_month or (rule.start_date.day if rule.start_date else effective_start.day)
        year = effective_start.year
        month = effective_start.month
        while True:
            last_day = calendar.monthrange(year, month)[1]
            day = min(base_day, last_day)
            candidate = date(year, month, day)
            if candidate < effective_start:
                if month == 12:
                    year += 1
                    month = 1
                else:
                    month += 1
                continue
            if candidate > effective_end:
                break
            dates.append(candidate)
            if month == 12:
                year += 1
                month = 1
            else:
                month += 1
        return dates

    if rule.frequency == models.RecurringFrequency.YEARLY:
        if rule.start_date is None:
            return []
        base_month = rule.start_date.month
        base_day = rule.day_of_month or rule.start_date.day
        year = effective_start.year
        while True:
            day = min(base_day, calendar.monthrange(year, base_month)[1])
            candidate = date(year, base_month, day)
            if candidate < effective_start:
                year += 1
                continue
            if candidate > effective_end:
                break
            dates.append(candidate)
            year += 1
        return dates

    return []


def _analyze_recurring_rules(
    rules: list[models.RecurringRule],
    transactions: list[models.Transaction],
    accounts: dict[int, models.Account],
    categories: dict[int, models.Category],
    groups: dict[int, models.CategoryGroup],
    start: date | None,
    end: date | None,
) -> tuple[list[AnalyticsIncomeDelayOut], AnalyticsRecurringCoverageOut]:
    if not rules:
        empty_coverage = AnalyticsRecurringCoverageOut(
            total_rules=0,
            rules_in_window=0,
            overall_coverage_rate=None,
            income_coverage_rate=None,
            expense_coverage_rate=None,
            uncovered_rules=[],
        )
        return [], empty_coverage

    reference_date = end or date.today()
    window_start = start or max(reference_date - timedelta(days=90), date(reference_date.year, reference_date.month, 1))

    txn_by_rule_key: dict[tuple[models.TxnType, int, int | None], list[date]] = defaultdict(list)
    for txn in transactions:
        if txn.type not in (models.TxnType.INCOME, models.TxnType.EXPENSE):
            continue
        txn_by_rule_key[(txn.type, txn.account_id, txn.category_id)].append(txn.occurred_at)

    for key_dates in txn_by_rule_key.values():
        key_dates.sort()

    coverage_items: list[AnalyticsRecurringCoverageItem] = []
    alerts: list[AnalyticsIncomeDelayOut] = []

    overall_expected = 0
    overall_actual = 0
    income_expected = 0
    income_actual = 0
    expense_expected = 0
    expense_actual = 0
    rules_in_window = 0

    for rule in rules:
        if not rule.is_active:
            continue
        if rule.type not in (models.TxnType.INCOME, models.TxnType.EXPENSE):
            continue

        expected_dates = _expected_dates_for_rule(rule, window_start, reference_date)
        if not expected_dates:
            continue

        rules_in_window += 1
        key = (rule.type, rule.account_id, rule.category_id)
        actual_dates = list(txn_by_rule_key.get(key, []))
        used = [False] * len(actual_dates)

        tolerance = _grace_days_for_frequency(rule.frequency)
        matched = 0
        last_actual: date | None = actual_dates[-1] if actual_dates else None

        for expected in expected_dates:
            match_idx = None
            for idx, actual in enumerate(actual_dates):
                if used[idx]:
                    continue
                if abs((actual - expected).days) <= tolerance:
                    match_idx = idx
                    break
            if match_idx is not None:
                used[match_idx] = True
                matched += 1

        expected_count = len(expected_dates)
        coverage_rate = matched / expected_count if expected_count else 1.0

        overall_expected += expected_count
        overall_actual += matched
        if rule.type == models.TxnType.INCOME:
            income_expected += expected_count
            income_actual += matched
        else:
            expense_expected += expected_count
            expense_actual += matched

        coverage_items.append(
            AnalyticsRecurringCoverageItem(
                rule_id=rule.id,
                rule_name=rule.name,
                type=rule.type,
                frequency=rule.frequency,
                expected_occurrences=expected_count,
                actual_occurrences=matched,
                coverage_rate=coverage_rate,
            )
        )

        last_expected = max(expected_dates)
        grace = _grace_days_for_frequency(rule.frequency)
        needs_alert = False
        delay_days = 0
        if last_actual is None:
            delay_days = max((reference_date - last_expected).days, 0)
            needs_alert = delay_days > grace
        else:
            if last_actual <= last_expected - timedelta(days=grace):
                delay_days = max((reference_date - last_actual).days, 0)
                needs_alert = delay_days > grace

        if needs_alert:
            account = accounts.get(rule.account_id)
            account_name = account.name if account else f"계좌 {rule.account_id}"
            alerts.append(
                AnalyticsIncomeDelayOut(
                    rule_id=rule.id,
                    rule_name=rule.name,
                    expected_date=last_expected,
                    last_seen_date=last_actual,
                    delay_days=delay_days,
                    account_name=account_name,
                    amount_hint=float(rule.amount) if rule.amount is not None else None,
                )
            )

    uncovered = [item for item in coverage_items if item.coverage_rate < 1.0]
    uncovered.sort(key=lambda item: item.coverage_rate)

    overall_rate = (overall_actual / overall_expected) if overall_expected else None
    income_rate = (income_actual / income_expected) if income_expected else None
    expense_rate = (expense_actual / expense_expected) if expense_expected else None

    coverage = AnalyticsRecurringCoverageOut(
        total_rules=len([rule for rule in rules if rule.is_active and rule.type in (models.TxnType.INCOME, models.TxnType.EXPENSE)]),
        rules_in_window=rules_in_window,
        overall_coverage_rate=overall_rate,
        income_coverage_rate=income_rate,
        expense_coverage_rate=expense_rate,
        uncovered_rules=uncovered[:5],
    )

    alerts.sort(key=lambda item: item.delay_days, reverse=True)
    return alerts, coverage


def _build_forecast(monthly_flow: list[AnalyticsMonthlyFlowItem]) -> AnalyticsForecastOut:
    if not monthly_flow:
        return AnalyticsForecastOut(
            next_month_income=0.0,
            next_month_expense=0.0,
            next_month_net=0.0,
            methodology="insufficient_data",
        )

    recent = monthly_flow[-3:] if len(monthly_flow) >= 3 else monthly_flow
    avg_income = statistics.mean(item.income for item in recent)
    avg_expense = statistics.mean(item.expense for item in recent)
    next_net = avg_income - avg_expense
    methodology = "three_month_average" if len(recent) >= 3 else "simple_average"
    return AnalyticsForecastOut(
        next_month_income=avg_income,
        next_month_expense=avg_expense,
        next_month_net=next_net,
        methodology=methodology,
    )
def _normalize_category_ids_for_user(db: Session, user_id: int, category_ids: list[int]) -> list[int]:
    normalized = sorted(set(category_ids))
    if not normalized:
        return []
    existing_ids = {row[0] for row in db.query(models.Category.id).filter(models.Category.id.in_(normalized)).all()}
    missing = set(normalized) - existing_ids
    if missing:
        raise HTTPException(status_code=400, detail=f"Invalid category ids: {sorted(missing)}")
    return normalized


@router.get("/statistics/settings", response_model=StatisticsSettingsOut)
def get_statistics_settings(
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    setting = (
        db.query(models.StatisticsSetting)
        .filter(models.StatisticsSetting.user_id == user_id)
        .first()
    )
    excluded_ids = list(setting.excluded_category_ids or []) if setting else []
    return StatisticsSettingsOut(user_id=user_id, excluded_category_ids=excluded_ids)


@router.put("/statistics/settings", response_model=StatisticsSettingsOut)
def upsert_statistics_settings(
    payload: StatisticsSettingsIn,
    db: Session = Depends(get_db),
):
    normalized_ids = _normalize_category_ids_for_user(db, payload.user_id, payload.excluded_category_ids)

    setting = (
        db.query(models.StatisticsSetting)
        .filter(models.StatisticsSetting.user_id == payload.user_id)
        .first()
    )
    if not setting:
        setting = models.StatisticsSetting(user_id=payload.user_id, excluded_category_ids=normalized_ids)
        db.add(setting)
    else:
        setting.excluded_category_ids = normalized_ids

    db.commit()
    db.refresh(setting)
    return StatisticsSettingsOut(user_id=payload.user_id, excluded_category_ids=list(setting.excluded_category_ids or []))


@router.get("/statistics/presets", response_model=list[StatisticsPresetOut])
def list_statistics_presets(
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    presets = (
        db.query(models.StatisticsPreset)
        .filter(models.StatisticsPreset.user_id == user_id)
        .order_by(models.StatisticsPreset.name, models.StatisticsPreset.id)
        .all()
    )
    return presets


@router.post("/statistics/presets", response_model=StatisticsPresetOut, status_code=201)
def create_statistics_preset(
    payload: StatisticsPresetCreate,
    db: Session = Depends(get_db),
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Preset name cannot be empty")

    duplicate = (
        db.query(models.StatisticsPreset)
        .filter(
            models.StatisticsPreset.user_id == payload.user_id,
            models.StatisticsPreset.name == name,
        )
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="Preset name already exists")

    normalized_ids = _normalize_category_ids_for_user(db, payload.user_id, payload.selected_category_ids)
    memo = (payload.memo or "").strip() or None

    preset = models.StatisticsPreset(
        user_id=payload.user_id,
        name=name,
        memo=memo,
        selected_category_ids=normalized_ids,
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return preset


@router.put("/statistics/presets/{preset_id}", response_model=StatisticsPresetOut)
def update_statistics_preset(
    preset_id: int,
    payload: StatisticsPresetUpdate,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    preset = (
        db.query(models.StatisticsPreset)
        .filter(
            models.StatisticsPreset.id == preset_id,
            models.StatisticsPreset.user_id == user_id,
        )
        .first()
    )
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")

    payload_data = payload.model_dump(exclude_unset=True)

    if "name" in payload_data:
        name = (payload_data.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Preset name cannot be empty")
        duplicate = (
            db.query(models.StatisticsPreset)
            .filter(
                models.StatisticsPreset.user_id == user_id,
                models.StatisticsPreset.name == name,
                models.StatisticsPreset.id != preset_id,
            )
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="Preset name already exists")
        preset.name = name

    if "memo" in payload_data:
        memo_value = payload_data.get("memo")
        preset.memo = (memo_value or "").strip() or None

    if "selected_category_ids" in payload_data:
        ids_value = payload_data.get("selected_category_ids") or []
        preset.selected_category_ids = _normalize_category_ids_for_user(db, user_id, ids_value)

    db.commit()
    db.refresh(preset)
    return preset


@router.delete("/statistics/presets/{preset_id}", status_code=204)
def delete_statistics_preset(
    preset_id: int,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    preset = (
        db.query(models.StatisticsPreset)
        .filter(
            models.StatisticsPreset.id == preset_id,
            models.StatisticsPreset.user_id == user_id,
        )
        .first()
    )
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")

    db.delete(preset)
    db.commit()
    return None


@router.get("/analytics/overview", response_model=AnalyticsOverviewOut)
def analytics_overview(
    user_id: list[int] = Query(...),
    start: date | None = Query(None),
    end: date | None = Query(None),
    account_id: int | None = Query(None),
    include_transfers: bool = Query(True),
    include_settlements: bool = Query(False),
    db: Session = Depends(get_db),
):
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="end must be on or after start")

    tx_query = db.query(models.Transaction).filter(models.Transaction.user_id.in_(user_id))
    if start:
        tx_query = tx_query.filter(models.Transaction.occurred_at >= start)
    if end:
        tx_query = tx_query.filter(models.Transaction.occurred_at <= end)
    if account_id:
        tx_query = tx_query.filter(models.Transaction.account_id == account_id)
    transactions_all = (
        tx_query.order_by(
            models.Transaction.occurred_at.asc(),
            models.Transaction.occurred_time.asc(),
            models.Transaction.id.asc(),
        ).all()
    )

    transfer_group_ids: set[int] = set()
    if not include_transfers:
        transfer_group_ids = {
            int(txn.group_id)
            for txn in transactions_all
            if txn.group_id is not None
        }

    settings = (
        db.query(models.StatisticsSetting)
        .filter(models.StatisticsSetting.user_id.in_(user_id))
        .all()
    )
    # Collect per-user excluded category ids then normalize across users by full_code,
    # so excluding a category for one member excludes the same logical category for others.
    raw_excluded_ids: set[int] = set()
    for s in settings:
        if s and s.excluded_category_ids:
            raw_excluded_ids.update(int(cid) for cid in s.excluded_category_ids)

    # Build category lookup for all selected users
    all_categories = db.query(models.Category).all()
    categories_by_id: dict[int, models.Category] = {c.id: c for c in all_categories}

    # Map raw excluded ids -> full_code set
    excluded_full_codes: set[str] = set()
    for cid in raw_excluded_ids:
        cat = categories_by_id.get(cid)
        if cat and cat.full_code:
            excluded_full_codes.add(cat.full_code)

    # Expand to final excluded ids for all users sharing full_code
    excluded_category_ids: set[int] = {
        c.id for c in all_categories if c.full_code in excluded_full_codes
    }

    def _should_skip(txn: models.Transaction, *, include_transfers_flag: bool, include_settlements_flag: bool, excluded_categories: set[int]) -> bool:
        if txn.exclude_from_reports or txn.is_balance_neutral:
            return True
        if txn.type == models.TxnType.SETTLEMENT and not include_settlements_flag:
            return True
        if txn.category_id is not None and int(txn.category_id) in excluded_categories:
            return True
        if not include_transfers_flag:
            if txn.type == models.TxnType.TRANSFER:
                return True
            if txn.group_id is not None and int(txn.group_id) in transfer_group_ids:
                return True
        return False

    filtered_transactions: list[models.Transaction] = [
        txn
        for txn in transactions_all
        if not _should_skip(txn, include_transfers_flag=include_transfers, include_settlements_flag=include_settlements, excluded_categories=excluded_category_ids)
    ]
    timeline_transactions = filtered_transactions

    categories = {cat.id: cat for cat in db.query(models.Category).all()}
    groups = {grp.id: grp for grp in db.query(models.CategoryGroup).all()}
    account_records = db.query(models.Account).filter(models.Account.user_id.in_(user_id)).all()
    accounts = {acc.id: acc for acc in account_records if not acc.is_archived}
    account_lookup = {acc.id: acc for acc in account_records}

    recurring_rules = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.user_id.in_(user_id))
        .all()
    )

    monthly_flow = _build_monthly_flow(filtered_transactions)
    category_share = _build_category_share(filtered_transactions, categories, groups)
    kpis = _build_kpis(filtered_transactions, category_share)
    account_timeline = _build_account_timeline(timeline_transactions, accounts)
    insights = _build_insights(kpis, monthly_flow)
    advanced = _build_advanced_metrics(filtered_transactions, accounts, kpis, category_share, account_timeline, start, end)
    category_trends = _build_category_trends(filtered_transactions, categories, groups)
    category_momentum = _build_category_momentum(category_trends)
    weekly_heatmap = _build_weekly_heatmap(filtered_transactions)
    expense_anomalies = _detect_expense_anomalies(filtered_transactions, account_lookup, categories, groups)
    income_alerts, recurring_coverage = _analyze_recurring_rules(
        recurring_rules,
        transactions_all,
        account_lookup,
        categories,
        groups,
        start,
        end,
    )
    forecast = _build_forecast(monthly_flow)

    filters = AnalyticsFiltersOut(
        start=start,
        end=end,
        account_id=account_id,
        include_transfers=include_transfers,
        include_settlements=include_settlements,
        excluded_category_ids=sorted(excluded_category_ids),
    )

    account_refs = [
        AnalyticsAccountRef(id=acc.id, name=acc.name, currency=acc.currency)
        for acc in sorted(accounts.values(), key=lambda a: a.name)
    ]

    return AnalyticsOverviewOut(
        filters=filters,
        kpis=kpis,
        monthly_flow=monthly_flow,
        category_share=category_share,
        account_timeline=account_timeline,
        insights=insights,
        accounts=account_refs,
        advanced=advanced,
        category_trends=category_trends,
        category_momentum=category_momentum,
        weekly_heatmap=weekly_heatmap,
        expense_anomalies=expense_anomalies,
        income_alerts=income_alerts,
        recurring_coverage=recurring_coverage,
        forecast=forecast,
    )
    
@router.get("/analytics/filter-options", response_model=AnalyticsFilterOptionsOut)
def analytics_filter_options(
    user_id: list[int] = Query(...),
    db: Session = Depends(get_db),
):
    cats = db.query(models.Category).all()
    groups = db.query(models.CategoryGroup).all()
    group_by_key: dict[tuple[str, int], AnalyticsUnifiedCategoryGroup] = {}
    for g in groups:
        if g.type not in ("I", "E"):
            continue
        key = (g.type, int(g.code_gg))
        entry = group_by_key.get(key)
        if not entry:
            entry = AnalyticsUnifiedCategoryGroup(
                type=g.type,
                code_gg=int(g.code_gg),
                label=f"{g.type}{int(g.code_gg):02d} {g.name}",
                group_ids_by_user={},
                names_by_user={},
            )
            group_by_key[key] = entry
    # For global groups, user mapping is not applicable; keep empty maps.

    cats_by_code: dict[str, AnalyticsUnifiedCategory] = {}
    for c in cats:
        if not c.full_code:
            continue
        t = c.full_code[0]
        if t not in ("I", "E"):
            continue
        entry = cats_by_code.get(c.full_code)
        if not entry:
            entry = AnalyticsUnifiedCategory(
                full_code=c.full_code,
                type=t,
                label=f"{c.full_code} {c.name}",
                category_ids_by_user={},
                names_by_user={},
            )
            cats_by_code[c.full_code] = entry
    # For global categories, user mapping is not applicable; keep empty maps.

    unified_groups = sorted(group_by_key.values(), key=lambda x: (x.type, x.code_gg))
    unified_categories = sorted(cats_by_code.values(), key=lambda x: x.full_code)
    return AnalyticsFilterOptionsOut(
        users=sorted(set(user_id)),
        category_groups=unified_groups,
        categories=unified_categories,
    )


# ===== Budget summary =====
@router.get("/budgets/{budget_id}/summary", response_model=BudgetSummaryOut)
def get_budget_summary(budget_id: int, db: Session = Depends(get_db)):
    bd = db.query(models.Budget).filter(models.Budget.id == budget_id).first()
    if not bd:
        raise HTTPException(status_code=404, detail="Budget not found")
    # 집계: 기본은 지출 중심(EXPENSE) 합계를 절대값으로 계산
    q = db.query(models.Transaction).filter(
        models.Transaction.user_id == bd.user_id,
        models.Transaction.occurred_at >= bd.period_start,
        models.Transaction.occurred_at <= bd.period_end,
        models.Transaction.type == models.TxnType.EXPENSE,
    )
    if bd.category_id is not None:
        q = q.filter(models.Transaction.category_id == bd.category_id)
    if bd.account_id is not None:
        q = q.filter(models.Transaction.account_id == bd.account_id)
    spent = sum(abs(float(t.amount)) for t in q.all())
    planned = float(bd.amount)
    remaining = planned - spent
    execution = (spent / planned) * 100 if planned else 0.0
    return BudgetSummaryOut(
        budget_id=bd.id,
        period_start=bd.period_start,
        period_end=bd.period_end,
        planned=planned,
        spent=spent,
        remaining=remaining,
        execution_rate=execution,
    )
