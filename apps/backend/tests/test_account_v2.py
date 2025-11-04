from __future__ import annotations

from decimal import Decimal


def test_account_v2_crud_and_tree(client):
    # Create parent
    resp = client.post(
        "/api/v2/accounts",
        json={
            "name": "삼성카드",
            "type": "CARD",
            "currency": "KRW",
            "is_active": True,
        },
    )
    assert resp.status_code == 201, resp.text
    parent = resp.json()
    assert parent["id"] > 0
    assert parent["type"] == "CARD"

    # Create child linked to parent
    resp = client.post(
        "/api/v2/accounts",
        json={
            "name": "삼성카드 포인트",
            "type": "POINT",
            "currency": "KRW",
            "parent_id": parent["id"],
        },
    )
    assert resp.status_code == 201, resp.text
    child = resp.json()
    assert child["parent_id"] == parent["id"]

    # Patch: set balance and inactive
    resp = client.patch(
        f"/api/v2/accounts/{child['id']}",
        json={"balance": "123.4500", "is_active": False},
    )
    assert resp.status_code == 200, resp.text
    patched = resp.json()
    assert patched["balance"] == "123.4500"
    assert patched["is_active"] is False

    # List: filter active only
    resp = client.get("/api/v2/accounts", params={"is_active": True})
    print("LIST RESP:", resp.status_code, resp.text)
    assert resp.status_code == 200
    rows = resp.json()
    ids = [r["id"] for r in rows]
    assert parent["id"] in ids
    assert child["id"] not in ids  # filtered out

    # Tree should include 1 root with 1 child
    resp = client.get("/api/v2/accounts/tree")
    print("TREE RESP:", resp.status_code, resp.text)
    assert resp.status_code == 200
    forest = resp.json()
    # root could be the parent; ensure child attached under parent
    root = next((n for n in forest if n["id"] == parent["id"]), None)
    assert root is not None
    assert any(c["id"] == child["id"] for c in root["children"]) is True

    # Delete child then parent
    assert client.delete(f"/api/v2/accounts/{child['id']}").status_code == 204
    assert client.delete(f"/api/v2/accounts/{parent['id']}").status_code == 204
