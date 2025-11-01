from __future__ import annotations

from datetime import date


def test_budget_summary_basic(client):
    user_id = 1
    # 계정/카테고리 준비
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

    # 기본 지출 카테고리: E0000 사용
    cats = client.get("/api/categories", params={"user_id": user_id}).json()
    cat_e = next(c for c in cats if c["full_code"] == "E0000")

    # 1월 예산 1000 설정
    bd = client.post(
        "/api/budgets",
        json={
            "user_id": user_id,
            "period": "MONTH",
            "period_start": "2025-01-01",
            "period_end": "2025-01-31",
            "category_id": cat_e["id"],
            "account_id": acc["id"],
            "amount": 1000,
            "currency": "KRW",
            "rollover": False,
        },
    ).json()

    # 1월에 지출 120, 230 두 건 등록 (이름 기반 카테고리 지정)
    client.post(
        "/api/transactions",
        json={
            "user_id": user_id,
            "occurred_at": "2025-01-10",
            "type": "EXPENSE",
            "account_id": acc["id"],
            "category_id": cat_e["id"],
            "amount": -120,
            "currency": "KRW",
            "memo": "식비",
        },
    )
    client.post(
        "/api/transactions",
        json={
            "user_id": user_id,
            "occurred_at": "2025-01-20",
            "type": "EXPENSE",
            "account_id": acc["id"],
            "category_id": cat_e["id"],
            "amount": -230,
            "currency": "KRW",
            "memo": "교통",
        },
    )

    # 요약 호출
    res = client.get(f"/api/budgets/{bd['id']}/summary")
    assert res.status_code == 200
    data = res.json()
    assert data["planned"] == 1000.0
    assert data["spent"] == 350.0
    assert data["remaining"] == 650.0
    assert round(data["execution_rate"], 1) == 35.0
