from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.schemas_v2 import (
    AccountV2Create,
    AccountV2Out,
    AccountV2Update,
    AccountV2TreeNode,
    AccountV2MetadataValidateIn,
    AccountV2MetadataValidateOut,
)
from app.services.account_v2_service import AccountV2Service
from app import models


router = APIRouter(prefix="/accounts", tags=["accounts-v2"])


@router.get("", response_model=list[AccountV2Out])
def list_accounts_v2(
    is_active: Optional[bool | str] = Query(None, description="Filter by active flag when provided"),
    eager: bool = Query(False, description="Eager-load parent/children relationships"),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    svc = AccountV2Service(db)
    flag: Optional[bool]
    if is_active is None:
        flag = None
    else:
        if isinstance(is_active, bool):
            flag = is_active
        else:
            flag = str(is_active).strip().lower() in {"1", "true", "yes", "y", "on"}
    return svc.get_all(user_id=current_user.id, is_active=flag, eager=eager)


@router.get("/tree", response_model=list[AccountV2TreeNode])
def accounts_v2_tree(
    is_active: Optional[bool | str] = Query(None),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    svc = AccountV2Service(db)
    flag: Optional[bool]
    if is_active is None:
        flag = None
    else:
        if isinstance(is_active, bool):
            flag = is_active
        else:
            flag = str(is_active).strip().lower() in {"1", "true", "yes", "y", "on"}
    rows = svc.get_all(user_id=current_user.id, is_active=flag, eager=False)
    forest = svc.build_tree(rows)
    return forest


@router.post("/init-default", response_model=list[AccountV2Out], status_code=201)
def init_default_accounts(db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    svc = AccountV2Service(db)
    return svc.init_default_accounts(user_id=current_user.id)


@router.post("/validate", response_model=AccountV2MetadataValidateOut)
def validate_metadata(payload: AccountV2MetadataValidateIn, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    svc = AccountV2Service(db)
    try:
        normalized = svc.validate_metadata(payload.type, payload.metadata)
    except Exception as exc:  # Pydantic ValidationError or others
        raise HTTPException(status_code=422, detail=str(exc))
    # Ensure JSON-serializable
    return AccountV2MetadataValidateOut(normalized=jsonable_encoder(normalized))


@router.get("/{account_id}", response_model=AccountV2Out)
def get_account_v2(account_id: int, eager: bool = Query(False), db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    svc = AccountV2Service(db)
    row = svc.get_by_id(current_user.id, account_id, eager=eager)
    if not row:
        raise HTTPException(status_code=404, detail="AccountV2 not found")
    return row


@router.post("", response_model=AccountV2Out, status_code=201)
def create_account_v2(payload: AccountV2Create, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    svc = AccountV2Service(db)
    return svc.create(payload.model_dump(), user_id=current_user.id)


@router.put("/{account_id}", response_model=AccountV2Out)
def put_account_v2(account_id: int, payload: AccountV2Create, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    svc = AccountV2Service(db)
    row = svc.get_by_id(current_user.id, account_id)
    if not row:
        raise HTTPException(status_code=404, detail="AccountV2 not found")
    # Full replacement semantics: set all fields from payload
    patch = payload.model_dump()
    return svc.update(row, patch)


@router.patch("/{account_id}", response_model=AccountV2Out)
def patch_account_v2(account_id: int, payload: AccountV2Update, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    svc = AccountV2Service(db)
    row = svc.get_by_id(current_user.id, account_id)
    if not row:
        raise HTTPException(status_code=404, detail="AccountV2 not found")
    patch = payload.model_dump(exclude_unset=True)
    return svc.update(row, patch)


@router.delete("/{account_id}", status_code=204)
def delete_account_v2(account_id: int, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    svc = AccountV2Service(db)
    row = svc.get_by_id(current_user.id, account_id)
    if not row:
        raise HTTPException(status_code=404, detail="AccountV2 not found")
    svc.delete(row)
    return None


    
