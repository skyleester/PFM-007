from __future__ import annotations

from datetime import date


def test_update_income_amount_and_account(client):
    # create two accounts
    a1 = client.post(
        "/api/accounts",
        json={"user_id": 1, "name": "A1", "type": "OTHER", "currency": "KRW"},
    ).json()
    a2 = client.post(
        "/api/accounts",
        json={"user_id": 1, "name": "A2", "type": "OTHER", "currency": "KRW"},
    ).json()

    # income +1000 into A1
    r = client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": date.today().isoformat(),
            "type": "INCOME",
            "account_id": a1["id"],
            "category_group_name": "급여",
            "category_name": "정기",
            "amount": 1000,
            "currency": "KRW",
        },
    )
    assert r.status_code == 201
    tx = r.json()

    # update amount to 1500 and move to A2
    u = client.patch(
        f"/api/transactions/{tx['id']}",
        json={"amount": 1500, "account_id": a2["id"]},
    )
    assert u.status_code == 200

    # balances: A1 back to 0, A2 to 1500
    accs = {a["name"]: a for a in client.get("/api/accounts", params={"user_id": 1}).json()}
    assert float(accs["A1"]["balance"]) == 0.0
    assert float(accs["A2"]["balance"]) == 1500.0


def test_update_transfer_amount_reflects_both_sides(client):
    # transfer 200 from W1 to W2
    r = client.post(
        "/api/transactions",
        json={
            "user_id": 1,
            "occurred_at": date.today().isoformat(),
            "type": "TRANSFER",
            "account_name": "W1",
            "counter_account_name": "W2",
            "amount": 200,
            "currency": "KRW",
        },
    )
    assert r.status_code == 201
    tx = r.json()

    # update amount -> 350
    u = client.patch(f"/api/transactions/{tx['id']}", json={"amount": 350})
    assert u.status_code == 200

    # balances reflect -350/+350
    accs = {a["name"]: a for a in client.get("/api/accounts", params={"user_id": 1}).json()}
    assert float(accs["W1"]["balance"]) <= -350.0
    assert float(accs["W2"]["balance"]) >= 350.0
