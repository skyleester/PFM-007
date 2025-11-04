"""Account-related handlers extracted from the legacy monolithic router."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import models
from app.core.database import get_db
from app.schemas import (
    AccountCreate,
    AccountMergeRequest,
    AccountMergeResult,
    AccountOut,
    AccountUpdate,
    CreditCardAccountSummary,
    CreditCardStatementOut,
)
from app.services import TransactionBalanceService
from app.routers import (  # type: ignore  # circular dependency workaround
    _recalculate_statement_total,
    _sync_check_card_auto_deduct,
)


def create_account(payload: AccountCreate, db: Session = Depends(get_db)) -> models.Account:
    exists = (
        db.query(models.Account)
        .filter(models.Account.user_id == payload.user_id, models.Account.name == payload.name)
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail="Account with same name already exists for user")

    linked_id = payload.linked_account_id
    currency = payload.currency
    metadata = dict(payload.extra_metadata or {})
    auto_deduct = bool(payload.auto_deduct)
    initial_balance = float(payload.current_balance or 0)

    if payload.type == models.AccountType.CHECK_CARD:
        if linked_id:
            linked = db.query(models.Account).filter(models.Account.id == linked_id).first()
            if not linked or linked.user_id != payload.user_id:
                raise HTTPException(status_code=400, detail="Linked account must belong to the same user")
            if linked.type != models.AccountType.DEPOSIT:
                raise HTTPException(status_code=400, detail="Linked account must be a DEPOSIT account")
            if currency and linked.currency and currency != linked.currency:
                raise HTTPException(status_code=400, detail="CHECK_CARD currency must match linked DEPOSIT currency")
            if not currency and linked.currency:
                currency = linked.currency
        else:
            auto_deduct = False
        if auto_deduct and not linked_id:
            raise HTTPException(status_code=400, detail="auto_deduct requires a linked deposit account")
        metadata["auto_deduct"] = auto_deduct
        metadata.pop("billing_cutoff_day", None)
        metadata.pop("payment_day", None)
        initial_balance = 0.0
    elif payload.type == models.AccountType.CREDIT_CARD:
        if not linked_id:
            raise HTTPException(status_code=400, detail="Credit card requires a linked deposit account")
        linked = db.query(models.Account).filter(models.Account.id == linked_id).first()
        if not linked or linked.user_id != payload.user_id:
            raise HTTPException(status_code=400, detail="Linked account must belong to the same user")
        if linked.type != models.AccountType.DEPOSIT:
            raise HTTPException(status_code=400, detail="Linked account must be a DEPOSIT account")
        desired_currency = currency or linked.currency
        if desired_currency and linked.currency and desired_currency != linked.currency:
            raise HTTPException(status_code=400, detail="CREDIT_CARD currency must match linked DEPOSIT currency")
        currency = desired_currency
        terms = payload.credit_card_terms
        if terms is None:
            raise HTTPException(status_code=400, detail="credit_card_terms is required for credit card accounts")
        metadata.setdefault("billing_cutoff_day", terms.billing_cutoff_day)
        metadata.setdefault("payment_day", terms.payment_day)
        metadata["auto_deduct"] = False
        initial_balance = 0.0
    else:
        if linked_id is not None:
            raise HTTPException(status_code=400, detail="linked_account_id is only allowed for card accounts")
        if auto_deduct:
            raise HTTPException(status_code=400, detail="auto_deduct is only available for CHECK_CARD accounts")
        linked_id = None
        metadata.pop("auto_deduct", None)
        metadata.pop("billing_cutoff_day", None)
        metadata.pop("payment_day", None)

    account = models.Account(
        user_id=payload.user_id,
        name=payload.name,
        type=payload.type,
        category=payload.category,
        institution=payload.institution,
        current_balance=initial_balance,
        available_balance=payload.available_balance,
        credit_limit=payload.credit_limit,
        currency=currency,
        linked_account_id=linked_id,
        opened_at=payload.opened_at,
        closed_at=payload.closed_at,
        memo=payload.memo,
        extra_metadata=metadata,
    )
    if payload.type == models.AccountType.CREDIT_CARD:
        account.ensure_credit_metadata()
    if "auto_deduct" in metadata:
        account.auto_deduct = bool(metadata.get("auto_deduct", False))

    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def list_accounts(user_id: list[int] = Query(...), db: Session = Depends(get_db)) -> list[models.Account]:
    rows = (
        db.query(models.Account)
        .filter(models.Account.user_id.in_(user_id))
        .order_by(models.Account.id)
        .all()
    )
    return rows


def _resync_check_card_auto_deduct_for_account(
    db: Session,
    account: models.Account,
    *,
    force_remove: bool = False,
) -> None:
    txns = (
        db.query(models.Transaction)
        .filter(models.Transaction.account_id == account.id)
        .all()
    )
    for tx in txns:
        _sync_check_card_auto_deduct(db, tx, account=account, remove=force_remove)


def update_account(account_id: int, payload: AccountUpdate, db: Session = Depends(get_db)) -> models.Account:
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    old_type = acc.type
    old_auto_deduct = acc.auto_deduct
    old_linked_id = acc.linked_account_id
    if payload.name and payload.name != acc.name:
        dup = (
            db.query(models.Account)
            .filter(models.Account.user_id == acc.user_id, models.Account.name == payload.name, models.Account.id != account_id)
            .first()
        )
        if dup:
            raise HTTPException(status_code=409, detail="Account with same name already exists for user")
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return acc
    credit_card_terms = updates.pop("credit_card_terms", None)
    requested_auto = updates.pop("auto_deduct", None)
    requested_balance = updates.pop("current_balance", None)
    requested_billing = updates.pop("billing_cutoff_day", None)
    requested_payment = updates.pop("payment_day", None)
    extra_metadata_patch = updates.pop("extra_metadata", None)

    new_type = updates.get("type", acc.type)
    new_linked_id = updates.get("linked_account_id", acc.linked_account_id)
    new_auto_deduct = acc.auto_deduct if requested_auto is None else bool(requested_auto)
    force_zero_balance = False

    if acc.type == models.AccountType.CREDIT_CARD and new_type != models.AccountType.CREDIT_CARD:
        has_statements = (
            db.query(models.CreditCardStatement)
            .filter(models.CreditCardStatement.account_id == acc.id)
            .count()
        )
        if has_statements:
            raise HTTPException(status_code=400, detail="Cannot change type of a credit card account with statements")

    if acc.type == models.AccountType.DEPOSIT and new_type != models.AccountType.DEPOSIT:
        linked_cards = (
            db.query(models.Account)
            .filter(
                models.Account.linked_account_id == acc.id,
                models.Account.type == models.AccountType.CHECK_CARD,
                models.Account.user_id == acc.user_id,
            )
            .count()
        )
        if linked_cards:
            raise HTTPException(status_code=400, detail="Cannot change type of a deposit linked to CHECK_CARD accounts")

    if new_type == models.AccountType.CHECK_CARD:
        if new_linked_id:
            if new_linked_id == acc.id:
                raise HTTPException(status_code=400, detail="Account cannot link to itself")
            linked = db.query(models.Account).filter(models.Account.id == new_linked_id).first()
            if not linked or linked.user_id != acc.user_id:
                raise HTTPException(status_code=400, detail="Linked account must belong to the same user")
            if linked.type != models.AccountType.DEPOSIT:
                raise HTTPException(status_code=400, detail="Linked account must be a DEPOSIT account")
            desired_currency = updates.get("currency", acc.currency)
            if desired_currency and linked.currency and desired_currency != linked.currency:
                raise HTTPException(status_code=400, detail="CHECK_CARD currency must match linked DEPOSIT currency")
            if not desired_currency and linked.currency:
                updates["currency"] = linked.currency
        else:
            new_linked_id = None
            new_auto_deduct = False
        if new_auto_deduct and not new_linked_id:
            raise HTTPException(status_code=400, detail="auto_deduct requires a linked deposit account")
        acc.billing_cutoff_day = None
        acc.payment_day = None
        force_zero_balance = True
        requested_balance = None
        updates["linked_account_id"] = new_linked_id
    elif new_type == models.AccountType.CREDIT_CARD:
        if new_linked_id is None:
            new_linked_id = acc.linked_account_id
        if not new_linked_id:
            raise HTTPException(status_code=400, detail="Credit card requires a linked deposit account")
        if new_linked_id == acc.id:
            raise HTTPException(status_code=400, detail="Account cannot link to itself")
        linked = db.query(models.Account).filter(models.Account.id == new_linked_id).first()
        if not linked or linked.user_id != acc.user_id:
            raise HTTPException(status_code=400, detail="Linked account must belong to the same user")
        if linked.type != models.AccountType.DEPOSIT:
            raise HTTPException(status_code=400, detail="Linked account must be a DEPOSIT account")
        if new_auto_deduct:
            raise HTTPException(status_code=400, detail="auto_deduct is not available for credit card accounts")
        desired_currency = updates.get("currency", acc.currency or linked.currency)
        if desired_currency and linked.currency and desired_currency != linked.currency:
            raise HTTPException(status_code=400, detail="CREDIT_CARD currency must match linked DEPOSIT currency")
        updates["currency"] = desired_currency or linked.currency
        updates["linked_account_id"] = new_linked_id
        new_auto_deduct = False
        billing_day = requested_billing
        payment_day = requested_payment
        if credit_card_terms is not None:
            billing_day = credit_card_terms.billing_cutoff_day
            payment_day = credit_card_terms.payment_day
        if billing_day is not None:
            acc.billing_cutoff_day = billing_day
        if payment_day is not None:
            acc.payment_day = payment_day
        if acc.billing_cutoff_day is None or acc.payment_day is None:
            raise HTTPException(status_code=400, detail="billing_cutoff_day and payment_day are required for credit card accounts")
        force_zero_balance = True
        requested_balance = None
    else:
        if new_linked_id is not None:
            raise HTTPException(status_code=400, detail="linked_account_id is only allowed for card accounts")
        if new_auto_deduct:
            raise HTTPException(status_code=400, detail="auto_deduct is only available for CHECK_CARD accounts")
        if requested_billing is not None or requested_payment is not None or credit_card_terms is not None:
            raise HTTPException(status_code=400, detail="billing/payment days are only valid for credit card accounts")
        updates["linked_account_id"] = None
        acc.billing_cutoff_day = None
        acc.payment_day = None
        new_auto_deduct = False

    if extra_metadata_patch:
        merged = dict(acc.extra_metadata or {})
        merged.update(extra_metadata_patch)
        acc.extra_metadata = merged

    acc.auto_deduct = new_auto_deduct

    for key, value in updates.items():
        setattr(acc, key, value)

    if force_zero_balance:
        acc.balance = 0.0
    elif requested_balance is not None:
        target_balance = float(requested_balance)
        delta = target_balance - float(acc.current_balance or 0)
        if delta != 0:
            TransactionBalanceService(db).apply_signed_delta(acc.id, delta)

    if (
        old_type == models.AccountType.DEPOSIT
        and acc.type == models.AccountType.DEPOSIT
        and "currency" in updates
    ):
        linked_cards = (
            db.query(models.Account)
            .filter(
                models.Account.linked_account_id == acc.id,
                models.Account.type == models.AccountType.CHECK_CARD,
                models.Account.user_id == acc.user_id,
            )
            .all()
        )
        for card in linked_cards:
            card.currency = acc.currency
            card.balance = 0.0

    db.flush()

    if old_type == models.AccountType.CHECK_CARD and acc.type != models.AccountType.CHECK_CARD:
        _resync_check_card_auto_deduct_for_account(db, acc, force_remove=True)
    elif acc.type == models.AccountType.CHECK_CARD:
        if (
            old_type != models.AccountType.CHECK_CARD
            or old_linked_id != acc.linked_account_id
            or old_auto_deduct != acc.auto_deduct
        ):
            _resync_check_card_auto_deduct_for_account(db, acc)

    db.commit()
    db.refresh(acc)
    return acc


def delete_account(account_id: int, db: Session = Depends(get_db)) -> None:
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    if acc.type == models.AccountType.DEPOSIT:
        linked_check_cards = (
            db.query(models.Account)
            .filter(
                models.Account.linked_account_id == acc.id,
                models.Account.type == models.AccountType.CHECK_CARD,
                models.Account.user_id == acc.user_id,
            )
            .count()
        )
        if linked_check_cards:
            raise HTTPException(status_code=400, detail="Cannot delete a deposit account linked to CHECK_CARD accounts")

        linked_credit_cards = (
            db.query(models.Account)
            .filter(
                models.Account.linked_account_id == acc.id,
                models.Account.type == models.AccountType.CREDIT_CARD,
                models.Account.user_id == acc.user_id,
            )
            .count()
        )
        if linked_credit_cards:
            raise HTTPException(status_code=400, detail="Cannot delete a deposit account linked to CREDIT_CARD accounts")

    if acc.type == models.AccountType.CREDIT_CARD:
        db.query(models.CreditCardStatement).filter(
            models.CreditCardStatement.account_id == acc.id
        ).delete(synchronize_session=False)

    db.delete(acc)
    db.commit()
    return None


def merge_account(
    account_id: int,
    payload: AccountMergeRequest,
    db: Session = Depends(get_db),
) -> AccountMergeResult:
    if account_id == payload.target_account_id:
        raise HTTPException(status_code=400, detail="Source and target accounts must differ")

    source = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source account not found")

    target = db.query(models.Account).filter(models.Account.id == payload.target_account_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target account not found")

    if source.user_id != target.user_id:
        raise HTTPException(status_code=400, detail="Accounts must belong to the same user")

    source_linked_cards = []
    if source.type == models.AccountType.DEPOSIT:
        source_linked_cards = (
            db.query(models.Account)
            .filter(
                models.Account.linked_account_id == source.id,
                models.Account.type == models.AccountType.CHECK_CARD,
                models.Account.user_id == source.user_id,
            )
            .all()
        )
        if source_linked_cards and target.type != models.AccountType.DEPOSIT:
            raise HTTPException(status_code=400, detail="Target account must be DEPOSIT to receive linked CHECK_CARD references")

    moved_tx = (
        db.query(models.Transaction)
        .filter(models.Transaction.account_id == source.id)
        .update({models.Transaction.account_id: target.id}, synchronize_session=False)
    )
    counter_links = (
        db.query(models.Transaction)
        .filter(models.Transaction.counter_account_id == source.id)
        .update({models.Transaction.counter_account_id: target.id}, synchronize_session=False)
    )
    recurring_main = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.account_id == source.id)
        .update({models.RecurringRule.account_id: target.id}, synchronize_session=False)
    )
    recurring_counter = (
        db.query(models.RecurringRule)
        .filter(models.RecurringRule.counter_account_id == source.id)
        .update({models.RecurringRule.counter_account_id: target.id}, synchronize_session=False)
    )
    budgets = (
        db.query(models.Budget)
        .filter(models.Budget.account_id == source.id)
        .update({models.Budget.account_id: target.id}, synchronize_session=False)
    )

    if payload.combine_balances:
        target.balance = float(target.balance or 0) + float(source.balance or 0)
        source.balance = 0.0

    if payload.archive_source:
        source.is_archived = True

    if source_linked_cards:
        for card in source_linked_cards:
            card.linked_account_id = target.id

    db.commit()
    db.refresh(target)

    from ...schemas import AccountMergeResult as AccountMergeResultSchema, AccountOut as AccountOutSchema

    return AccountMergeResultSchema(
        source_id=source.id,
        target=AccountOutSchema.model_validate(target),
        transactions_moved=moved_tx,
        counter_links_updated=counter_links,
        recurring_updated=recurring_main,
        recurring_counter_updated=recurring_counter,
        budgets_updated=budgets,
    )


def list_credit_card_statements(
    account_id: int,
    user_id: int = Query(..., ge=1),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
) -> list[models.CreditCardStatement]:
    account = (
        db.query(models.Account)
        .filter(models.Account.id == account_id, models.Account.user_id == user_id)
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.type != models.AccountType.CREDIT_CARD:
        raise HTTPException(status_code=400, detail="Account is not a credit card")

    q = (
        db.query(models.CreditCardStatement)
        .filter(models.CreditCardStatement.account_id == account_id)
        .order_by(models.CreditCardStatement.period_start.desc())
    )
    if status:
        try:
            status_enum = models.CreditCardStatementStatus(status)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid statement status")
        q = q.filter(models.CreditCardStatement.status == status_enum)

    statements = q.all()
    for stmt in statements:
        if stmt.status != models.CreditCardStatementStatus.PAID:
            _recalculate_statement_total(db, stmt)
    db.flush()
    return statements


def get_credit_card_summary(
    account_id: int,
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
) -> CreditCardAccountSummary:
    account = (
        db.query(models.Account)
        .filter(models.Account.id == account_id, models.Account.user_id == user_id)
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.type != models.AccountType.CREDIT_CARD:
        raise HTTPException(status_code=400, detail="Account is not a credit card")

    statements = (
        db.query(models.CreditCardStatement)
        .filter(models.CreditCardStatement.account_id == account_id)
        .order_by(models.CreditCardStatement.period_start.desc())
        .all()
    )
    active_stmt: models.CreditCardStatement | None = None
    last_paid: models.CreditCardStatement | None = None
    outstanding = 0.0
    for stmt in statements:
        if stmt.status != models.CreditCardStatementStatus.PAID:
            _recalculate_statement_total(db, stmt)
            outstanding += float(stmt.total_amount or 0)
            if not active_stmt or stmt.period_end > active_stmt.period_end:
                active_stmt = stmt
        elif not last_paid or stmt.period_end > last_paid.period_end:
            last_paid = stmt
    db.flush()

    linked_currency = None
    if account.linked_account_id:
        linked_currency = (
            db.query(models.Account.currency)
            .filter(models.Account.id == account.linked_account_id)
            .scalar()
        )

    summary = CreditCardAccountSummary(
        account_id=account.id,
        user_id=account.user_id,
        currency=account.currency or linked_currency,
        outstanding_amount=outstanding,
        next_due_date=active_stmt.due_date if active_stmt else None,
        active_statement=CreditCardStatementOut.model_validate(active_stmt) if active_stmt else None,
        last_paid_statement=CreditCardStatementOut.model_validate(last_paid) if last_paid else None,
    )
    return summary
