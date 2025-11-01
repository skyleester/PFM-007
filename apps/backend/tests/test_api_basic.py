from datetime import date


def test_accounts_crud(client):
    # create
    r = client.post("/api/accounts", json={
        "user_id": 1, "name": "현금", "type": "OTHER", "currency": "KRW", "balance": 0
    })
    assert r.status_code == 201, r.text
    acc = r.json()
    assert acc["id"] > 0

    # list
    r = client.get("/api/accounts", params={"user_id": 1})
    assert r.status_code == 200
    rows = r.json()
    assert any(a["name"] == "현금" for a in rows)


def test_bulk_move_transactions_account(client):
    today = date.today().isoformat()

    src_resp = client.post("/api/accounts", json={
        "user_id": 1,
        "name": "이동-원천",
        "type": "OTHER",
        "currency": "KRW",
        "balance": 0,
    })
    assert src_resp.status_code == 201, src_resp.text
    src_account = src_resp.json()

    target_resp = client.post("/api/accounts", json={
        "user_id": 1,
        "name": "이동-대상",
        "type": "OTHER",
        "currency": "KRW",
        "balance": 0,
    })
    assert target_resp.status_code == 201, target_resp.text
    target_account = target_resp.json()

    tx_payload = {
        "user_id": 1,
        "occurred_at": today,
        "type": "EXPENSE",
        "account_id": src_account["id"],
        "category_group_name": "생활",
        "category_name": "마트",
        "amount": -1000,
        "currency": "KRW",
        "memo": "원천-1",
    }
    tx1_resp = client.post("/api/transactions", json=tx_payload)
    assert tx1_resp.status_code == 201, tx1_resp.text
    tx1 = tx1_resp.json()

    tx_payload["amount"] = -500
    tx_payload["memo"] = "원천-2"
    tx2_resp = client.post("/api/transactions", json=tx_payload)
    assert tx2_resp.status_code == 201, tx2_resp.text
    tx2 = tx2_resp.json()

    move_resp = client.post("/api/transactions/bulk-move-account", json={
        "user_id": 1,
        "transaction_ids": [tx1["id"], tx2["id"]],
        "target_account_id": target_account["id"],
    })
    assert move_resp.status_code == 200, move_resp.text
    body = move_resp.json()
    assert body["updated"] == 2
    assert body["missing"] == []
    assert body["skipped"] == []

    accounts = client.get("/api/accounts", params={"user_id": 1}).json()
    acc_map = {acc["id"]: acc for acc in accounts}
    assert acc_map[src_account["id"]]["balance"] == 0
    assert acc_map[target_account["id"]]["balance"] == -1500


def test_transaction_create_name_based_and_idempotent(client):
    # create expense with name-based account/category
    payload = {
        "user_id": 1,
        "occurred_at": date.today().isoformat(),
        "type": "EXPENSE",
        "account_name": "체크카드",
        "category_group_name": "식비",
        "category_name": "점심",
        "amount": -12000,
        "currency": "KRW",
        "memo": "라면",
        "external_id": "demo-1",
    }
    r1 = client.post("/api/transactions", json=payload)
    assert r1.status_code == 201, r1.text
    tx1 = r1.json()

    # idempotent with same external_id
    r2 = client.post("/api/transactions", json=payload)
    assert r2.status_code == 201
    tx2 = r2.json()
    assert tx1["id"] == tx2["id"]

    # account balance should reflect the amount once
    r_acc = client.get("/api/accounts", params={"user_id": 1})
    accs = {a["name"]: a for a in r_acc.json()}
    assert accs["체크카드"]["balance"] <= 0


def test_bulk_upsert_idempotent_without_override(client):
    payload = {
        "user_id": 1,
        "occurred_at": date.today().isoformat(),
        "type": "EXPENSE",
        "account_name": "체크카드",
        "category_group_name": "식비",
        "category_name": "점심",
        "amount": -12345,
        "currency": "KRW",
        "memo": "bulk-dup-test",
        "external_id": "bulk-dup-1",
    }

    r1 = client.post("/api/transactions/bulk", json={"user_id": 1, "items": [payload]})
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    ids_first = {row["id"] for row in body1["transactions"]}
    assert len(ids_first) == 1

    r2 = client.post("/api/transactions/bulk", json={"user_id": 1, "items": [payload]})
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    ids_second = {row["id"] for row in body2["transactions"]}
    assert ids_first == ids_second

    r_list = client.get("/api/transactions", params={"user_id": 1, "page_size": 2000})
    assert r_list.status_code == 200
    matches = [tx for tx in r_list.json() if tx["external_id"] == payload["external_id"]]
    assert len(matches) == 1


def test_transfer_pair_and_balances(client):
    # create transfer 50,000 from A to B
    payload = {
        "user_id": 1,
        "occurred_at": date.today().isoformat(),
        "type": "TRANSFER",
        "account_name": "A지갑",
        "counter_account_name": "B지갑",
        "amount": 50000,
        "currency": "KRW",
        "memo": "이체",
    }
    r = client.post("/api/transactions", json=payload)
    assert r.status_code == 201, r.text
    out_tx = r.json()
    assert out_tx["amount"] < 0  # 출금쪽 반환

    # balances
    r_acc = client.get("/api/accounts", params={"user_id": 1})
    accs = {a["name"]: a for a in r_acc.json()}
    assert accs["A지갑"]["balance"] <= 0
    assert accs["B지갑"]["balance"] >= 0


def test_transfer_with_category(client):
    payload = {
        "user_id": 1,
        "occurred_at": date.today().isoformat(),
        "type": "TRANSFER",
        "account_name": "입출금",
        "counter_account_name": "카드대금",
        "category_group_name": "카드대금",
        "category_name": "현대카드",
        "amount": 12345,
        "currency": "KRW",
        "memo": "카드 값" ,
    }
    r = client.post("/api/transactions", json=payload)
    assert r.status_code == 201, r.text
    tx = r.json()
    assert tx["category_id"] is not None
    # category lookup should be type T
    cats = client.get("/api/categories", params={"user_id": 1, "type": "T"}).json()
    assert any(c["name"] == "현대카드" for c in cats)


def test_bulk_transfer_with_category(client):
    payload = {
        "user_id": 1,
        "occurred_at": date.today().isoformat(),
        "type": "TRANSFER",
        "account_name": "주거래",
        "counter_account_name": "비상금",
        "category_group_name": "계좌이체",
        "category_name": "내부이체",
        "amount": 10000,
        "currency": "KRW",
        "memo": "bulk-transfer",
        "external_id": "bulk-transfer-1",
    }

    r = client.post("/api/transactions/bulk", json={"user_id": 1, "items": [payload]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["transactions"]) == 1
    tx = body["transactions"][0]
    assert tx["type"] == "TRANSFER"
    assert tx["category_id"] is not None
    # transfer pair should exist (outgoing amount negative)
    assert tx["amount"] < 0
    # ensure no duplicates on second run
    r2 = client.post("/api/transactions/bulk", json={"user_id": 1, "items": [payload]})
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    ids_second = {row["id"] for row in body2["transactions"]}
    assert {tx["id"]} == ids_second


    def test_auto_pair_preserves_counter_account_for_unicode(client):
        user_id = 1
        today = date.today().isoformat()

        # sanity: no placeholder counter account exists
        pre_accounts = client.get("/api/accounts", params={"user_id": user_id}).json()
        assert all(acc["name"] != "급여 하나 통장 (상대)" for acc in pre_accounts)

        payload = {
            "user_id": user_id,
            "items": [
                {
                    "user_id": user_id,
                    "occurred_at": today,
                    "occurred_time": "18:17:53",
                    "type": "TRANSFER",
                    "amount": -500000,
                    "currency": "KRW",
                    "account_name": "급여 하나 통장",
                    "category_group_name": "내계좌이체",
                    "category_name": "미분류",
                    "memo": "이호천",
                    "external_id": "unicode-transfer-out",
                    "transfer_flow": "OUT",
                },
                {
                    "user_id": user_id,
                    "occurred_at": today,
                    "occurred_time": "18:17:53",
                    "type": "TRANSFER",
                    "amount": 500000,
                    "currency": "KRW",
                    "account_name": "신한 주거래 우대통장(저축예금)",
                    "category_group_name": "내계좌이체",
                    "category_name": "미분류",
                    "memo": "이호천",
                    "external_id": "unicode-transfer-in",
                    "transfer_flow": "IN",
                },
            ],
        }

        resp = client.post("/api/transactions/bulk", json=payload)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        created = body["transactions"]
        assert len(created) == 1
        tx = created[0]
        assert tx["type"] == "TRANSFER"
        assert tx["is_auto_transfer_match"] is True
        assert tx["amount"] < 0

        accounts = client.get("/api/accounts", params={"user_id": user_id, "page_size": 2000}).json()
        account_map = {acc["id"]: acc["name"] for acc in accounts}

        assert account_map[tx["account_id"]] == "급여 하나 통장"
        assert account_map[tx["counter_account_id"]] == "신한 주거래 우대통장(저축예금)"
        assert all(name != "급여 하나 통장 (상대)" for name in account_map.values())

def test_bulk_delete_transactions(client):
    today = date.today().isoformat()
    # expense
    expense = client.post("/api/transactions", json={
        "user_id": 1,
        "occurred_at": today,
        "type": "EXPENSE",
        "account_name": "지출계좌",
        "category_group_name": "생활",
        "category_name": "마트",
        "amount": -5000,
        "currency": "KRW",
        "memo": "bulk-del-expense",
    }).json()
    income = client.post("/api/transactions", json={
        "user_id": 1,
        "occurred_at": today,
        "type": "INCOME",
        "account_name": "입금계좌",
        "category_group_name": "기타수입",
        "category_name": "보너스",
        "amount": 12000,
        "currency": "KRW",
        "memo": "bulk-del-income",
    }).json()
    transfer = client.post("/api/transactions", json={
        "user_id": 1,
        "occurred_at": today,
        "type": "TRANSFER",
        "account_name": "계좌A",
        "counter_account_name": "계좌B",
        "amount": 3300,
        "currency": "KRW",
    }).json()

    resp = client.post("/api/transactions/bulk-delete", json={
        "user_id": 1,
        "ids": [expense["id"], income["id"], transfer["id"]],
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["deleted"] >= 3
    assert set(body["deleted_ids"]) >= {expense["id"], income["id"], transfer["id"]}
    assert body["missing"] == []

    # ensure records gone
    remaining = client.get("/api/transactions", params={"user_id": 1, "page_size": 2000}).json()
    remaining_ids = {row["id"] for row in remaining}
    for removed_id in body["deleted_ids"]:
        assert removed_id not in remaining_ids

def test_list_transactions_pagination_header(client):
    r = client.get("/api/transactions", params={"user_id": 1, "page": 1, "page_size": 2})
    assert r.status_code == 200
    assert "X-Total-Count" in r.headers


def test_delete_transaction_rollback_balance(client):
    # create income
    payload = {
        "user_id": 1,
        "occurred_at": date.today().isoformat(),
        "type": "INCOME",
        "account_name": "월급통장",
        "category_group_name": "급여",
        "category_name": "정기급여",
        "amount": 100000,
        "currency": "KRW",
    }
    r = client.post("/api/transactions", json=payload)
    assert r.status_code == 201
    tx = r.json()

    # capture balance
    r_acc = client.get("/api/accounts", params={"user_id": 1})
    before = next(a for a in r_acc.json() if a["id"] == tx["account_id"]) ["balance"]

    # delete
    d = client.delete(f"/api/transactions/{tx['id']}")
    assert d.status_code == 204

    # balance rolled back
    r_acc2 = client.get("/api/accounts", params={"user_id": 1})
    after = next(a for a in r_acc2.json() if a["id"] == tx["account_id"]) ["balance"]
    assert after == before - tx["amount"]


def test_account_merge(client):
    a1 = client.post("/api/accounts", json={
        "user_id": 1,
        "name": "Merge Source",
        "type": "OTHER",
        "currency": "KRW",
        "balance": 0,
    }).json()
    a2 = client.post("/api/accounts", json={
        "user_id": 1,
        "name": "Merge Target",
        "type": "OTHER",
        "currency": "KRW",
        "balance": 1000,
    }).json()

    tx_payload = {
        "user_id": 1,
        "occurred_at": date.today().isoformat(),
        "type": "EXPENSE",
        "account_id": a1["id"],
        "category_group_name": "테스트",
        "category_name": "지출",
        "amount": -5000,
        "currency": "KRW",
    }
    client.post("/api/transactions", json=tx_payload)

    snapshot_before = client.get("/api/accounts", params={"user_id": 1}).json()
    source_before = next(acc for acc in snapshot_before if acc["id"] == a1["id"])
    target_before = next(acc for acc in snapshot_before if acc["id"] == a2["id"])

    merge = client.post(f"/api/accounts/{a1['id']}/merge", json={"target_account_id": a2["id"]})
    assert merge.status_code == 200, merge.text
    body = merge.json()
    assert body["transactions_moved"] >= 1
    assert body["target"]["id"] == a2["id"]

    accounts_after = client.get("/api/accounts", params={"user_id": 1}).json()
    source_after = next(acc for acc in accounts_after if acc["id"] == a1["id"])
    target_after = next(acc for acc in accounts_after if acc["id"] == a2["id"])
    assert source_after["is_archived"] is True
    assert all(
        tx["account_id"] != a1["id"]
        for tx in client.get("/api/transactions", params={"user_id": 1, "page_size": 2000}).json()
    )
    expected_balance = target_before["balance"] + source_before["balance"]
    assert target_after["balance"] == expected_balance
