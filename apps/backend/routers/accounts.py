"""Accounts router exposing the Phase 4 account handlers."""

from fastapi import APIRouter

from app.api.accounts import handlers
from app.schemas import (
    AccountMergeResult,
    AccountOut,
    CreditCardAccountSummary,
    CreditCardStatementOut,
)

router = APIRouter(prefix="/accounts", tags=["accounts"])

router.add_api_route(
    "",
    handlers.create_account,
    methods=["POST"],
    response_model=AccountOut,
    status_code=201,
)

router.add_api_route(
    "",
    handlers.list_accounts,
    methods=["GET"],
    response_model=list[AccountOut],
)

router.add_api_route(
    "/{account_id}",
    handlers.update_account,
    methods=["PATCH"],
    response_model=AccountOut,
)

router.add_api_route(
    "/{account_id}",
    handlers.delete_account,
    methods=["DELETE"],
    status_code=204,
)

router.add_api_route(
    "/{account_id}/merge",
    handlers.merge_account,
    methods=["POST"],
    response_model=AccountMergeResult,
)

router.add_api_route(
    "/{account_id}/credit-card-statements",
    handlers.list_credit_card_statements,
    methods=["GET"],
    response_model=list[CreditCardStatementOut],
)

router.add_api_route(
    "/{account_id}/credit-card-summary",
    handlers.get_credit_card_summary,
    methods=["GET"],
    response_model=CreditCardAccountSummary,
)
