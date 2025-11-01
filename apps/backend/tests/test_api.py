from datetime import date

USER_ID = 1


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_account_create_and_dedupe(client):
    data = {"user_id": USER_ID, "name": "테스트계좌", "type": "OTHER", "currency": "KRW"}
    r1 = client.post("/api/accounts", json=data)
    assert r1.status_code == 201
    r2 = client.post("/api/accounts", json=data)
    assert r2.status_code == 409


def test_check_card_requires_valid_link(client):
    deposit = client.post(
        "/api/accounts",
        json={"user_id": USER_ID, "name": "연동통장", "type": "DEPOSIT", "currency": "KRW", "balance": 100000},
    )
    assert deposit.status_code == 201
    deposit_id = deposit.json()["id"]

    other_account = client.post(
        "/api/accounts",
        json={"user_id": USER_ID, "name": "적금", "type": "SAVINGS", "currency": "KRW"},
    )
    assert other_account.status_code == 201

    manual_card = client.post(
        "/api/accounts",
        json={"user_id": USER_ID, "name": "체크카드_수동", "type": "CHECK_CARD", "currency": "KRW"},
    )
    assert manual_card.status_code == 201
    manual_payload = manual_card.json()
    assert manual_payload["linked_account_id"] is None
    assert manual_payload["auto_deduct"] is False

    wrong_type = client.post(
        "/api/accounts",
        json={
            "user_id": USER_ID,
            "name": "체크카드_잘못된연결",
            "type": "CHECK_CARD",
            "currency": "KRW",
            "linked_account_id": other_account.json()["id"],
        },
    )
    assert wrong_type.status_code == 400

    auto_without_link = client.post(
        "/api/accounts",
        json={
            "user_id": USER_ID,
            "name": "체크카드_auto",
            "type": "CHECK_CARD",
            "currency": "KRW",
            "auto_deduct": True,
        },
    )
    assert auto_without_link.status_code == 422

    ok = client.post(
        "/api/accounts",
        json={
            "user_id": USER_ID,
            "name": "체크카드",
            "type": "CHECK_CARD",
            "currency": "KRW",
            "linked_account_id": deposit_id,
            "auto_deduct": True,
        },
    )
    assert ok.status_code == 201
    created = ok.json()
    assert created["linked_account_id"] == deposit_id
    assert created["auto_deduct"] is True


def test_check_card_expense_updates_linked_deposit(client):
    deposit = client.post(
        "/api/accounts",
        json={"user_id": USER_ID, "name": "출금통장", "type": "DEPOSIT", "currency": "KRW", "balance": 50000},
    ).json()
    card = client.post(
        "/api/accounts",
        json={
            "user_id": USER_ID,
            "name": "체크카드2",
            "type": "CHECK_CARD",
            "currency": "KRW",
            "linked_account_id": deposit["id"],
            "auto_deduct": True,
        },
    ).json()

    payload = {
        "user_id": USER_ID,
        "occurred_at": date.today().isoformat(),
        "type": "EXPENSE",
        "account_id": card["id"],
        "category_group_name": "식비",
        "category_name": "점심",
        "amount": -12345,
        "currency": "KRW",
    }
    tx_resp = client.post("/api/transactions", json=payload)
    assert tx_resp.status_code == 201, tx_resp.text
    card_tx = tx_resp.json()
    assert card_tx["linked_transaction_id"] is not None

    accounts = {a["id"]: a for a in client.get(f"/api/accounts?user_id={USER_ID}").json()}
    linked = accounts[deposit["id"]]
    card_updated = accounts[card["id"]]
    assert float(linked["balance"]) == 50000 - 12345
    assert float(card_updated["balance"]) == 0.0

    mirror_list = client.get(
        "/api/transactions",
        params={"user_id": USER_ID, "account_id": deposit["id"], "page_size": 10},
    ).json()
    linked_ids = [row for row in mirror_list if row["linked_transaction_id"] == card_tx["id"]]
    assert len(linked_ids) == 1
    deposit_tx = linked_ids[0]
    assert deposit_tx["account_id"] == deposit["id"]
    assert deposit_tx["amount"] == -12345
    assert deposit_tx["linked_transaction_id"] == card_tx["id"]
    assert card_tx["linked_transaction_id"] == deposit_tx["id"]


def test_check_card_expense_without_auto_deduct(client):
    deposit = client.post(
        "/api/accounts",
        json={"user_id": USER_ID, "name": "출금X", "type": "DEPOSIT", "currency": "KRW", "balance": 50000},
    ).json()
    card = client.post(
        "/api/accounts",
        json={
            "user_id": USER_ID,
            "name": "체크카드_manual",
            "type": "CHECK_CARD",
            "currency": "KRW",
            "linked_account_id": deposit["id"],
            "auto_deduct": False,
        },
    ).json()

    payload = {
        "user_id": USER_ID,
        "occurred_at": date.today().isoformat(),
        "type": "EXPENSE",
        "account_id": card["id"],
        "category_group_name": "식비",
        "category_name": "점심",
        "amount": -1000,
        "currency": "KRW",
    }
    resp = client.post("/api/transactions", json=payload)
    assert resp.status_code == 201, resp.text
    card_tx = resp.json()
    # 체크카드는 auto_deduct 여부와 무관하게 사용 즉시 출금 계좌에 반영된다.
    assert card_tx["linked_transaction_id"] is not None

    mirrors = client.get(
        "/api/transactions",
        params={"user_id": USER_ID, "account_id": deposit["id"], "page_size": 10},
    ).json()
    linked_ids = [row for row in mirrors if row["linked_transaction_id"] == card_tx["id"]]
    assert len(linked_ids) == 1
    deposit_tx = linked_ids[0]
    assert deposit_tx["account_id"] == deposit["id"]
    assert deposit_tx["amount"] == -1000
    assert deposit_tx["linked_transaction_id"] == card_tx["id"]
    refreshed = client.get(f"/api/accounts?user_id={USER_ID}").json()
    deposit_after = next(row for row in refreshed if row["id"] == deposit["id"])
    assert float(deposit_after["balance"]) == 50000 - 1000


def test_check_card_currency_must_match_deposit(client):
    deposit = client.post(
        "/api/accounts",
        json={"user_id": USER_ID, "name": "원화통장", "type": "DEPOSIT", "currency": "KRW"},
    ).json()

    mismatch = client.post(
        "/api/accounts",
        json={
            "user_id": USER_ID,
            "name": "달러체크",
            "type": "CHECK_CARD",
            "currency": "USD",
            "linked_account_id": deposit["id"],
        },
    )
    assert mismatch.status_code == 400
    assert "currency" in mismatch.json()["detail"].lower()

    ok = client.post(
        "/api/accounts",
        json={
            "user_id": USER_ID,
            "name": "맞춘체크",
            "type": "CHECK_CARD",
            "linked_account_id": deposit["id"],
        },
    )
    assert ok.status_code == 201
    created = ok.json()
    assert created["currency"] == "KRW"
    assert float(created["balance"]) == 0.0


def test_credit_card_requires_schedule(client):
    deposit = client.post(
        "/api/accounts",
        json={"user_id": USER_ID, "name": "신용결제통장", "type": "DEPOSIT", "currency": "KRW"},
    ).json()

    missing_schedule = client.post(
        "/api/accounts",
        json={
            "user_id": USER_ID,
            "name": "신용카드",
            "type": "CREDIT_CARD",
            "linked_account_id": deposit["id"],
        },
    )
    assert missing_schedule.status_code == 422 or missing_schedule.status_code == 400

    ok = client.post(
        "/api/accounts",
        json={
            "user_id": USER_ID,
            "name": "월급카드",
            "type": "CREDIT_CARD",
            "linked_account_id": deposit["id"],
            "billing_cutoff_day": 25,
            "payment_day": 5,
        },
    )
    assert ok.status_code == 201, ok.text
    card = ok.json()
    assert card["billing_cutoff_day"] == 25
    assert card["payment_day"] == 5
    assert card["linked_account_id"] == deposit["id"]


def test_credit_card_usage_and_settlement_flow(client):
    deposit = client.post(
        "/api/accounts",
        json={"user_id": USER_ID, "name": "결제통장", "type": "DEPOSIT", "currency": "KRW", "balance": 100000},
    ).json()
    card = client.post(
        "/api/accounts",
        json={
            "user_id": USER_ID,
            "name": "신용카드A",
            "type": "CREDIT_CARD",
            "linked_account_id": deposit["id"],
            "billing_cutoff_day": 20,
            "payment_day": 10,
        },
    ).json()

    payload = {
        "user_id": USER_ID,
        "occurred_at": date.today().isoformat(),
        "type": "EXPENSE",
        "account_id": card["id"],
        "category_group_name": "식비",
        "category_name": "저녁",
        "amount": -45000,
        "currency": "KRW",
    }
    tx_resp = client.post("/api/transactions", json=payload)
    assert tx_resp.status_code == 201, tx_resp.text
    card_tx = tx_resp.json()
    assert card_tx["status"] == "PENDING_PAYMENT"
    assert card_tx["statement_id"] is not None

    statements = client.get(
        f"/api/accounts/{card['id']}/credit-card-statements",
        params={"user_id": USER_ID},
    )
    assert statements.status_code == 200
    stmts = statements.json()
    assert len(stmts) == 1
    stmt = stmts[0]
    assert float(stmt["total_amount"]) == 45000
    assert stmt["status"] in ("pending", "closed")

    summary = client.get(
        f"/api/accounts/{card['id']}/credit-card-summary",
        params={"user_id": USER_ID},
    )
    assert summary.status_code == 200
    summary_json = summary.json()
    assert float(summary_json["outstanding_amount"]) == 45000
    assert summary_json["active_statement"] is not None

    settle = client.post(f"/api/credit-card-statements/{stmt['id']}/settle", json={})
    assert settle.status_code == 200, settle.text
    settled = settle.json()
    assert settled["status"] == "paid"
    assert float(settled["total_amount"]) == 0.0

    refreshed_accounts = {
        row["id"]: row
        for row in client.get(f"/api/accounts?user_id={USER_ID}").json()
    }
    deposit_after = refreshed_accounts[deposit["id"]]
    assert float(deposit_after["balance"]) == float(deposit["balance"]) - 45000

    summary_after = client.get(
        f"/api/accounts/{card['id']}/credit-card-summary",
        params={"user_id": USER_ID},
    ).json()
    assert float(summary_after["outstanding_amount"]) == 0.0
    assert summary_after["active_statement"] is None or summary_after["active_statement"]["status"] in ("pending", "closed")
    assert summary_after["last_paid_statement"] is not None

def test_linked_deposit_cannot_be_deleted(client):
    deposit = client.post(
        "/api/accounts",
        json={"user_id": USER_ID, "name": "삭제불가통장", "type": "DEPOSIT", "currency": "KRW"},
    ).json()
    card = client.post(
        "/api/accounts",
        json={
            "user_id": USER_ID,
            "name": "삭제테스트카드",
            "type": "CHECK_CARD",
            "currency": "KRW",
            "linked_account_id": deposit["id"],
        },
    )
    assert card.status_code == 201

    blocked = client.delete(f"/api/accounts/{deposit['id']}")
    assert blocked.status_code == 400

    client.delete(f"/api/accounts/{card.json()['id']}")
    allowed = client.delete(f"/api/accounts/{deposit['id']}")
    assert allowed.status_code == 204


def test_category_create_and_dedupe(client, db_session):
    # 그룹을 하나 생성한 후 해당 그룹에 카테고리 생성
    from app import models

    g = models.CategoryGroup(type="E", code_gg=1, name="식비")
    db_session.add(g)
    db_session.commit()

    data = {"group_id": g.id, "code_cc": 1, "name": "테스트카테고리"}
    r1 = client.post("/api/categories", json=data)
    assert r1.status_code == 201
    r2 = client.post("/api/categories", json=data)
    assert r2.status_code == 409


def test_transaction_idempotency(client):
    # 계정/카테고리를 이름 기반으로 생성/해결
    payload = {
        "user_id": USER_ID,
        "occurred_at": date.today().isoformat(),
        "type": "EXPENSE",
        "account_name": "지갑",
        "category_group_name": "식비",
        "category_name": "점심",
        "amount": -1000,
        "currency": "KRW",
        "external_id": "demo-unique-1",
    }
    r1 = client.post("/api/transactions", json=payload)
    assert r1.status_code == 201, r1.text
    r2 = client.post("/api/transactions", json=payload)
    assert r2.status_code == 201, r2.text
    assert r1.json()["id"] == r2.json()["id"]


def test_transaction_transfer_pair(client):
    payload = {
        "user_id": USER_ID,
        "occurred_at": date.today().isoformat(),
        "type": "TRANSFER",
        "account_name": "A",
        "counter_account_name": "B",
        "amount": 5000,
        "currency": "KRW",
        "external_id": "demo-transfer-1",
    }
    r = client.post("/api/transactions", json=payload)
    assert r.status_code == 201
    # 쌍이 생성됐는지 확인
    txs = client.get(f"/api/transactions?user_id={USER_ID}&type=TRANSFER").json()
    group_ids = set(t["group_id"] for t in txs if t.get("group_id"))
    assert any(gid is not None for gid in group_ids)


def test_transaction_balance_update(client):
    # 수입 1234 추가 후 잔액 증가 확인
    payload = {
        "user_id": USER_ID,
        "occurred_at": date.today().isoformat(),
        "type": "INCOME",
        "account_name": "월급통장",
        "category_group_name": "급여",
        "category_name": "정기급여",
        "amount": 1234,
        "currency": "KRW",
    }
    r = client.post("/api/transactions", json=payload)
    assert r.status_code == 201
    # 잔액 확인
    accs = client.get(f"/api/accounts?user_id={USER_ID}").json()
    acc = next(a for a in accs if a["name"] == "월급통장")
    assert float(acc["balance"]) >= 1234.0


def test_transaction_filter_and_pagination(client):
    # 여러 트랜잭션 생성
    for i in range(5):
        payload = {
            "user_id": USER_ID,
            "occurred_at": date.today().isoformat(),
            "type": "EXPENSE",
            "account_name": "카드",
            "category_group_name": "식비",
            "category_name": "간식",
            "amount": -(100 + i),
            "currency": "KRW",
            "memo": f"테스트{i}",
        }
        client.post("/api/transactions", json=payload)
    r = client.get(f"/api/transactions?user_id={USER_ID}&page=1&page_size=2")
    assert r.status_code == 200
    assert len(r.json()) == 2
    assert "X-Total-Count" in r.headers
