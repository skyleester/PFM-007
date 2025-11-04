from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy.orm import Session, selectinload
from pydantic import ValidationError

from app import models
from app.account_v2_metadata_schemas import get_metadata_model


class AccountV2Service:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_all(self, *, user_id: int, is_active: Optional[bool] = None, eager: bool = False) -> list[models.AccountV2]:
        q = self.db.query(models.AccountV2).filter(models.AccountV2.user_id == user_id)
        if is_active is not None:
            q = q.filter(models.AccountV2.is_active == bool(is_active))
        if eager:
            q = q.options(selectinload(models.AccountV2.parent), selectinload(models.AccountV2.children))
        return q.order_by(models.AccountV2.id).all()

    def get_by_id(self, user_id: int, account_id: int, *, eager: bool = False) -> models.AccountV2 | None:
        q = (
            self.db.query(models.AccountV2)
            .filter(models.AccountV2.user_id == user_id, models.AccountV2.id == account_id)
        )
        if eager:
            q = q.options(selectinload(models.AccountV2.parent), selectinload(models.AccountV2.children))
        return q.first()

    def create(self, payload: dict, *, user_id: int) -> models.AccountV2:
        # Defensive: prevent self-parenting on creation
        parent_id = payload.get("parent_id")
        if parent_id is not None and payload.get("id") == parent_id:
            payload["parent_id"] = None
        payload["user_id"] = user_id
        row = models.AccountV2(**payload)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def update(self, row: models.AccountV2, patch: dict) -> models.AccountV2:
        if not patch:
            return row
        # Avoid parent=self
        if "parent_id" in patch and patch["parent_id"] == row.id:
            patch["parent_id"] = None
        for key, value in patch.items():
            setattr(row, key, value)
        self.db.commit()
        self.db.refresh(row)
        return row

    def delete(self, row: models.AccountV2) -> None:
        # Re-parent children to None on delete to keep hierarchy consistent
        self.db.query(models.AccountV2).filter(models.AccountV2.parent_id == row.id).update(
            {models.AccountV2.parent_id: None}, synchronize_session=False
        )
        self.db.delete(row)
        self.db.commit()

    # ---- Helpers ---------------------------------------------------------
    def validate_metadata(self, kind: models.AccountKind, metadata: dict) -> dict:
        """Validate and normalize metadata for the given account kind.

        Returns a normalized dict; raises ValidationError on failure.
        """
        Model = get_metadata_model(kind)
        obj = Model.model_validate(metadata or {})
        return obj.model_dump()

    def init_default_accounts(self, *, user_id: int) -> list[models.AccountV2]:
        """Create a minimal default set of accounts if not present.

        Idempotent by name; returns the resulting rows (created or existing).
        """
        created: list[models.AccountV2] = []

        def _get_or_create(name: str, kind: models.AccountKind, **kwargs) -> models.AccountV2:
            row = (
                self.db.query(models.AccountV2)
                .filter(models.AccountV2.user_id == user_id, models.AccountV2.name == name)
                .first()
            )
            if row:
                return row
            row = models.AccountV2(user_id=user_id, name=name, type=kind, **kwargs)
            self.db.add(row)
            self.db.flush()
            created.append(row)
            return row

        cash = _get_or_create("기본 현금", models.AccountKind.CASH, currency="KRW", is_active=True)
        bank = _get_or_create("기본 입출금", models.AccountKind.BANK, currency="KRW", is_active=True)
        card = _get_or_create("기본 신용카드", models.AccountKind.CARD, currency="KRW", is_active=True)
        _ = _get_or_create(
            "기본 카드 포인트",
            models.AccountKind.POINT,
            currency="KRW",
            is_active=True,
            parent_id=card.id,
        )

        self.db.commit()
        # Return all defaults (including pre-existing) in deterministic order
        names = ["기본 현금", "기본 입출금", "기본 신용카드", "기본 카드 포인트"]
        rows = (
            self.db.query(models.AccountV2)
            .filter(models.AccountV2.user_id == user_id, models.AccountV2.name.in_(names))
            .order_by(models.AccountV2.id)
            .all()
        )
        return rows
    def build_tree(self, rows: Iterable[models.AccountV2]) -> list[models.AccountV2]:
        """Return a forest (list of roots) with children populated in-memory.

        Note: rows should preferably be loaded with children for fewer queries,
        but this method works with plain rows as well.
        """
        by_id = {r.id: r for r in rows}
        # Clear any pre-loaded children to rebuild deterministic tree
        for r in by_id.values():
            # type: ignore[attr-defined]
            r.children = []  # reset in-memory
        roots: list[models.AccountV2] = []
        for r in by_id.values():
            if r.parent_id and r.parent_id in by_id and r.parent_id != r.id:
                parent = by_id[r.parent_id]
                parent.children.append(r)
            else:
                roots.append(r)
        return sorted(roots, key=lambda x: x.id)
