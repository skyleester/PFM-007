"""Transactions router extracted in modularization Phase 2.

This module exposes the existing transaction endpoints while delegating their
implementations to the legacy handlers in ``app.routers``. Subsequent phases
will move the underlying logic here before the old module is retired.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy.orm import Session

from app.core.database import get_db
from app import models

from app import routers as legacy_routers
from app.schemas import (
    ParsedTransactionIn,
    TransactionImportResult,
    DbMatchConfirmResult,
    TransactionOut,
    TransactionsBulkDeleteResult,
    TransactionsBulkMoveResult,
    TransactionsBulkOut,
    TransactionsBulkUpdateResponse,
)

router = APIRouter(prefix="/transactions", tags=["transactions"])

router.add_api_route(
    "",
    legacy_routers.list_transactions,
    methods=["GET"],
    response_model=list[TransactionOut],
)

router.add_api_route(
    "",
    legacy_routers.create_transaction,
    methods=["POST"],
    response_model=TransactionOut,
    status_code=201,
)

router.add_api_route(
    "/{txn_id}",
    legacy_routers.update_transaction,
    methods=["PATCH"],
    response_model=TransactionOut,
)

router.add_api_route(
    "/{txn_id}",
    legacy_routers.delete_transaction,
    methods=["DELETE"],
    status_code=204,
)

router.add_api_route(
    "/bulk",
    legacy_routers.bulk_upsert_transactions,
    methods=["POST"],
    response_model=TransactionsBulkOut,
)

router.add_api_route(
    "/bulk-confirm-matches",
    legacy_routers.bulk_confirm_db_matches,
    methods=["POST"],
    response_model=DbMatchConfirmResult,
)

router.add_api_route(
    "/bulk-delete",
    legacy_routers.bulk_delete_transactions,
    methods=["POST"],
    response_model=TransactionsBulkDeleteResult,
)

router.add_api_route(
    "/bulk-move-account",
    legacy_routers.bulk_move_transactions_between_accounts,
    methods=["POST"],
    response_model=TransactionsBulkMoveResult,
)

router.add_api_route(
    "/bulk-update",
    legacy_routers.bulk_update_transactions,
    methods=["POST"],
    response_model=TransactionsBulkUpdateResponse,
)


@router.post("/bulk-upload", response_model=TransactionImportResult)
def bulk_upload_transactions(
    items: list[dict] = Body(...),
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    """Ingest a simple list of parsed transactions and persist them.

    - Validates required fields
    - Deduplicates against existing DB by (date, amount-with-sign, description->memo)
    - Uses existing create_transaction for business rules (account/category resolution)
    """
    total = len(items or [])
    success = 0
    failed = 0
    duplicates = 0
    errors: list[dict] = []

    if not items:
        return TransactionImportResult(total_count=0, success_count=0, failed_count=0, duplicates=0, errors=[])

    from app.schemas import TransactionCreate, TxnType  # local import to avoid cycles
    from pydantic import ValidationError
    from app.routers import create_transaction, get_or_create_account_by_name

    for idx, raw in enumerate(items):
        # Parse each item individually to allow partial failures without 422
        try:
            it = ParsedTransactionIn.model_validate(raw)
        except ValidationError as ve:
            failed += 1
            errors.append({"row": idx + 1, "reason": ve.errors()[0].get("msg", "validation error")})
            continue

        # Basic validation per spec
        try:
            if it.date is None:
                raise ValueError("Missing date")
            if it.type not in (TxnType.INCOME, TxnType.EXPENSE, TxnType.TRANSFER):
                raise ValueError("Invalid type")
            if it.type in (TxnType.INCOME, TxnType.EXPENSE):
                if not ((it.category_main and it.category_sub)):
                    raise ValueError("Category (main/sub) required for income/expense")
            if not it.account_name or not it.account_name.strip():
                raise ValueError("account_name required")
        except Exception as exc:
            failed += 1
            errors.append({"row": idx + 1, "reason": str(exc)})
            continue

        # Prepare fields
        dt = it.date
        occurred_at = dt.date()
        occurred_time = dt.time()
        # Sign amount by type
        base_amount = abs(float(it.amount))
        if it.type == TxnType.EXPENSE:
            signed_amount = -base_amount
        elif it.type == TxnType.INCOME:
            signed_amount = base_amount
        else:
            signed_amount = base_amount  # TRANSFER magnitude; create_transaction handles sides

        memo = it.description or it.memo

        # Duplicate check: date + amount + description (mapped to memo)
        existing = (
            db.query(models.Transaction.id)
            .filter(
                models.Transaction.user_id == user_id,
                models.Transaction.occurred_at == occurred_at,
                models.Transaction.amount == signed_amount,
                models.Transaction.memo == memo,
            )
            .first()
        )
        if existing:
            duplicates += 1
            continue

        # Construct TransactionCreate payload
        payload = TransactionCreate(
            user_id=user_id,
            occurred_at=occurred_at,
            occurred_time=occurred_time,
            type=it.type,
            amount=signed_amount,
            currency=(it.currency or "KRW").upper(),
            account_name=it.account_name,
            category_group_name=it.category_main,
            category_name=it.category_sub,
            memo=memo,
        )

        try:
            # Ensure account exists early for clearer errors
            get_or_create_account_by_name(db, user_id, it.account_name)
            _created = create_transaction(payload, db)
            # No need to add explicit commit; create_transaction handles commit
            success += 1
        except HTTPException as http_exc:
            failed += 1
            errors.append({"row": idx + 1, "reason": http_exc.detail})
        except Exception as exc:  # unexpected server error
            failed += 1
            errors.append({"row": idx + 1, "reason": "Server error: " + str(exc)})

    return TransactionImportResult(
        total_count=total,
        success_count=success,
        failed_count=failed,
        duplicates=duplicates,
        errors=errors,
    )
