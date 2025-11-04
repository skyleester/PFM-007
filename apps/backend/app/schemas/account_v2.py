from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models import AccountKind


class AccountV2Base(BaseModel):
    name: str
    type: AccountKind
    provider: Optional[str] = None
    balance: Optional[Decimal] = None
    currency: str = "KRW"
    parent_id: Optional[int] = None
    is_active: bool = True
    extra_metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(
        json_encoders={Decimal: lambda v: str(v)},
    )


class AccountV2Create(AccountV2Base):
    pass


class AccountV2Update(BaseModel):
    name: Optional[str] = None
    type: Optional[AccountKind] = None
    provider: Optional[str] = None
    balance: Optional[Decimal] = None
    currency: Optional[str] = None
    parent_id: Optional[int | None] = None
    is_active: Optional[bool] = None
    extra_metadata: Optional[dict[str, Any]] = None

    model_config = ConfigDict(
        json_encoders={Decimal: lambda v: str(v)},
    )


class AccountV2Out(AccountV2Base):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True, json_encoders={Decimal: lambda v: str(v)})


class AccountV2TreeNode(AccountV2Out):
    children: list["AccountV2TreeNode"] = Field(default_factory=list)
