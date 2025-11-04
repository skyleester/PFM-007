from __future__ import annotations

from datetime import datetime

from fastapi.testclient import TestClient


def test_bulk_upload_success(client: TestClient):
    payload = [
        {
            "date": "2025-10-25T12:30:00.000Z",
            "type": "INCOME",
            "amount": 12000,
            "memo": "급여",
            "category_main": "수입",
            "category_sub": "기타",
            "description": "보너스",
            "account_name": "주거래",
            "currency": "KRW",
        },
        {
            "date": "2025-10-26T08:10:00.000Z",
            "type": "EXPENSE",
            "amount": 5500,
            "memo": "커피",
            "category_main": "식비",
            "category_sub": "카페",
            "description": "스타벅스",
            "account_name": "주거래",
            "currency": "KRW",
        },
    ]

    res = client.post("/api/transactions/bulk-upload", params={"user_id": 1}, json=payload)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["total_count"] == 2
    assert data["success_count"] == 2
    assert data["failed_count"] == 0
    assert data.get("duplicates", 0) == 0


def test_bulk_upload_partial_fail_and_duplicate(client: TestClient):
    # First insert one item
    first = {
        "date": "2025-10-25T12:30:00.000Z",
        "type": "INCOME",
        "amount": 12000,
        "memo": "급여",
        "category_main": "수입",
        "category_sub": "기타",
        "description": "보너스",
        "account_name": "주거래",
        "currency": "KRW",
    }
    res1 = client.post("/api/transactions/bulk-upload", params={"user_id": 1}, json=[first])
    assert res1.status_code == 200
    # Duplicate of the first + one invalid (amount <= 0) + one missing category
    payload = [
        first,
        {
            "date": "2025-10-27T10:00:00.000Z",
            "type": "EXPENSE",
            "amount": 0,
            "memo": "점심",
            "category_main": "식비",
            "category_sub": "외식",
            "description": "한식",
            "account_name": "주거래",
            "currency": "KRW",
        },
        {
            "date": "2025-10-27T11:00:00.000Z",
            "type": "INCOME",
            "amount": 1000,
            "memo": "잡수입",
            "category_main": "수입",
            "category_sub": None,
            "description": "사내이벤트",
            "account_name": "주거래",
            "currency": "KRW",
        },
    ]
    res = client.post("/api/transactions/bulk-upload", params={"user_id": 1}, json=payload)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["total_count"] == 3
    assert data["duplicates"] == 1
    # One invalid (amount 0), one invalid (missing category_sub) -> 2 failed
    assert data["failed_count"] == 2
    assert data["success_count"] == 0
    assert isinstance(data.get("errors", []), list)
    assert len(data.get("errors", [])) == 2
