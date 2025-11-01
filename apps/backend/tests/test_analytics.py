from datetime import date

import pytest


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


def test_analytics_overview_basic(client):
    account_primary = _create_account(client, "주계좌")
    account_savings = _create_account(client, "저축계좌")

    income_refs = _create_category(client, "I", 1, 1, "급여")
    expense_refs = _create_category(client, "E", 2, 1, "생활비")

    jan10 = date(2025, 1, 10).isoformat()
    jan12 = date(2025, 1, 12).isoformat()
    feb01 = date(2025, 2, 1).isoformat()

    resp = client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": jan10,
            "type": "INCOME",
            "account_id": account_primary["id"],
            "category_id": income_refs["category"]["id"],
            "amount": 3_000_000,
            "currency": "KRW",
            "memo": "월급",
        },
    )
    assert resp.status_code == 201, resp.text

    resp = client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": jan12,
            "type": "EXPENSE",
            "account_id": account_primary["id"],
            "category_id": expense_refs["category"]["id"],
            "amount": -1_000_000,
            "currency": "KRW",
            "memo": "렌트",
        },
    )
    assert resp.status_code == 201, resp.text

    resp = client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": feb01,
            "type": "EXPENSE",
            "account_id": account_primary["id"],
            "category_id": expense_refs["category"]["id"],
            "amount": -500_000,
            "currency": "KRW",
            "memo": "식비",
        },
    )
    assert resp.status_code == 201, resp.text

    resp = client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": jan12,
            "type": "TRANSFER",
            "account_id": account_primary["id"],
            "counter_account_id": account_savings["id"],
            "amount": 50_000,
            "currency": "KRW",
            "memo": "저축",
        },
    )
    assert resp.status_code == 201, resp.text

    resp = client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": feb01,
            "type": "EXPENSE",
            "account_id": account_primary["id"],
            "category_id": expense_refs["category"]["id"],
            "amount": -200_000,
            "currency": "KRW",
            "memo": "제외",
            "exclude_from_reports": True,
        },
    )
    assert resp.status_code == 201, resp.text

    overview = client.get(
        "/api/analytics/overview",
        params={
            "user_id": 1,
            "start": "2025-01-01",
            "end": "2025-12-31",
            "include_transfers": False,
        },
    )
    assert overview.status_code == 200, overview.text
    body = overview.json()

    assert body["kpis"]["total_income"] == pytest.approx(3_000_000)
    assert body["kpis"]["total_expense"] == pytest.approx(1_500_000)
    assert body["kpis"]["net"] == pytest.approx(1_500_000)

    months = {row["month"]: row for row in body["monthly_flow"]}
    assert months["2025-01"]["income"] == pytest.approx(3_000_000)
    assert months["2025-01"]["expense"] == pytest.approx(1_000_000)
    assert months["2025-02"]["expense"] == pytest.approx(500_000)

    shares = body["category_share"]
    assert len(shares) == 2
    income_share = next((item for item in shares if item["type"] == "INCOME"), None)
    expense_share = next((item for item in shares if item["type"] == "EXPENSE"), None)
    assert income_share is not None
    assert expense_share is not None
    assert income_share["amount"] == pytest.approx(3_000_000)
    assert income_share["percentage"] == pytest.approx(1.0)
    assert expense_share["amount"] == pytest.approx(1_500_000)
    assert expense_share["percentage"] == pytest.approx(1.0)

    primary_series = next(
        (series for series in body["account_timeline"] if series["account_id"] == account_primary["id"]),
        None,
    )
    assert primary_series is not None
    jan12_point = next((point for point in primary_series["points"] if point["occurred_at"] == "2025-01-12"), None)
    assert jan12_point is not None
    assert jan12_point["net_change"] == pytest.approx(-1_000_000)

    insights_ids = {item["id"] for item in body["insights"]}
    assert "net-positive" in insights_ids
    assert "top-category" in insights_ids

    with_transfers = client.get(
        "/api/analytics/overview",
        params={
            "user_id": 1,
            "start": "2025-01-01",
            "end": "2025-12-31",
            "include_transfers": True,
        },
    )
    assert with_transfers.status_code == 200
    series_with = next(
        (series for series in with_transfers.json()["account_timeline"] if series["account_id"] == account_primary["id"]),
        None,
    )
    assert series_with is not None
    jan12_with = next((point for point in series_with["points"] if point["occurred_at"] == "2025-01-12"), None)
    assert jan12_with is not None
    assert jan12_with["net_change"] == pytest.approx(-1_050_000)

    exclude_resp = client.put(
        "/api/statistics/settings",
        json={
            "user_id": 1,
            "excluded_category_ids": [expense_refs["category"]["id"]],
        },
    )
    assert exclude_resp.status_code == 200, exclude_resp.text
    assert exclude_resp.json()["excluded_category_ids"] == [expense_refs["category"]["id"]]

    excluded_overview = client.get(
        "/api/analytics/overview",
        params={
            "user_id": 1,
            "start": "2025-01-01",
            "end": "2025-12-31",
            "include_transfers": False,
        },
    )
    assert excluded_overview.status_code == 200
    excluded_body = excluded_overview.json()

    assert excluded_body["kpis"]["total_income"] == pytest.approx(3_000_000)
    assert excluded_body["kpis"]["total_expense"] == pytest.approx(0)
    assert excluded_body["kpis"]["net"] == pytest.approx(3_000_000)

    excluded_months = {row["month"]: row for row in excluded_body["monthly_flow"]}
    assert list(excluded_months.keys()) == ["2025-01"]
    assert excluded_months["2025-01"]["expense"] == pytest.approx(0)

    excluded_shares = excluded_body["category_share"]
    assert len(excluded_shares) == 1
    assert excluded_shares[0]["type"] == "INCOME"
    assert excluded_shares[0]["amount"] == pytest.approx(3_000_000)

    settings_fetch = client.get("/api/statistics/settings", params={"user_id": 1})
    assert settings_fetch.status_code == 200
    assert settings_fetch.json()["excluded_category_ids"] == [expense_refs["category"]["id"]]


def test_statistics_settings_validation(client):
    initial = client.get("/api/statistics/settings", params={"user_id": 1})
    assert initial.status_code == 200
    assert initial.json()["excluded_category_ids"] == []

    invalid = client.put(
        "/api/statistics/settings",
        json={"user_id": 1, "excluded_category_ids": [9999]},
    )
    assert invalid.status_code == 400

    refs = _create_category(client, "E", 9, 1, "테스트 지출")
    valid = client.put(
        "/api/statistics/settings",
        json={"user_id": 1, "excluded_category_ids": [refs["category"]["id"]]},
    )
    assert valid.status_code == 200
    assert valid.json()["excluded_category_ids"] == [refs["category"]["id"]]

    fetched = client.get("/api/statistics/settings", params={"user_id": 1})
    assert fetched.status_code == 200
    assert fetched.json()["excluded_category_ids"] == [refs["category"]["id"]]


def test_category_share_percentage_per_type(client):
    account = _create_account(client, "지출계좌")
    groceries = _create_category(client, "E", 3, 1, "식비")
    transport = _create_category(client, "E", 4, 1, "교통")

    resp = client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": date(2025, 3, 1).isoformat(),
            "type": "EXPENSE",
            "account_id": account["id"],
            "category_id": groceries["category"]["id"],
            "amount": -100_000,
            "currency": "KRW",
            "memo": "장보기",
        },
    )
    assert resp.status_code == 201, resp.text

    resp = client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": date(2025, 3, 2).isoformat(),
            "type": "EXPENSE",
            "account_id": account["id"],
            "category_id": transport["category"]["id"],
            "amount": -300_000,
            "currency": "KRW",
            "memo": "택시",
        },
    )
    assert resp.status_code == 201, resp.text

    overview = client.get(
        "/api/analytics/overview",
        params={"user_id": 1, "start": "2025-01-01", "end": "2025-12-31"},
    )
    assert overview.status_code == 200, overview.text
    expense_share = [item for item in overview.json()["category_share"] if item["type"] == "EXPENSE"]
    assert len(expense_share) == 2

    total = sum(item["amount"] for item in expense_share)
    assert total == pytest.approx(400_000)
    for item in expense_share:
        expected_ratio = item["amount"] / total
        assert item["percentage"] == pytest.approx(expected_ratio)


def test_analytics_extended_metrics(client):
    user_id = 1
    # 계좌 및 잔액 설정
    account_resp = client.post(
        "/api/accounts",
        json={
            "user_id": user_id,
            "name": "메인",
            "type": "DEPOSIT",
            "currency": "KRW",
            "balance": 1_500_000,
        },
    )
    assert account_resp.status_code == 201, account_resp.text
    account = account_resp.json()

    salary_refs = _create_category(client, "I", 5, 1, "급여")
    housing_refs = _create_category(client, "E", 6, 1, "주거")
    food_refs = _create_category(client, "E", 7, 1, "식비")

    # 정기 수입 규칙: 매월 10일 500,000원
    rule_resp = client.post(
        "/api/recurring-rules",
        json={
            "user_id": user_id,
            "name": "월급",
            "type": "INCOME",
            "frequency": "MONTHLY",
            "day_of_month": 10,
            "amount": 500_000,
            "currency": "KRW",
            "account_id": account["id"],
            "category_id": salary_refs["category"]["id"],
            "memo": "기본 월급",
            "is_active": True,
        },
    )
    assert rule_resp.status_code == 201, rule_resp.text
    rule = rule_resp.json()

    # 실제 수입 2회 (1, 2월), 3-4월은 미발생 => 경고 유도
    for occurred_at in (date(2025, 1, 10), date(2025, 2, 10)):
        resp = client.post(
            "/api/transactions",
            json={
                "user_id": user_id,
                "occurred_at": occurred_at.isoformat(),
                "type": "INCOME",
                "account_id": account["id"],
                "category_id": salary_refs["category"]["id"],
                "amount": 500_000,
                "currency": "KRW",
                "memo": "월급",
            },
        )
        assert resp.status_code == 201, resp.text

    expense_payloads = [
        (date(2025, 1, 12), "09:00:00", housing_refs["category"]["id"], -400_000, "월세"),
        (date(2025, 1, 13), "12:30:00", food_refs["category"]["id"], -50_000, "식비"),
        (date(2025, 2, 15), "20:00:00", housing_refs["category"]["id"], -450_000, "관리비"),
        (date(2025, 3, 1), "08:00:00", food_refs["category"]["id"], -60_000, "식비"),
        (date(2025, 3, 5), "22:00:00", housing_refs["category"]["id"], -1_200_000, "대규모 수리"),
    ]

    for occurred_at, occurred_time, category_id, amount, memo in expense_payloads:
        resp = client.post(
            "/api/transactions",
            json={
                "user_id": user_id,
                "occurred_at": occurred_at.isoformat(),
                "occurred_time": occurred_time,
                "type": "EXPENSE",
                "account_id": account["id"],
                "category_id": category_id,
                "amount": amount,
                "currency": "KRW",
                "memo": memo,
            },
        )
        assert resp.status_code == 201, resp.text

    overview = client.get(
        "/api/analytics/overview",
        params={
            "user_id": user_id,
            "start": "2025-01-01",
            "end": "2025-04-30",
            "include_transfers": False,
        },
    )
    assert overview.status_code == 200, overview.text
    body = overview.json()

    advanced = body["advanced"]
    assert advanced["savings_rate"] < 0
    assert advanced["projected_runway_days"] is not None
    assert advanced["projected_runway_days"] > 0
    assert advanced["expense_concentration_index"] > 0
    assert advanced["account_volatility"]

    category_trends = body["category_trends"]
    assert any(item["category_group_name"].startswith("E06") for item in category_trends)

    momentum = body["category_momentum"]
    assert momentum["top_rising"]

    heatmap = body["weekly_heatmap"]
    assert heatmap["buckets"]
    assert heatmap["max_value"] > 0

    anomalies = body["expense_anomalies"]
    assert anomalies
    assert anomalies[0]["amount"] >= 1_200_000

    alerts = body["income_alerts"]
    assert alerts
    alert = alerts[0]
    assert alert["rule_id"] == rule["id"]
    assert alert["delay_days"] > 0

    coverage = body["recurring_coverage"]
    assert coverage["overall_coverage_rate"] is not None
    assert coverage["overall_coverage_rate"] < 1
    assert coverage["uncovered_rules"]

    forecast = body["forecast"]
    assert forecast["next_month_expense"] > 0
    assert forecast["methodology"] in {"three_month_average", "simple_average"}
