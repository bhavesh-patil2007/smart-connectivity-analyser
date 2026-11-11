from fastapi import HTTPException


def test_ai_analyze_returns_both_successful_results(client, monkeypatch):
    prediction = {"score": 82.5, "model": "HistGradientBoosting"}
    anomaly = {"anomaly": False, "reconstruction_error": 0.01}

    monkeypatch.setattr("backend.main.ai_prediction", lambda: prediction)
    monkeypatch.setattr("backend.main.ai_anomaly", lambda: anomaly)

    response = client.get("/api/ai/analyze")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["available"] is True
    assert payload["status"] == "success"
    assert payload["prediction"] == {
        "success": True,
        "data": prediction,
        "error": None,
    }
    assert payload["anomaly"] == {
        "success": True,
        "data": anomaly,
        "error": None,
    }


def test_ai_analyze_preserves_anomaly_when_prediction_fails(client, monkeypatch):
    anomaly = {"anomaly": True, "reconstruction_error": 0.25}

    def fail_prediction():
        raise HTTPException(status_code=503, detail="Prediction model unavailable")

    monkeypatch.setattr("backend.main.ai_prediction", fail_prediction)
    monkeypatch.setattr("backend.main.ai_anomaly", lambda: anomaly)

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
        "message": "Prediction model unavailable",
        "status_code": 503,
    }
    assert payload["anomaly"]["success"] is True
    assert payload["anomaly"]["data"] == anomaly


def test_ai_analyze_preserves_prediction_when_anomaly_fails(client, monkeypatch):
    prediction = {"score": 77.0, "model": "HistGradientBoosting"}

    def fail_anomaly():
        raise HTTPException(status_code=500, detail="Anomaly analysis failed")

    monkeypatch.setattr("backend.main.ai_prediction", lambda: prediction)
    monkeypatch.setattr("backend.main.ai_anomaly", fail_anomaly)

    response = client.get("/api/ai/analyze")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is False
    assert payload["available"] is True
    assert payload["status"] == "partial_success"
    assert payload["prediction"]["success"] is True
    assert payload["prediction"]["data"] == prediction
    assert payload["anomaly"]["success"] is False
    assert payload["anomaly"]["data"] is None
    assert payload["anomaly"]["error"] == {
        "code": "analysis_failed",
        "message": "Anomaly analysis failed",
        "status_code": 500,
    }


def test_ai_analyze_reports_total_failure(client, monkeypatch):
    def fail_prediction():
        raise HTTPException(status_code=503, detail="Prediction unavailable")

    def fail_anomaly():
        raise HTTPException(status_code=503, detail="Anomaly unavailable")

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
    assert payload["prediction"]["error"]["message"] == "Prediction unavailable"
    assert payload["anomaly"]["error"]["message"] == "Anomaly unavailable"


def test_ai_analyze_sanitizes_unexpected_exception(client, monkeypatch):
    prediction = {"score": 90.0}

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
