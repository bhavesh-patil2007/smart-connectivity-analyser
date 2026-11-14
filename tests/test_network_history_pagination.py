from test_network_test_validation import VALID_TEST, post_test


def save_history_record(client, timestamp, score, download_mbps=54.2):
    payload = {
        **VALID_TEST,
        "timestamp": timestamp,
        "connectivity_score": score,
        "download_mbps": download_mbps,
    }

    response = post_test(client, payload)
    assert response.status_code == 200
    return response.json()["id"]


def test_pagination_returns_ordered_pages_without_duplicates(client):
    timestamp = "2026-11-01T10:00:00.000Z"
    inserted_ids = [
        save_history_record(client, timestamp, 60 + index, 10 + index)
        for index in range(5)
    ]

    pages = []
    for offset in (0, 2, 4):
        response = client.get(
            "/api/network-history",
            params={
                "range": "all",
                "limit": 2,
                "offset": offset,
            },
        )

        assert response.status_code == 200
        payload = response.json()
        pages.extend(record["id"] for record in payload["data"])

        pagination = payload["pagination"]
        assert pagination["limit"] == 2
        assert pagination["offset"] == offset
        assert pagination["total"] == 5
        assert pagination["has_more"] is (offset < 4)
        assert pagination["next_offset"] == (
            offset + 2 if offset < 4 else None
        )

    assert pages == inserted_ids

    assert response.json()["pagination"] == {
        "limit": 2,
        "offset": 4,
        "total": 5,
        "has_more": False,
        "next_offset": None,
    }


def test_pagination_uses_default_limit_when_only_offset_is_supplied(client):
    for index in range(3):
        save_history_record(
            client,
            f"2026-11-0{index + 1}T10:00:00.000Z",
            60 + index,
        )

    response = client.get(
        "/api/network-history",
        params={"range": "all", "offset": 1},
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["data"]) == 2
    assert payload["pagination"] == {
        "limit": 100,
        "offset": 1,
        "total": 3,
        "has_more": False,
        "next_offset": None,
    }


def test_pagination_applies_date_and_score_filters_before_slicing(client):
    records = [
        ("2026-11-01T10:00:00.000Z", 70),
        ("2026-11-02T10:00:00.000Z", 80),
        ("2026-11-03T10:00:00.000Z", 90),
        ("2026-11-04T10:00:00.000Z", 95),
    ]

    for timestamp, score in records:
        save_history_record(client, timestamp, score)

    response = client.get(
        "/api/network-history",
        params={
            "start_date": "2026-11-01",
            "end_date": "2026-11-04",
            "min_score": 60,
            "max_score": 90,
            "limit": 1,
            "offset": 1,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert [record["connectivity_score"] for record in payload["data"]] == [80]
    assert payload["pagination"] == {
        "limit": 1,
        "offset": 1,
        "total": 3,
        "has_more": True,
        "next_offset": 2,
    }


def test_pagination_returns_empty_page_when_offset_exceeds_total(client):
    save_history_record(client, "2026-11-01T10:00:00.000Z", 80)

    response = client.get(
        "/api/network-history",
        params={"range": "all", "limit": 10, "offset": 5},
    )

    assert response.status_code == 200
    assert response.json() == {
        "data": [],
        "pagination": {
            "limit": 10,
            "offset": 5,
            "total": 1,
            "has_more": False,
            "next_offset": None,
        },
    }


def test_requests_without_pagination_keep_the_legacy_list_response(client):
    save_network_ids = [
        save_history_record(
            client,
            f"2026-11-0{index + 1}T10:00:00.000Z",
            70 + index,
        )
        for index in range(3)
    ]

    response = client.get(
        "/api/network-history",
        params={"range": "all"},
    )

    assert response.status_code == 200
    assert isinstance(response.json(), list)
    assert [record["id"] for record in response.json()] == save_network_ids


def test_pagination_uses_record_id_as_timestamp_tie_breaker(client):
    timestamp = "2026-11-01T10:00:00.000Z"
    inserted_ids = [
        save_history_record(client, timestamp, 70 + index)
        for index in range(3)
    ]

    first_page = client.get(
        "/api/network-history",
        params={"range": "all", "limit": 2, "offset": 0},
    ).json()
    second_page = client.get(
        "/api/network-history",
        params={"range": "all", "limit": 2, "offset": 2},
    ).json()

    paged_ids = [
        record["id"]
        for record in first_page["data"] + second_page["data"]
    ]
    assert paged_ids == inserted_ids


def test_invalid_pagination_parameters_are_rejected(client):
    invalid_parameters = [
        {"limit": 0},
        {"limit": -1},
        {"limit": 501},
        {"offset": -1},
    ]

    for params in invalid_parameters:
        response = client.get(
            "/api/network-history",
            params={"range": "all", **params},
        )
        assert response.status_code == 422



def test_pagination_uses_first_page_when_only_limit_is_supplied(client):
    inserted_ids = [
        save_history_record(
            client,
            f"2026-11-0{index + 1}T10:00:00.000Z",
            70 + index,
        )
        for index in range(4)
    ]

    response = client.get(
        "/api/network-history",
        params={"range": "all", "limit": 2},
    )

    assert response.status_code == 200
    payload = response.json()
    assert [record["id"] for record in payload["data"]] == inserted_ids[:2]
    assert payload["pagination"] == {
        "limit": 2,
        "offset": 0,
        "total": 4,
        "has_more": True,
        "next_offset": 2,
    }


def test_pagination_handles_unusually_large_offset(client):
    save_history_record(client, "2026-11-01T10:00:00.000Z", 80)

    response = client.get(
        "/api/network-history",
        params={
            "range": "all",
            "limit": 25,
            "offset": 1_000_000,
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "data": [],
        "pagination": {
            "limit": 25,
            "offset": 1_000_000,
            "total": 1,
            "has_more": False,
            "next_offset": None,
        },
    }

def test_database_connections_close_after_paginated_and_legacy_responses(
    client,
    monkeypatch,
):
    import backend.main as main

    save_history_record(
        client,
        "2026-11-01T10:00:00.000Z",
        80,
    )

    original_get_connection = main.get_connection
    tracked_connections = []

    class TrackingConnection:
        def __init__(self):
            self.connection = original_get_connection()
            self.closed = False

        def __getattr__(self, name):
            return getattr(self.connection, name)

        def close(self):
            self.closed = True
            self.connection.close()

    def get_tracking_connection():
        connection = TrackingConnection()
        tracked_connections.append(connection)
        return connection

    monkeypatch.setattr(main, "get_connection", get_tracking_connection)

    paginated = client.get(
        "/api/network-history",
        params={"range": "all", "limit": 1},
    )
    legacy = client.get(
        "/api/network-history",
        params={"range": "all"},
    )

    assert paginated.status_code == 200
    assert legacy.status_code == 200
    assert len(tracked_connections) == 2
    assert all(connection.closed for connection in tracked_connections)
