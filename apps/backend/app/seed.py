from __future__ import annotations

from sqlalchemy.orm import Session

from .core.database import SessionLocal
from .models import User, UserProfile, CategoryGroup, Category


def seed() -> None:
    db: Session = SessionLocal()
    try:
        # 기본 사용자(데모)
        user = db.query(User).filter_by(email="demo@example.com").first()
        if not user:
            user = User(email="demo@example.com", is_active=True)
            db.add(user)
            db.flush()
            db.add(UserProfile(user_id=user.id, display_name="Demo", base_currency="KRW"))

        # 미분류 그룹/카테고리 I/E/T 각각 00/00
        for t in ("I", "E", "T"):
            group = db.query(CategoryGroup).filter_by(type=t, code_gg=0).first()
            if not group:
                group = CategoryGroup(type=t, code_gg=0, name="미분류")
                db.add(group)
                db.flush()
            cat = db.query(Category).filter_by(group_id=group.id, code_cc=0).first()
            if not cat:
                full_code = f"{t}0000"
                db.add(Category(group_id=group.id, code_cc=0, name="미분류", full_code=full_code))

        # (선택) 멤버 1 기본 사용자도 함께 준비: user_id=2 가정
        member = db.query(User).filter_by(email="member1@example.com").first()
        if not member:
            # 가능하면 id=2로 지정해 UI 기본값과 일치시키되, 이미 사용 중이면 자동 증가 사용
            try:
                member = User(id=2, email="member1@example.com", is_active=True)
                db.add(member)
                db.flush()
            except Exception:
                db.rollback()
                db.begin()
                member = User(email="member1@example.com", is_active=True)
                db.add(member)
                db.flush()
            db.add(UserProfile(user_id=member.id, display_name="Member 1", base_currency="KRW"))

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
