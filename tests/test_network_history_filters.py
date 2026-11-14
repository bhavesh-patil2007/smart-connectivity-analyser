from datetime import datetime, timedelta

import pytest

from test_network_test_validation import VALID_TEST, post_test


def save_history_record(client, timestamp, score):
    payload = {
        **VALID_TEST,
        "timestamp": timestamp,
        "connectivity_score": score,
    }

    response = post_test(client, payload)

    assert response.status_code == 200
    return response


def test_date_range_includes_both_boundary_dates(client):
    timestamps = [
        "2026-11-01T00:00:00.000Z",
        "2026-11-03T12:00:00.000Z",
        "2026-11-05T23:59:59.999Z",
        "2026-11-06T00:00:00.000Z",
    ]

    for index, timestamp in enumerate(timestamps):
        save_history_record(client, timestamp, 60 + index)

    response = client.get(
        "/api/network-history",
        params={
            "start_date": "2026-11-01",
            "end_date": "2026-11-05",
        },
    )

    assert response.status_code == 200

    results = response.json()

    assert len(results) == 3
    assert [record["timestamp"] for record in results] == timestamps[:3]



def test_connectivity_score_filter_includes_boundaries(client):
    scores = [59, 60, 75, 90, 91, None]

    # Generate timestamps within the existing 24-hour history window.
    base_time = datetime.now().replace(microsecond=0) - timedelta(
        minutes=len(scores) - 1
    )

    for index, score in enumerate(scores):
        timestamp = (
            base_time + timedelta(minutes=index)
        ).isoformat()

        save_history_record(
            client,
            timestamp,
            score,
        )

    response = client.get(
        "/api/network-history",
        params={
            "min_score": 60,
            "max_score": 90,
        },
    )

    assert response.status_code == 200

    returned_scores = [
        record["connectivity_score"]
        for record in response.json()
    ]

    assert returned_scores == [60, 75, 90]



def test_date_and_score_filters_work_together(client):
    records = [
        ("2026-11-01T10:00:00.000Z", 80),
        ("2026-11-02T10:00:00.000Z", 50),
        ("2026-11-03T10:00:00.000Z", 85),
        ("2026-11-04T10:00:00.000Z", 95),
        ("2026-11-06T10:00:00.000Z", 90),
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
        },
    )

    assert response.status_code == 200

    results = response.json()

    assert len(results) == 2
    assert [record["connectivity_score"] for record in results] == [
        80,
        85,
    ]


def test_start_date_can_be_used_without_end_date(client):
    save_history_record(
        client,
        "2026-11-02T10:00:00.000Z",
        70,
    )
    save_history_record(
        client,
        "2026-11-04T10:00:00.000Z",
        80,
    )

    response = client.get(
        "/api/network-history",
        params={"start_date": "2026-11-03"},
    )

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["connectivity_score"] == 80


def test_end_date_can_be_used_without_start_date(client):
    save_history_record(
        client,
        "2026-11-02T10:00:00.000Z",
        70,
    )
    save_history_record(
        client,
        "2026-11-04T10:00:00.000Z",
        80,
    )

    response = client.get(
        "/api/network-history",
        params={"end_date": "2026-11-03"},
    )

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["connectivity_score"] == 70


def test_reversed_date_range_is_rejected(client):
    response = client.get(
        "/api/network-history",
        params={
            "start_date": "2026-11-05",
            "end_date": "2026-11-01",
        },
    )

    assert response.status_code == 422
    assert "start_date must be on or before end_date" in response.json()["detail"]


def test_reversed_score_range_is_rejected(client):
    response = client.get(
        "/api/network-history",
        params={
            "min_score": 90,
            "max_score": 50,
        },
    )

    assert response.status_code == 422
    assert "min_score must be less than or equal to max_score" in response.json()["detail"]


@pytest.mark.parametrize(
    "params",
    [
        {"start_date": "not-a-date"},
        {"end_date": "2026-13-01"},
        {"min_score": -1},
        {"max_score": 101},
    ],
)
def test_invalid_filter_inputs_are_rejected(client, params):
    response = client.get(
        "/api/network-history",
        params=params,
    )

    assert response.status_code == 422


def test_filters_return_empty_list_when_no_records_match(client):
    save_history_record(
        client,
        "2026-11-03T10:00:00.000Z",
        40,
    )

    response = client.get(
        "/api/network-history",
        params={
            "min_score": 80,
            "max_score": 100,
        },
    )

    assert response.status_code == 200
    assert response.json() == []

def test_all_range_returns_complete_history(client):
    save_history_record(
        client,
        "2020-01-01T10:00:00.000Z",
        85,
    )

    response = client.get(
        "/api/network-history",
        params={"range": "all"},
    )

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["connectivity_score"] == 85
@pytest.mark.parametrize(
    "range_value, outside_window, inside_window",
    [
        ("1h", timedelta(hours=2), timedelta(minutes=30)),
        ("24h", timedelta(hours=30), timedelta(hours=12)),
        ("7d", timedelta(days=8), timedelta(days=3)),
        # Compatibility range values must keep their existing windows.
        ("hourly", timedelta(hours=30), timedelta(hours=12)),
        ("daily", timedelta(days=8), timedelta(days=3)),
        ("weekly", timedelta(days=31), timedelta(days=15)),
        ("monthly", timedelta(days=366), timedelta(days=30)),
    ],
)
def test_history_time_ranges_filter_correctly(
    client,
    range_value,
    outside_window,
    inside_window,
):
    now = datetime.now().replace(microsecond=0)

    older_timestamp = (
        now - outside_window
    ).isoformat()

    recent_timestamp = (
        now - inside_window
    ).isoformat()

    save_history_record(
        client,
        older_timestamp,
        40,
    )

    save_history_record(
        client,
        recent_timestamp,
        80,
    )

    response = client.get(
        "/api/network-history",
        params={"range": range_value},
    )

    assert response.status_code == 200

    results = response.json()

    assert len(results) == 1
    assert results[0]["connectivity_score"] == 80


def test_recent_range_preserves_existing_behavior(client):
    now = datetime.now().replace(microsecond=0)

    save_history_record(
        client,
        (now - timedelta(hours=30)).isoformat(),
        40,
    )

    save_history_record(
        client,
        (now - timedelta(hours=2)).isoformat(),
        80,
    )

    response = client.get(
        "/api/network-history",
        params={"range": "recent"},
    )

    assert response.status_code == 200

    results = response.json()

    assert len(results) == 1
    assert results[0]["connectivity_score"] == 80


def test_all_range_includes_recent_and_old_history(client):
    now = datetime.now().replace(microsecond=0)

    save_history_record(
        client,
        "2020-01-01T10:00:00",
        40,
    )

    save_history_record(
        client,
        now.isoformat(),
        80,
    )

    response = client.get(
        "/api/network-history",
        params={"range": "all"},
    )

    assert response.status_code == 200

    results = response.json()

    assert len(results) == 2

    assert [
        record["connectivity_score"]
        for record in results
    ] == [40, 80]



def test_unsupported_range_is_rejected(client):
    response = client.get("/api/network-history?range=bogus")

    assert response.status_code == 422
    assert "Unsupported range" in response.json()["detail"]


@pytest.mark.parametrize(
    "params",
    [
        {"range": "bogus", "start_date": "2026-11-01"},
        {"range": "bogus", "end_date": "2026-11-05"},
    ],
)
def test_unsupported_range_with_custom_dates_is_rejected(client, params):
    response = client.get("/api/network-history", params=params)

    assert response.status_code == 422
    assert "Unsupported range" in response.json()["detail"]


@pytest.mark.parametrize(
    "range_value",
    [
        "all", "recent", "1h", "24h", "7d",
        "hourly", "daily", "weekly", "monthly",
    ],
)
def test_supported_range_values_are_accepted(client, range_value):
    response = client.get(f"/api/network-history?range={range_value}")

    assert response.status_code == 200
