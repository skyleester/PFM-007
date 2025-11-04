from __future__ import annotations

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app import models


def get_current_user(db: Session = Depends(get_db)) -> models.User:
    """Very lightweight current user resolver.

    For now, returns the first user (creates a demo if none). Tests may override
    this dependency to simulate different users.
    """
    user = db.query(models.User).order_by(models.User.id).first()
    if not user:
        user = models.User(email="demo@example.com", is_active=True)
        db.add(user)
        db.flush()
        db.add(models.UserProfile(user_id=user.id, display_name="Demo", base_currency="KRW"))
        db.commit()
        db.refresh(user)
    return user
