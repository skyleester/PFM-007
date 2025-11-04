import pytest
from datetime import date


pytestmark = pytest.mark.analytics


def _create_account(client, name: str) -> dict:
    resp = client.post(
        "/api/accounts",
        json={
            "user_id": 1,
            "name": name,
            "type": "OTHER",
            "currency": "KRW",
            "balance": 0,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_category(client, type_code: str, code_gg: int, code_cc: int, name: str) -> dict:
    """Create a group+category pair and return both ids."""
    group_resp = client.post(
        "/api/category-groups",
        json={
            "user_id": 1,
            "type": type_code,
            "code_gg": code_gg,
            "name": name,
        },
    )
    assert group_resp.status_code == 201, group_resp.text
    group = group_resp.json()

    cat_resp = client.post(
        "/api/categories",
        json={
            "user_id": 1,
            "group_id": group["id"],
            "code_cc": code_cc,
            "name": name,
        },
    )
    assert cat_resp.status_code == 201, cat_resp.text
    category = cat_resp.json()
    return {"group": group, "category": category}


def _find_series(overview_json: dict, account_id: int) -> dict | None:
    return next((s for s in overview_json["account_timeline"] if s["account_id"] == account_id), None)


def _find_point(series: dict, day_iso: str) -> dict | None:
    return next((p for p in series.get("points", []) if p["occurred_at"] == day_iso), None)


def test_timeline_basic_transfer_consistency(client):
    # Accounts and categories
    acc_a = _create_account(client, "A")
    acc_b = _create_account(client, "B")
    income_refs = _create_category(client, "I", 11, 1, "급여")
    expense_refs = _create_category(client, "E", 21, 1, "생활비")

    d_income = date(2025, 1, 10).isoformat()
    d_expense = date(2025, 1, 11).isoformat()
    d_transfer = date(2025, 1, 12).isoformat()

    # Income +100,000 to A
    r = client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": d_income,
            "type": "INCOME",
            "account_id": acc_a["id"],
            "category_id": income_refs["category"]["id"],
            "amount": 100_000,
            "currency": "KRW",
            "memo": "테스트 수입",
        },
    )
    assert r.status_code == 201, r.text

    # Expense -50,000 from A
    r = client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": d_expense,
            "type": "EXPENSE",
            "account_id": acc_a["id"],
            "category_id": expense_refs["category"]["id"],
            "amount": -50_000,
            "currency": "KRW",
            "memo": "테스트 지출",
        },
    )
    assert r.status_code == 201, r.text

    # Transfer 200,000 from A -> B (unified fields via legacy aliases allowed)
    r = client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": d_transfer,
            "type": "TRANSFER",
            "account_id": acc_a["id"],
            "counter_account_id": acc_b["id"],
            "amount": 200_000,
            "currency": "KRW",
            "memo": "A->B 이체",
        },
    )
    assert r.status_code == 201, r.text

    # Fetch timeline with transfers included
    res = client.get(
        "/api/analytics/overview",
        params={
            "user_id": 1,
            "start": "2025-01-01",
            "end": "2025-01-31",
            "include_transfers": True,
        },
    )
    assert res.status_code == 200, res.text
    ov = res.json()

    series_a = _find_series(ov, acc_a["id"])
    series_b = _find_series(ov, acc_b["id"])
    assert series_a is not None and series_b is not None

    p_a_t = _find_point(series_a, d_transfer)
    p_b_t = _find_point(series_b, d_transfer)
    assert p_a_t is not None and p_b_t is not None

    # Transfer attribution: A shows -200,000, B shows +200,000
    assert p_a_t["net_change"] == pytest.approx(-200_000)
    assert p_b_t["net_change"] == pytest.approx(+200_000)

    # Sum of transfer net_change across both accounts is zero for the transfer date
    assert (p_a_t["net_change"] + p_b_t["net_change"]) == pytest.approx(0)

    # Running totals include prior income/expense on A
    # A: +100,000 (Jan10) -50,000 (Jan11) -200,000 (Jan12) = -150,000
    assert p_a_t["running_total"] == pytest.approx(-150_000)
    # B: only +200,000 on transfer day
    assert p_b_t["running_total"] == pytest.approx(+200_000)


def test_timeline_exclusion_behavior(client):
    acc_a = _create_account(client, "A2")
    acc_b = _create_account(client, "B2")
    income_refs = _create_category(client, "I", 12, 2, "급여2")
    expense_refs = _create_category(client, "E", 22, 2, "생활비2")

    d_income = date(2025, 2, 10).isoformat()
    d_expense = date(2025, 2, 11).isoformat()
    d_transfer = date(2025, 2, 12).isoformat()

    # Income to A
    assert client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": d_income,
            "type": "INCOME",
            "account_id": acc_a["id"],
            "category_id": income_refs["category"]["id"],
            "amount": 100_000,
            "currency": "KRW",
        },
    ).status_code == 201

    # Expense from A
    assert client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": d_expense,
            "type": "EXPENSE",
            "account_id": acc_a["id"],
            "category_id": expense_refs["category"]["id"],
            "amount": -50_000,
            "currency": "KRW",
        },
    ).status_code == 201

    # Transfer A -> B
    assert client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": d_transfer,
            "type": "TRANSFER",
            "account_id": acc_a["id"],
            "counter_account_id": acc_b["id"],
            "amount": 200_000,
            "currency": "KRW",
        },
    ).status_code == 201

    # Fetch timeline with transfers excluded
    res = client.get(
        "/api/analytics/overview",
        params={
            "user_id": 1,
            "start": "2025-02-01",
            "end": "2025-02-28",
            "include_transfers": False,
        },
    )
    assert res.status_code == 200, res.text
    ov = res.json()

    series_a = _find_series(ov, acc_a["id"])
    series_b = _find_series(ov, acc_b["id"])
    assert series_a is not None
    # B should have no timeline points (only had a transfer inflow which is excluded)
    assert series_b is None or len(series_b.get("points", [])) == 0

    p_a_income = _find_point(series_a, d_income)
    p_a_expense = _find_point(series_a, d_expense)
    p_a_transfer = _find_point(series_a, d_transfer)

    assert p_a_income and p_a_income["net_change"] == pytest.approx(+100_000)
    assert p_a_expense and p_a_expense["net_change"] == pytest.approx(-50_000)
    # Transfer day should not exist in the series
    assert p_a_transfer is None


def test_timeline_legacy_payload_normalization(client):
    """
    Create the same scenario using legacy fields (account_id, counter_account_id) only
    and verify the resulting timeline deltas match expectations.
    """
    acc_c = _create_account(client, "C")
    acc_d = _create_account(client, "D")
    income_refs = _create_category(client, "I", 13, 3, "급여3")
    expense_refs = _create_category(client, "E", 23, 3, "생활비3")

    d_income = date(2025, 3, 10).isoformat()
    d_expense = date(2025, 3, 11).isoformat()
    d_transfer = date(2025, 3, 12).isoformat()

    # Legacy-style INCOME (account_id only)
    assert client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": d_income,
            "type": "INCOME",
            "account_id": acc_c["id"],
            "category_id": income_refs["category"]["id"],
            "amount": 100_000,
            "currency": "KRW",
        },
    ).status_code == 201

    # Legacy-style EXPENSE (account_id only)
    assert client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": d_expense,
            "type": "EXPENSE",
            "account_id": acc_c["id"],
            "category_id": expense_refs["category"]["id"],
            "amount": -50_000,
            "currency": "KRW",
        },
    ).status_code == 201

    # Legacy-style TRANSFER (account_id + counter_account_id)
    assert client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": d_transfer,
            "type": "TRANSFER",
            "account_id": acc_c["id"],
            "counter_account_id": acc_d["id"],
            "amount": 200_000,
            "currency": "KRW",
        },
    ).status_code == 201

    res = client.get(
        "/api/analytics/overview",
        params={
            "user_id": 1,
            "start": "2025-03-01",
            "end": "2025-03-31",
            "include_transfers": True,
        },
    )
    assert res.status_code == 200, res.text
    ov = res.json()

    series_c = _find_series(ov, acc_c["id"])  # source
    series_d = _find_series(ov, acc_d["id"])  # destination
    assert series_c is not None and series_d is not None

    p_c_t = _find_point(series_c, d_transfer)
    p_d_t = _find_point(series_d, d_transfer)
    assert p_c_t and p_d_t

    # Same attribution as unified schema
    assert p_c_t["net_change"] == pytest.approx(-200_000)
    assert p_d_t["net_change"] == pytest.approx(+200_000)
    assert (p_c_t["net_change"] + p_d_t["net_change"]) == pytest.approx(0)

    # Running totals match expected arithmetic
    assert p_c_t["running_total"] == pytest.approx(-150_000)
    assert p_d_t["running_total"] == pytest.approx(+200_000)
