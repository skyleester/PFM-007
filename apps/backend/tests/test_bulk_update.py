from __future__ import annotations

from datetime import date

USER_ID = 1


def _make_income(client, account_id: int, amount: float = 1000.0, memo: str = "", category=("급여", "정기")):
    r = client.post(
        "/api/transactions",
        json={
            "user_id": USER_ID,
            "occurred_at": date.today().isoformat(),
            "type": "INCOME",
            "account_id": account_id,
            "category_group_name": category[0],
            "category_name": category[1],
            "amount": amount,
            "currency": "KRW",
            "memo": memo,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_bulk_update_memo_replace_and_append(client):
    acc = client.post(
        "/api/accounts",
        json={"user_id": USER_ID, "name": "지갑", "type": "OTHER", "currency": "KRW"},
    ).json()

    t1 = _make_income(client, acc["id"], amount=1000, memo="A")
    t2 = _make_income(client, acc["id"], amount=2000, memo="B")

    # replace memo to empty string
    r1 = client.post(
        "/api/transactions/bulk-update",
        json={
            "user_id": USER_ID,
            "transaction_ids": [t1["id"], t2["id"]],
            "updates": {"memo": ""},
            "memo_mode": "replace",
        },
    )
    assert r1.status_code == 200, r1.text
    items = r1.json()["items"]
    assert all(it["memo"] == "" for it in items)

    # append text with delimiter
    r2 = client.post(
        "/api/transactions/bulk-update",
        json={
            "user_id": USER_ID,
            "transaction_ids": [t1["id"], t2["id"]],
            "updates": {"memo": "추가"},
            "memo_mode": "append",
            "append_delimiter": " / ",
        },
    )
    assert r2.status_code == 200, r2.text
    items2 = r2.json()["items"]
    assert all(it["memo"].endswith("추가") for it in items2)
    # ensure delimiter applied (previous was empty so delimiter may be omitted)


def test_bulk_update_exclude_toggle_and_category_guard(client):
    acc = client.post(
        "/api/accounts",
        json={"user_id": USER_ID, "name": "통장1", "type": "OTHER", "currency": "KRW"},
    ).json()

    inc = _make_income(client, acc["id"], amount=5000)
    exp = client.post(
        "/api/transactions",
        json={
            "user_id": USER_ID,
            "occurred_at": date.today().isoformat(),
            "type": "EXPENSE",
            "account_id": acc["id"],
            "category_group_name": "식비",
            "category_name": "점심",
            "amount": -700,
            "currency": "KRW",
        },
    ).json()

    # Create an expense category; attempt to assign it to INCOME via bulk should be skipped
    cats = client.get("/api/categories", params={"user_id": USER_ID, "page_size": 200}).json()
    any_expense = next(c for c in cats if c["full_code"].startswith("E"))

    r = client.post(
        "/api/transactions/bulk-update",
        json={
            "user_id": USER_ID,
            "transaction_ids": [inc["id"], exp["id"]],
            "updates": {"exclude_from_reports": True, "category_id": any_expense["id"]},
            "memo_mode": "replace",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # one should be skipped due to category/type mismatch (income)
    assert inc["id"] in body["skipped"]
    updated_ids = {it["id"] for it in body["items"]}
    assert exp["id"] in updated_ids
    # exclude flag applied on updated items
    for it in body["items"]:
        assert it["exclude_from_reports"] is True


def test_bulk_update_grouped_transfer_consistency(client):
    a1 = client.post(
        "/api/accounts",
        json={"user_id": USER_ID, "name": "A1", "type": "OTHER", "currency": "KRW"},
    ).json()
    a2 = client.post(
        "/api/accounts",
        json={"user_id": USER_ID, "name": "A2", "type": "OTHER", "currency": "KRW"},
    ).json()

    # create paired transfer via single request
    tr = client.post(
        "/api/transactions",
        json={
            "user_id": USER_ID,
            "occurred_at": date.today().isoformat(),
            "type": "TRANSFER",
            "account_id": a1["id"],
            "counter_account_id": a2["id"],
            "amount": 1000,
            "currency": "KRW",
        },
    )
    assert tr.status_code == 201, tr.text
    out_tx = tr.json()

    # bulk update amount -> 1500, and memo append
    r = client.post(
        "/api/transactions/bulk-update",
        json={
            "user_id": USER_ID,
            "transaction_ids": [out_tx["id"]],
            "updates": {"amount": 1500, "memo": "증액"},
            "memo_mode": "append",
        },
    )
    assert r.status_code == 200, r.text
    # fetch siblings and verify amounts
    sibs = client.get(
        "/api/transactions",
        params={"user_id": USER_ID, "account_id": a1["id"], "start": date.today().isoformat(), "end": date.today().isoformat(), "page_size": 50},
    ).json()
    # find group id
    group_id = next((row["group_id"] for row in sibs if row["id"] == out_tx["id"]), None)
    assert group_id is not None
    pair = client.get(
        "/api/transactions",
        params={"user_id": USER_ID, "page_size": 50, "start": date.today().isoformat(), "end": date.today().isoformat()},
    ).json()
    grouped = [row for row in pair if row.get("group_id") == group_id]
    assert len(grouped) == 2
    amounts = sorted(abs(x["amount"]) for x in grouped)
    assert amounts == [1500.0, 1500.0]
