from __future__ import annotations

from fastapi.testclient import TestClient

from app import models
from app.main import app


def _override_user(user: models.User):
    from app.core.deps import get_current_user

    def _dep():
        return user

    app.dependency_overrides[get_current_user] = _dep


def test_account_v2_user_scoping_isolated(client, db_session):
    # Create two users
    u1 = models.User(email="u1@example.com", is_active=True)
    db_session.add(u1)
    db_session.flush()
    db_session.add(models.UserProfile(user_id=u1.id, display_name="U1", base_currency="KRW"))

    u2 = models.User(email="u2@example.com", is_active=True)
    db_session.add(u2)
    db_session.flush()
    db_session.add(models.UserProfile(user_id=u2.id, display_name="U2", base_currency="KRW"))
    db_session.commit()

    # Act as user1 and create defaults
    _override_user(u1)
    c = TestClient(app)
    r = c.post("/api/v2/accounts/init-default")
    assert r.status_code == 201
    r = c.get("/api/v2/accounts")
    assert r.status_code == 200
    rows_u1 = r.json()
    assert len(rows_u1) >= 3

    # Act as user2 and verify isolation
    _override_user(u2)
    c2 = TestClient(app)
    r = c2.get("/api/v2/accounts")
    assert r.status_code == 200
    assert r.json() == []  # no accounts yet for user2

    # Create defaults for user2
    r = c2.post("/api/v2/accounts/init-default")
    assert r.status_code == 201
    r = c2.get("/api/v2/accounts")
    rows_u2 = r.json()
    assert len(rows_u2) >= 3

    # Trees should be separate
    _override_user(u1)
    r1 = c.get("/api/v2/accounts/tree")
    _override_user(u2)
    r2 = c2.get("/api/v2/accounts/tree")
    assert r1.status_code == 200 and r2.status_code == 200
    ids_u1 = {n["id"] for n in r1.json()}
    ids_u2 = {n["id"] for n in r2.json()}
    assert ids_u1.isdisjoint(ids_u2)
