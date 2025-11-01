from __future__ import annotations

from datetime import date, timedelta

import pytest


def _get_category(client, user_id: int, full_code: str):
    res = client.get(f"/api/categories", params={"user_id": user_id})
    assert res.status_code == 200
    items = res.json()
    for c in items:
        if c["full_code"] == full_code:
            return c
    return None


def test_recurring_preview_and_generate_income(client):
    user_id = 1
    # 준비: 계정 1개, 카테고리(I0000) 조회
    acc = client.post(
        "/api/accounts",
        json={
            "user_id": user_id,
            "name": "입출금",
            "type": "DEPOSIT",
            "currency": "KRW",
            "balance": 0,
        },
    ).json()
    cat = _get_category(client, user_id, "I0000")
    assert cat is not None

    # RecurringRule 생성: 매월 10일 수입 100
    rule_res = client.post(
        "/api/recurring-rules",
        json={
            "user_id": user_id,
            "name": "월급",
            "type": "INCOME",
            "frequency": "MONTHLY",
            "day_of_month": 10,
            "amount": 100,
            "currency": "KRW",
            "account_id": acc["id"],
            "category_id": cat["id"],
            "memo": "정기 수입",
            "is_active": True,
        },
    )
    assert rule_res.status_code == 201
    rule = rule_res.json()

    start = date(2025, 1, 1)
    end = date(2025, 3, 31)
    prev = client.get(
        f"/api/recurring-rules/{rule['id']}/preview",
        params={"start": start.isoformat(), "end": end.isoformat()},
    )
    assert prev.status_code == 200
    preview_payload = prev.json()
    assert preview_payload["total_count"] == 3
    assert preview_payload["page"] == 1
    assert preview_payload["page_size"] >= 3
    dates = [item["occurred_at"] for item in preview_payload["items"]]
    assert dates == ["2025-01-10", "2025-02-10", "2025-03-10"]

    # generate 1회차
    gen = client.post(
        f"/api/recurring-rules/{rule['id']}/generate",
        params={"start": start.isoformat(), "end": end.isoformat()},
    )
    assert gen.status_code == 200
    txns = gen.json()
    assert len(txns) == 3

    # 잔액 반영 확인: 100 * 3 = 300
    acc_after = client.get("/api/accounts", params={"user_id": user_id}).json()
    acc_data = next(a for a in acc_after if a["id"] == acc["id"])
    assert round(acc_data["balance"], 2) == 300.00

    # 멱등성: 같은 범위로 다시 generate해도 새로 생성되지 않음
    gen2 = client.post(
        f"/api/recurring-rules/{rule['id']}/generate",
        params={"start": start.isoformat(), "end": end.isoformat()},
    )
    assert gen2.status_code == 200
    txns2 = gen2.json()
    assert len(txns2) == 3  # 기존 건 반환
    # 총 트랜잭션 개수 3건 유지 확인
    list_res = client.get("/api/transactions", params={"user_id": user_id})
    assert list_res.status_code == 200
    assert int(list_res.headers.get("X-Total-Count", "0")) == 3


def test_fixed_recurring_without_category_defaults_to_uncategorized(client):
    user_id = 1
    acc = client.post(
        "/api/accounts",
        json={
            "user_id": user_id,
            "name": "기본계좌",
            "type": "DEPOSIT",
            "currency": "KRW",
            "balance": 0,
        },
    ).json()

    rule_res = client.post(
        "/api/recurring-rules",
        json={
            "user_id": user_id,
            "name": "기본 수입",
            "type": "INCOME",
            "frequency": "MONTHLY",
            "day_of_month": 15,
            "amount": 50_000,
            "currency": "KRW",
            "account_id": acc["id"],
            "memo": "카테고리 없이 생성",
            "is_active": True,
        },
    )
    assert rule_res.status_code == 201
    rule = rule_res.json()
    assert rule["category_id"] is not None

    start = date(2025, 1, 1)
    end = date(2025, 1, 31)
    gen = client.post(
        f"/api/recurring-rules/{rule['id']}/generate",
        params={"start": start.isoformat(), "end": end.isoformat()},
    )
    assert gen.status_code == 200
    txns = gen.json()
    assert len(txns) == 1
    txn = txns[0]
    assert txn["category_id"] == rule["category_id"]
    assert txn["amount"] == 50000

    accounts = client.get("/api/accounts", params={"user_id": user_id}).json()
    acc_state = next(item for item in accounts if item["id"] == acc["id"])
    assert round(acc_state["balance"], 2) == 50000.0


def test_recurring_generate_transfer_idempotent(client):
    user_id = 1
    # 준비: 두 계정 생성
    acc1 = client.post(
        "/api/accounts",
        json={
            "user_id": user_id,
            "name": "은행A",
            "type": "DEPOSIT",
            "currency": "KRW",
            "balance": 1000,
        },
    ).json()
    acc2 = client.post(
        "/api/accounts",
        json={
            "user_id": user_id,
            "name": "증권B",
            "type": "DEPOSIT",
            "currency": "KRW",
            "balance": 0,
        },
    ).json()

    # 매주 월요일 200 이체
    rule = client.post(
        "/api/recurring-rules",
        json={
            "user_id": user_id,
            "name": "적립이체",
            "type": "TRANSFER",
            "frequency": "WEEKLY",
            "weekday": 0,  # Monday
            "amount": 200,
            "currency": "KRW",
            "account_id": acc1["id"],
            "counter_account_id": acc2["id"],
            "memo": "주간 이체",
            "is_active": True,
        },
    ).json()

    # 2025-01-01 ~ 2025-01-31: 2025-01 월요일들: 6, 13, 20, 27 => 4회
    start = date(2025, 1, 1)
    end = date(2025, 1, 31)
    gen = client.post(
        f"/api/recurring-rules/{rule['id']}/generate",
        params={"start": start.isoformat(), "end": end.isoformat()},
    )
    assert gen.status_code == 200
    items = gen.json()
    assert len(items) == 4
    # 각 발생은 out_tx만 반환되므로 4건

    # 잔액: acc1 -800, acc2 +800
    accs = client.get("/api/accounts", params={"user_id": user_id}).json()
    a1 = next(a for a in accs if a["id"] == acc1["id"])
    a2 = next(a for a in accs if a["id"] == acc2["id"])
    assert round(a1["balance"], 2) == 200.00
    assert round(a2["balance"], 2) == 800.00

    # 멱등: 다시 생성해도 개수 증가 없음 (같은 external_id로 조회/반환)
    gen2 = client.post(
        f"/api/recurring-rules/{rule['id']}/generate",
        params={"start": start.isoformat(), "end": end.isoformat()},
    )
    assert gen2.status_code == 200
    items2 = gen2.json()
    assert len(items2) == 4
    # 전체 트랜잭션은 4회 * 2건(transfer pair) = 8건, preview 없이 바로 count 확인
    list_res = client.get("/api/transactions", params={"user_id": user_id})
    assert list_res.status_code == 200
    assert int(list_res.headers.get("X-Total-Count", "0")) == 8


def test_recurring_detail_update_delete(client):
    user_id = 1
    acc = client.post(
        "/api/accounts",
        json={
            "user_id": user_id,
            "name": "생활비",
            "type": "DEPOSIT",
            "currency": "KRW",
            "balance": 0,
        },
    ).json()
    cat = _get_category(client, user_id, "E0000")
    assert cat is not None

    rule = client.post(
        "/api/recurring-rules",
        json={
            "user_id": user_id,
            "name": "관리비",
            "type": "EXPENSE",
            "frequency": "MONTHLY",
            "day_of_month": 25,
            "amount": 150,
            "currency": "KRW",
            "account_id": acc["id"],
            "category_id": cat["id"],
            "memo": "아파트 관리비",
            "is_active": True,
        },
    ).json()

    detail = client.get(f"/api/recurring-rules/{rule['id']}", params={"user_id": user_id})
    assert detail.status_code == 200
    body = detail.json()
    assert body["name"] == "관리비"

    updated = client.patch(
        f"/api/recurring-rules/{rule['id']}",
        params={"user_id": user_id},
        json={
            "amount": 175,
            "memo": "아파트 관리비 (인상)",
            "is_active": False,
        },
    )
    assert updated.status_code == 200
    data = updated.json()
    assert round(float(data["amount"]), 2) == 175.00
    assert data["is_active"] is False
    assert data["memo"] == "아파트 관리비 (인상)"

    deleted = client.delete(f"/api/recurring-rules/{rule['id']}", params={"user_id": user_id})
    assert deleted.status_code == 204

    missing = client.get(f"/api/recurring-rules/{rule['id']}", params={"user_id": user_id})
    assert missing.status_code == 404


def test_recurring_update_transfer_requires_counter(client):
    user_id = 1
    src = client.post(
        "/api/accounts",
        json={
            "user_id": user_id,
            "name": "주계좌",
            "type": "DEPOSIT",
            "currency": "KRW",
            "balance": 0,
        },
    ).json()
    dst = client.post(
        "/api/accounts",
        json={
            "user_id": user_id,
            "name": "비상금",
            "type": "DEPOSIT",
            "currency": "KRW",
            "balance": 0,
        },
    ).json()

    rule = client.post(
        "/api/recurring-rules",
        json={
            "user_id": user_id,
            "name": "비상금 적립",
            "type": "TRANSFER",
            "frequency": "MONTHLY",
            "day_of_month": 5,
            "amount": 50,
            "currency": "KRW",
            "account_id": src["id"],
            "counter_account_id": dst["id"],
            "memo": "비상금 운용",
            "is_active": True,
        },
    ).json()

    drop_counter = client.patch(
        f"/api/recurring-rules/{rule['id']}",
        params={"user_id": user_id},
        json={"counter_account_id": None},
    )
    assert drop_counter.status_code == 400

    attach_category = client.patch(
        f"/api/recurring-rules/{rule['id']}",
        params={"user_id": user_id},
        json={"category_id": 123},
    )
    assert attach_category.status_code == 400


def test_variable_recurring_pending_and_confirm(client):
    user_id = 1
    acc = client.post(
        "/api/accounts",
        json={
            "user_id": user_id,
            "name": "체크카드",
            "type": "DEPOSIT",
            "currency": "KRW",
            "balance": 0,
        },
    ).json()
    cat = _get_category(client, user_id, "E0000")
    assert cat is not None

    today = date.today()
    rule_res = client.post(
        "/api/recurring-rules",
        json={
            "user_id": user_id,
            "name": "점심 식비",
            "type": "EXPENSE",
            "frequency": "DAILY",
            "amount": None,
            "currency": "KRW",
            "account_id": acc["id"],
            "category_id": cat["id"],
            "memo": "점심",
            "is_active": True,
            "is_variable_amount": True,
            "start_date": today.isoformat(),
        },
    )
    assert rule_res.status_code == 201
    rule = rule_res.json()
    detail = client.get(f"/api/recurring-rules/{rule['id']}", params={"user_id": user_id})
    assert detail.status_code == 200
    body = detail.json()
    assert today.isoformat() in body["pending_occurrences"]

    confirm = client.post(
        f"/api/recurring-rules/{rule['id']}/confirm",
        json={
            "occurred_at": today.isoformat(),
            "amount": 12_500,
            "memo": "실제 점심 비용",
        },
    )
    assert confirm.status_code == 200
    txn = confirm.json()
    assert txn["amount"] == -12500
    assert txn["memo"] == "실제 점심 비용"

    post_detail = client.get(f"/api/recurring-rules/{rule['id']}", params={"user_id": user_id})
    assert post_detail.status_code == 200
    post_data = post_detail.json()
    assert today.isoformat() not in post_data["pending_occurrences"]

    accounts = client.get("/api/accounts", params={"user_id": user_id}).json()
    acc_state = next(item for item in accounts if item["id"] == acc["id"])
    assert round(acc_state["balance"], 2) == -12500.0


def test_variable_pending_retains_unconfirmed_dates(client):
    user_id = 1
    acc = client.post(
        "/api/accounts",
        json={
            "user_id": user_id,
            "name": "변동 테스트",
            "type": "DEPOSIT",
            "currency": "KRW",
            "balance": 0,
        },
    ).json()
    cat = _get_category(client, user_id, "E0000")
    assert cat is not None

    today = date.today()
    start_date = today - timedelta(days=2)

    rule_res = client.post(
        "/api/recurring-rules",
        json={
            "user_id": user_id,
            "name": "변동 식비",
            "type": "EXPENSE",
            "frequency": "DAILY",
            "amount": None,
            "currency": "KRW",
            "account_id": acc["id"],
            "category_id": cat["id"],
            "memo": "테스트",
            "is_active": True,
            "is_variable_amount": True,
            "start_date": start_date.isoformat(),
        },
    )
    assert rule_res.status_code == 201
    rule = rule_res.json()

    detail = client.get(f"/api/recurring-rules/{rule['id']}", params={"user_id": user_id})
    assert detail.status_code == 200
    before_pending = detail.json()["pending_occurrences"]
    assert start_date.isoformat() in before_pending
    assert (today - timedelta(days=1)).isoformat() in before_pending
    assert today.isoformat() in before_pending

    confirm = client.post(
        f"/api/recurring-rules/{rule['id']}/confirm",
        json={
            "occurred_at": today.isoformat(),
            "amount": 8200,
        },
    )
    assert confirm.status_code == 200

    after_detail = client.get(f"/api/recurring-rules/{rule['id']}", params={"user_id": user_id})
    assert after_detail.status_code == 200
    after_pending = after_detail.json()["pending_occurrences"]
    assert today.isoformat() not in after_pending
    assert (today - timedelta(days=1)).isoformat() in after_pending
    assert start_date.isoformat() in after_pending

def test_recurring_generate_rejects_variable_rule(client):
    user_id = 1
    acc = client.post(
        "/api/accounts",
        json={
            "user_id": user_id,
            "name": "월급통장",
            "type": "DEPOSIT",
            "currency": "KRW",
            "balance": 0,
        },
    ).json()
    cat = _get_category(client, user_id, "I0000")
    assert cat is not None

    rule = client.post(
        "/api/recurring-rules",
        json={
            "user_id": user_id,
            "name": "프리랜서 수입",
            "type": "INCOME",
            "frequency": "MONTHLY",
            "day_of_month": 25,
            "currency": "KRW",
            "account_id": acc["id"],
            "category_id": cat["id"],
            "memo": "실제 수입에 맞춰 확인",
            "is_active": True,
            "is_variable_amount": True,
        },
    ).json()

    resp = client.post(
        f"/api/recurring-rules/{rule['id']}/generate",
        params={"start": "2025-01-01", "end": "2025-01-31"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Variable amount rule requires confirmation with amount"


def test_recurring_history_returns_stats(client):
    user_id = 1
    acc = client.post(
        "/api/accounts",
        json={
            "user_id": user_id,
            "name": "공과금 계좌",
            "type": "DEPOSIT",
            "currency": "KRW",
            "balance": 0,
        },
    ).json()
    cat = _get_category(client, user_id, "E0000")
    assert cat is not None

    rule = client.post(
        "/api/recurring-rules",
        json={
            "user_id": user_id,
            "name": "전기요금",
            "type": "EXPENSE",
            "frequency": "MONTHLY",
            "day_of_month": 15,
            "amount": 150_00,
            "currency": "KRW",
            "account_id": acc["id"],
            "category_id": cat["id"],
            "memo": "전기",
            "is_active": True,
        },
    ).json()

    generate = client.post(
        f"/api/recurring-rules/{rule['id']}/generate",
        params={"start": "2025-01-01", "end": "2025-03-31"},
    )
    assert generate.status_code == 200
    txns = generate.json()
    assert len(txns) == 3

    # adjust first two months to introduce variation (amounts stored as negative for expense)
    jan_txn = next(item for item in txns if item["occurred_at"] == "2025-01-15")
    feb_txn = next(item for item in txns if item["occurred_at"] == "2025-02-15")

    patch_jan = client.patch(
        f"/api/transactions/{jan_txn['id']}",
        params={"user_id": user_id},
        json={"amount": -140_00},
    )
    assert patch_jan.status_code == 200

    patch_feb = client.patch(
        f"/api/transactions/{feb_txn['id']}",
        params={"user_id": user_id},
        json={"amount": -180_00},
    )
    assert patch_feb.status_code == 200

    history = client.get(
        f"/api/recurring-rules/{rule['id']}/history",
        params={"user_id": user_id},
    )
    assert history.status_code == 200
    data = history.json()

    assert data["count"] == 3
    assert data["min_amount"] == pytest.approx(140_00)
    assert data["max_amount"] == pytest.approx(180_00)
    assert data["average_amount"] == pytest.approx((140_00 + 150_00 + 180_00) / 3)
    assert data["min_delta"] == pytest.approx(140_00 - 150_00)
    assert data["max_delta"] == pytest.approx(180_00 - 150_00)
    assert data["average_delta"] == pytest.approx(((140_00 + 150_00 + 180_00) / 3) - 150_00)

    # ensure ordering newest first and limit works
    assert data["transactions"][0]["occurred_at"] == "2025-03-15"
    limited = client.get(
        f"/api/recurring-rules/{rule['id']}/history",
        params={"user_id": user_id, "limit": 2},
    )
    assert limited.status_code == 200
    limited_data = limited.json()
    assert len(limited_data["transactions"]) == 2
    assert limited_data["transactions"][0]["occurred_at"] == "2025-03-15"

