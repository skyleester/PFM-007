from datetime import date, timedelta

from app import models


def _create_account(db_session, user_id: int = 1) -> models.Account:
    account = models.Account(
        user_id=user_id,
        name="테스트 입출금",
        type=models.AccountType.DEPOSIT,
        balance=0,
        currency="KRW",
    )
    db_session.add(account)
    db_session.flush()
    return account


def _get_default_expense_category(db_session) -> models.Category:
    return (
        db_session.query(models.Category)
        .filter(models.Category.full_code == "E0000")
        .first()
    )


def _seed_expense_series(db_session, account_id: int, category_id: int, user_id: int = 1) -> None:
    anchor = date.today().replace(day=10)
    dates = [anchor - timedelta(days=offset) for offset in (90, 60, 30, 0)]
    for dt_value in dates:
        tx = models.Transaction(
            user_id=user_id,
            occurred_at=dt_value,
            occurred_time=None,
            type=models.TxnType.EXPENSE,
            account_id=account_id,
            amount=-15000,
            currency="KRW",
            category_id=category_id,
            memo="넷플릭스 정기결제",
        )
        db_session.add(tx)
    db_session.commit()


def test_scan_respects_candidate_exclusions(client, db_session):
    account = _create_account(db_session)
    category = _get_default_expense_category(db_session)
    assert category is not None
    _seed_expense_series(db_session, account.id, category.id)

    scan_payload = {
        "user_id": 1,
        "horizon_days": 400,
        "min_occurrences": 3,
        "include_transfers": False,
        "ignore_category": False,
    }

    response = client.post("/api/recurring/scan-candidates", json=scan_payload)
    assert response.status_code == 200, response.json()
    candidates = response.json()
    assert candidates, "Expected at least one recurring candidate"
    target = candidates[0]
    signature_hash = target["signature_hash"]

    exclusion_payload = {
        "user_id": 1,
        "signature_hash": signature_hash,
        "snapshot": target,
    }
    create_resp = client.post("/api/recurring/exclusions", json=exclusion_payload)
    assert create_resp.status_code == 201, create_resp.json()
    exclusion = create_resp.json()
    assert exclusion["signature_hash"] == signature_hash

    response_after = client.post("/api/recurring/scan-candidates", json=scan_payload)
    assert response_after.status_code == 200, response_after.json()
    assert response_after.json() == []

    list_resp = client.get("/api/recurring/exclusions", params=[("user_id", 1)])
    assert list_resp.status_code == 200, list_resp.json()
    listed = list_resp.json()
    assert len(listed) == 1
    assert listed[0]["id"] == exclusion["id"]

    delete_resp = client.delete(f"/api/recurring/exclusions/{exclusion['id']}", params={"user_id": 1})
    assert delete_resp.status_code == 204

    response_final = client.post("/api/recurring/scan-candidates", json=scan_payload)
    assert response_final.status_code == 200, response_final.json()
    assert response_final.json(), "Candidate should reappear after exclusion removal"
