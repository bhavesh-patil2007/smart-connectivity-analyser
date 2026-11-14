from fastapi import HTTPException


def test_ai_analyze_returns_both_successful_results_and_runs_once(client, monkeypatch):
    prediction = {
        "success": True,
        "predicted_connectivity_score": 82.5,
        "predicted_quality": "Good",
        "model": "HistGradientBoosting",
    }
    anomaly = {
        "success": True,
        "anomaly": False,
        "reconstruction_error": 0.01,
    }
    calls = {"prediction": 0, "anomaly": 0}

    def predict():
        calls["prediction"] += 1
        return prediction

    def detect_anomaly():
        calls["anomaly"] += 1
        return anomaly

    monkeypatch.setattr("backend.main.ai_prediction", predict)
    monkeypatch.setattr("backend.main.ai_anomaly", detect_anomaly)

    response = client.get("/api/ai/analyze")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["available"] is True
    assert payload["status"] == "success"

    # Existing successful component fields remain directly accessible.
    assert payload["prediction"]["predicted_connectivity_score"] == 82.5
    assert payload["prediction"]["predicted_quality"] == "Good"
    assert payload["anomaly"]["anomaly"] is False

    # The normalized envelope is additive rather than replacing the old fields.
    assert payload["prediction"]["data"] == prediction
    assert payload["anomaly"]["data"] == anomaly
    assert payload["prediction"]["error"] is None
    assert payload["anomaly"]["error"] is None
    assert calls == {"prediction": 1, "anomaly": 1}


def test_ai_analyze_preserves_anomaly_when_prediction_is_unavailable(client, monkeypatch):
    anomaly = {
        "success": True,
        "anomaly": True,
        "reconstruction_error": 0.25,
    }
    calls = {"prediction": 0, "anomaly": 0}

    def fail_prediction():
        calls["prediction"] += 1
        raise HTTPException(
            status_code=503,
            detail="Prediction model unavailable at /internal/model/path",
        )

    def detect_anomaly():
        calls["anomaly"] += 1
        return anomaly

    monkeypatch.setattr("backend.main.ai_prediction", fail_prediction)
    monkeypatch.setattr("backend.main.ai_anomaly", detect_anomaly)

    response = client.get("/api/ai/analyze")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is False
    assert payload["available"] is True
    assert payload["status"] == "partial_success"
    assert payload["prediction"]["success"] is False
    assert payload["prediction"]["data"] is None
    assert payload["prediction"]["error"] == {
        "code": "analysis_unavailable",
        "message": "The AI analysis component is currently unavailable.",
        "status_code": 503,
    }
    assert payload["anomaly"]["success"] is True
    assert payload["anomaly"]["anomaly"] is True
    assert payload["anomaly"]["data"] == anomaly
    assert calls == {"prediction": 1, "anomaly": 1}
    assert "/internal/model/path" not in response.text


def test_ai_analyze_preserves_prediction_when_anomaly_fails(client, monkeypatch):
    prediction = {
        "success": True,
        "predicted_connectivity_score": 77.0,
        "predicted_quality": "Good",
    }

    def fail_anomaly():
        raise HTTPException(
            status_code=500,
            detail="Anomaly analysis failed: secret path /srv/private/model",
        )

    monkeypatch.setattr("backend.main.ai_prediction", lambda: prediction)
    monkeypatch.setattr("backend.main.ai_anomaly", fail_anomaly)

    response = client.get("/api/ai/analyze")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is False
    assert payload["available"] is True
    assert payload["status"] == "partial_success"
    assert payload["prediction"]["success"] is True
    assert payload["prediction"]["predicted_connectivity_score"] == 77.0
    assert payload["prediction"]["data"] == prediction
    assert payload["anomaly"]["success"] is False
    assert payload["anomaly"]["data"] is None
    assert payload["anomaly"]["error"] == {
        "code": "analysis_failed",
        "message": "The analysis could not be completed due to an internal error.",
        "status_code": 500,
    }
    assert "/srv/private/model" not in response.text


def test_ai_analyze_reports_total_failure_with_sanitized_errors(client, monkeypatch):
    def fail_prediction():
        raise HTTPException(
            status_code=503,
            detail="Prediction unavailable: /private/predictor",
        )

    def fail_anomaly():
        raise HTTPException(
            status_code=503,
            detail="Anomaly unavailable: /private/anomaly",
        )

    monkeypatch.setattr("backend.main.ai_prediction", fail_prediction)
    monkeypatch.setattr("backend.main.ai_anomaly", fail_anomaly)

    response = client.get("/api/ai/analyze")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is False
    assert payload["available"] is False
    assert payload["status"] == "failure"
    assert payload["prediction"]["success"] is False
    assert payload["anomaly"]["success"] is False
    assert payload["prediction"]["error"]["message"] == (
        "The AI analysis component is currently unavailable."
    )
    assert payload["anomaly"]["error"]["message"] == (
        "The AI analysis component is currently unavailable."
    )
    assert "/private/" not in response.text


def test_ai_analyze_sanitizes_unexpected_exception(client, monkeypatch):
    prediction = {
        "success": True,
        "predicted_connectivity_score": 90.0,
    }

    def fail_anomaly():
        raise RuntimeError("private path /srv/app/secrets/internal")

    monkeypatch.setattr("backend.main.ai_prediction", lambda: prediction)
    monkeypatch.setattr("backend.main.ai_anomaly", fail_anomaly)

    response = client.get("/api/ai/analyze")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "partial_success"
    assert payload["prediction"]["data"] == prediction
    assert payload["anomaly"]["error"] == {
        "code": "analysis_failed",
        "message": "The analysis could not be completed due to an internal error.",
        "status_code": 500,
    }
    assert "private path" not in response.text
