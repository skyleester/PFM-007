from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app import models


class TransactionBalanceService:
    """Coordinate account balance adjustments for directional transactions."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def apply_balance(self, from_account_id: Optional[int], to_account_id: Optional[int], amount: float) -> None:
        """Apply the net balance movement for a transaction.

        The ``amount`` is treated as an absolute value. Funds move out of
        ``from_account_id`` and into ``to_account_id`` when provided.
        """
        magnitude = abs(float(amount or 0))
        if magnitude == 0:
            return
        if from_account_id and to_account_id and from_account_id == to_account_id:
            return
        if from_account_id:
            self._apply_delta(from_account_id, -magnitude)
        if to_account_id:
            self._apply_delta(to_account_id, magnitude)

    def revert_single_transfer_effect(
        self,
        from_account_id: Optional[int],
        to_account_id: Optional[int],
        amount: float,
    ) -> None:
        """Undo a previously applied directional transfer."""
        magnitude = abs(float(amount or 0))
        if magnitude == 0:
            return
        if from_account_id and to_account_id and from_account_id == to_account_id:
            return
        if from_account_id:
            self._apply_delta(from_account_id, magnitude)
        if to_account_id:
            self._apply_delta(to_account_id, -magnitude)

    def apply_signed_delta(self, account_id: Optional[int], delta: float) -> None:
        """Compatibility shim for legacy single-account balance updates."""
        if account_id is None:
            return
        signed = float(delta or 0)
        if signed == 0:
            return
        if signed > 0:
            self.apply_balance(None, account_id, signed)
        else:
            self.apply_balance(account_id, None, abs(signed))

    def apply_signed_transfer(
        self,
        source_account_id: Optional[int],
        counter_account_id: Optional[int],
        signed_amount: float,
    ) -> None:
        """Compatibility layer for legacy signed transfer amounts."""
        signed = float(signed_amount or 0)
        if signed == 0:
            return
        if signed < 0:
            self.apply_balance(source_account_id, counter_account_id, abs(signed))
        else:
            self.apply_balance(counter_account_id, source_account_id, abs(signed))

    def revert_signed_transfer(
        self,
        source_account_id: Optional[int],
        counter_account_id: Optional[int],
        signed_amount: float,
    ) -> None:
        signed = float(signed_amount or 0)
        if signed == 0:
            return
        if signed < 0:
            self.revert_single_transfer_effect(source_account_id, counter_account_id, abs(signed))
        else:
            self.revert_single_transfer_effect(counter_account_id, source_account_id, abs(signed))

    def _apply_delta(self, account_id: int, delta: float) -> None:
        account = (
            self.db.query(models.Account)
            .filter(models.Account.id == account_id)
            .first()
        )
        if not account:
            return
        if account.type in (models.AccountType.CREDIT_CARD, models.AccountType.CHECK_CARD):
            account.current_balance = 0.0
            return
        current = float(account.current_balance or 0)
        account.current_balance = current + float(delta)


def _apply_balance(
    db: Session,
    from_account_id: Optional[int],
    to_account_id: Optional[int],
    amount: float,
) -> None:
    TransactionBalanceService(db).apply_balance(from_account_id, to_account_id, amount)


def _revert_single_transfer_effect(
    db: Session,
    from_account_id: Optional[int],
    to_account_id: Optional[int],
    amount: float,
) -> None:
    TransactionBalanceService(db).revert_single_transfer_effect(from_account_id, to_account_id, amount)


def _apply_signed_balance(db: Session, account_id: Optional[int], delta: float) -> None:
    TransactionBalanceService(db).apply_signed_delta(account_id, delta)


def _apply_signed_transfer_effect(
    db: Session,
    account_id: Optional[int],
    counter_account_id: Optional[int],
    signed_amount: float,
) -> None:
    TransactionBalanceService(db).apply_signed_transfer(account_id, counter_account_id, signed_amount)


def _revert_signed_transfer_effect(
    db: Session,
    account_id: Optional[int],
    counter_account_id: Optional[int],
    signed_amount: float,
) -> None:
    TransactionBalanceService(db).revert_signed_transfer(account_id, counter_account_id, signed_amount)
