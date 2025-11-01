
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
    group_id = group_resp.json()["id"]

    category_resp = client.post(
        "/api/categories",
        json={
            "user_id": 1,
            "group_id": group_id,
            "code_cc": code_cc,
            "name": name,
        },
    )
    assert category_resp.status_code == 201, category_resp.text
    return category_resp.json()


def test_statistics_presets_crud(client):
    groceries = _create_category(client, "E", 10, 1, "식비")
    transport = _create_category(client, "E", 11, 1, "교통")

    create_resp = client.post(
        "/api/statistics/presets",
        json={
            "user_id": 1,
            "name": "관심 지출",
            "memo": "월간 체크",
            "selected_category_ids": [groceries["id"], transport["id"], groceries["id"]],
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    preset = create_resp.json()
    assert preset["name"] == "관심 지출"
    assert preset["memo"] == "월간 체크"
    assert preset["selected_category_ids"] == sorted({groceries["id"], transport["id"]})

    list_resp = client.get("/api/statistics/presets", params={"user_id": 1})
    assert list_resp.status_code == 200, list_resp.text
    items = list_resp.json()
    assert any(item["id"] == preset["id"] for item in items)

    update_resp = client.put(
        f"/api/statistics/presets/{preset['id']}",
        params={"user_id": 1},
        json={
            "name": "업데이트된 지출",
            "memo": "",
            "selected_category_ids": [transport["id"]],
        },
    )
    assert update_resp.status_code == 200, update_resp.text
    updated = update_resp.json()
    assert updated["name"] == "업데이트된 지출"
    assert updated["memo"] is None
    assert updated["selected_category_ids"] == [transport["id"]]

    delete_resp = client.delete(
        f"/api/statistics/presets/{preset['id']}",
        params={"user_id": 1},
    )
    assert delete_resp.status_code == 204, delete_resp.text

    after_delete = client.get("/api/statistics/presets", params={"user_id": 1})
    assert after_delete.status_code == 200
    assert all(item["id"] != preset["id"] for item in after_delete.json())


def test_statistics_preset_validation(client):
    invalid_resp = client.post(
        "/api/statistics/presets",
        json={
            "user_id": 1,
            "name": "잘못된",
            "selected_category_ids": [9999],
        },
    )
    assert invalid_resp.status_code == 400

    groceries = _create_category(client, "E", 12, 1, "식재료")

    first = client.post(
        "/api/statistics/presets",
        json={
            "user_id": 1,
            "name": "중복",
            "selected_category_ids": [groceries["id"]],
        },
    )
    assert first.status_code == 201, first.text

    duplicate = client.post(
        "/api/statistics/presets",
        json={
            "user_id": 1,
            "name": "중복",
            "selected_category_ids": [groceries["id"]],
        },
    )
    assert duplicate.status_code == 409

    target_id = first.json()["id"]

    missing = client.put(
        f"/api/statistics/presets/{target_id}",
        params={"user_id": 1},
        json={"selected_category_ids": [groceries["id"], 7777]},
    )
    assert missing.status_code == 400

    not_found = client.delete(
        "/api/statistics/presets/9999",
        params={"user_id": 1},
    )
    assert not_found.status_code == 404
