from fastapi import FastAPI, HTTPException, Query

from fastapi.encoders import jsonable_encoder

from fastapi.exceptions import RequestValidationError

from fastapi.middleware.cors import CORSMiddleware

from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from pathlib import Path

import sqlite3
import json
import math
import sys

import subprocess

import re

import statistics
from datetime import date, datetime, timedelta

# ============================================================
# AI MODEL IMPORTS
# ============================================================

AI_BACKEND_DIR = Path(__file__).resolve().parent
if str(AI_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(AI_BACKEND_DIR))

try:
    import torch
    from ai_engine import (
        FEATURES,
        SEQUENCE_LENGTH,
        ConnectivityPredictor,
        TransformerAutoencoder,
        load_network_data,
        normalize_values,
        denormalize_value,
    )
    from final_predictor import (
        final_predictor,
        FINAL_PREDICTOR_READY,
    )
except Exception as error:
    torch = None
    AI_IMPORT_ERROR = str(error)
    FEATURES = ()
    SEQUENCE_LENGTH = 8
    ConnectivityPredictor = None
    TransformerAutoencoder = None
    load_network_data = lambda: []
    normalize_values = None
    denormalize_value = None
    final_predictor = None
    FINAL_PREDICTOR_READY = False
else:
    AI_IMPORT_ERROR = None






# ============================================================

# APPLICATION

# ============================================================



app = FastAPI(

    title="Smart Internet Connectivity Analyser",

    version="1.0.0"

)





app.add_middleware(

    CORSMiddleware,

    allow_origins=["*"],

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"],

)



# ============================================================
# VALIDATION ERRORS
# ============================================================

def make_json_safe(value):
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)

    if isinstance(value, dict):
        return {key: make_json_safe(item) for key, item in value.items()}

    if isinstance(value, list):
        return [make_json_safe(item) for item in value]

    return value


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    # Same response as FastAPI's default handler. Rejected NaN or
    # Infinity inputs are echoed as strings, since they cannot be
    # encoded as JSON and would otherwise cause a 500 error.
    return JSONResponse(
        status_code=422,
        content={"detail": make_json_safe(jsonable_encoder(exc.errors()))},
    )





# ============================================================

# PATHS

# ============================================================



BASE_DIR = Path(__file__).resolve().parent.parent



DB_PATH = BASE_DIR / "network_history.db"



INDEX_FILE = BASE_DIR / "index.html"


# ============================================================
# STATIC FRONTEND FILES
# ============================================================

CSS_DIR = BASE_DIR / "css"
JS_DIR = BASE_DIR / "js"

app.mount(
    "/css",
    StaticFiles(directory=str(CSS_DIR)),
    name="css"
)

app.mount(
    "/js",
    StaticFiles(directory=str(JS_DIR)),
    name="js"
)



# ============================================================
# AI MODEL STATE
# ============================================================

AI_MODEL_DIR = BASE_DIR / "backend" / "models"
AI_PREDICTION_MODEL_PATH = AI_MODEL_DIR / "connectivity_predictor.pt"
AI_ANOMALY_MODEL_PATH = AI_MODEL_DIR / "anomaly_autoencoder.pt"
AI_SCALER_PATH = AI_MODEL_DIR / "scaler.json"

ai_prediction_model = None
ai_anomaly_model = None
ai_scaler = None
ai_anomaly_threshold = None


def load_ai_models():
    global ai_prediction_model
    global ai_anomaly_model
    global ai_scaler
    global ai_anomaly_threshold

    if torch is None:
        return False, f"PyTorch/AI import failed: {AI_IMPORT_ERROR}"

    required = [
        AI_ANOMALY_MODEL_PATH,
        AI_SCALER_PATH,
    ]

    missing = [str(path) for path in required if not path.exists()]
    if missing:
        return False, f"Missing AI files: {', '.join(missing)}"

    try:
        with open(AI_SCALER_PATH, "r", encoding="utf-8") as file:
            ai_scaler = json.load(file)

        ai_anomaly_model = TransformerAutoencoder()
        ai_anomaly_model.load_state_dict(
            torch.load(
                AI_ANOMALY_MODEL_PATH,
                map_location="cpu",
                weights_only=True,
            )
        )
        ai_anomaly_model.eval()

        # Establish an anomaly threshold from reconstruction errors
        # on the same real measurements used during training.
        data = load_network_data()
        errors = []

        with torch.no_grad():
            for item in data:
                normalized = normalize_values(item["values"], ai_scaler)
                sample = torch.tensor(
                    normalized,
                    dtype=torch.float32,
                ).reshape(1, 1, len(FEATURES))

                reconstructed = ai_anomaly_model(sample)
                target = sample[:, -1, :]
                error_value = torch.mean(
                    (reconstructed - target) ** 2
                ).item()
                errors.append(error_value)

        if errors:
            mean_error = sum(errors) / len(errors)
            variance = sum(
                (value - mean_error) ** 2
                for value in errors
            ) / len(errors)
            ai_anomaly_threshold = (
                mean_error + 2.0 * math.sqrt(variance)
            )
        else:
            ai_anomaly_threshold = 0.05

        return True, "AI anomaly model and final prediction model loaded successfully."

    except Exception as error:
        ai_prediction_model = None
        ai_anomaly_model = None
        ai_scaler = None
        ai_anomaly_threshold = None
        return False, f"AI model loading failed: {error}"



# ============================================================

# DATABASE

# ============================================================



def get_connection():

    connection = sqlite3.connect(DB_PATH)



    connection.row_factory = sqlite3.Row



    return connection





def initialize_database():



    connection = get_connection()



    cursor = connection.cursor()



    cursor.execute(

        """

        CREATE TABLE IF NOT EXISTS network_tests (

            id INTEGER PRIMARY KEY AUTOINCREMENT,



            timestamp TEXT NOT NULL,



            download_mbps REAL,



            upload_mbps REAL,



            ping_ms REAL,



            jitter_ms REAL,



            packet_loss REAL,



            network_type TEXT,



            connectivity_score REAL,



            latitude REAL,



            longitude REAL

        )

        """

    )



    connection.commit()



    connection.close()





initialize_database()
AI_MODELS_READY, AI_MODELS_MESSAGE = load_ai_models()




# ============================================================

# DATA MODEL

# ============================================================



MEASUREMENT_FIELDS = (
    "download_mbps",
    "upload_mbps",
    "ping_ms",
    "jitter_ms",
    "packet_loss",
    "connectivity_score",
)


class NetworkTest(BaseModel):

    # Reject NaN and Infinity. They cannot be stored or returned
    # as valid JSON, and would break /api/network-history.
    model_config = ConfigDict(allow_inf_nan=False)



    timestamp: str | None = None



    download_mbps: float | None = Field(default=None, ge=0)



    upload_mbps: float | None = Field(default=None, ge=0)



    ping_ms: float | None = Field(default=None, ge=0)



    jitter_ms: float | None = Field(default=None, ge=0)



    packet_loss: float | None = Field(default=None, ge=0, le=100)



    network_type: str | None = Field(default="Unknown", max_length=50)



    connectivity_score: float | None = Field(default=None, ge=0, le=100)



    latitude: float | None = Field(default=None, ge=-90, le=90)



    longitude: float | None = Field(default=None, ge=-180, le=180)



    # Pydantic would otherwise store true/false as 1.0/0.0.
    @field_validator(
        *MEASUREMENT_FIELDS,
        "latitude",
        "longitude",
        mode="before",
    )
    @classmethod
    def reject_boolean_values(cls, value):
        if isinstance(value, bool):
            raise ValueError("Input should be a number, not a boolean")

        return value


    @field_validator("timestamp")
    @classmethod
    def validate_timestamp(cls, value):
        if value is None or not value.strip():
            return None

        try:
            # Python < 3.11 does not accept a trailing "Z".
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError(
                "timestamp must be an ISO 8601 date-time string"
            )

        # Keep the original string so stored values are unchanged.
        return value


    @model_validator(mode="after")
    def validate_record(self):
        if all(getattr(self, field) is None for field in MEASUREMENT_FIELDS):
            raise ValueError(
                "At least one network measurement is required: "
                + ", ".join(MEASUREMENT_FIELDS)
            )

        if (self.latitude is None) != (self.longitude is None):
            raise ValueError(
                "latitude and longitude must be provided together"
            )

        return self





# ============================================================

# ROOT

# ============================================================



@app.get("/")

def root():



    if INDEX_FILE.exists():

        return FileResponse(INDEX_FILE)



    return {

        "message": "Smart Internet Connectivity Analyser API"

    }





# ============================================================

# HEALTH CHECK

# ============================================================



@app.get("/api/health")

def health():



    return {

        "status": "ok",

        "service": "Smart Internet Connectivity Analyser"

    }





# ============================================================

# SIMPLE PING

# ============================================================



@app.get("/api/ping")

def ping():



    return {

        "message": "Backend is running",

        "status": "ok"

    }





# ============================================================

# NETWORK QUALITY

# WINDOWS PING

# ============================================================



@app.get("/api/network-quality")

def network_quality():



    target = "1.1.1.1"



    packet_count = 10



    timeout_ms = 2000



    command = [

        "ping",

        target,

        "-n",

        str(packet_count),

        "-w",

        str(timeout_ms)

    ]



    try:



        process = subprocess.run(

            command,

            capture_output=True,

            text=True,

            timeout=30

        )



        output = process.stdout



    except subprocess.TimeoutExpired:



        raise HTTPException(

            status_code=504,

            detail="Ping measurement timed out."

        )



    except Exception as error:



        raise HTTPException(

            status_code=500,

            detail=f"Ping measurement failed: {error}"

        )





    # ========================================================

    # PARSE INDIVIDUAL PING TIMES

    # ========================================================



    ping_times = []



    matches = re.findall(

        r"time[=<]\s*(\d+)\s*ms",

        output,

        re.IGNORECASE

    )





    for match in matches:



        try:



            ping_times.append(

                float(match)

            )



        except ValueError:

            pass





    # ========================================================

    # PACKET LOSS

    # ========================================================



    loss_match = re.search(

        r"\((\d+)%\s*loss\)",

        output,

        re.IGNORECASE

    )





    if loss_match:



        packet_loss = float(

            loss_match.group(1)

        )



    else:



        packet_loss = (

            (

                packet_count -

                len(ping_times)

            )

            / packet_count

        ) * 100





    # ========================================================

    # NO RESPONSE

    # ========================================================



    if len(ping_times) == 0:



        return {

            "target": target,

            "packets_sent": packet_count,

            "packets_received": 0,

            "packet_loss": 100.0,

            "ping_ms": None,

            "min_ping_ms": None,

            "max_ping_ms": None,

            "jitter_ms": None,

            "status": "unreachable"

        }





    # ========================================================

    # PING STATISTICS

    # ========================================================



    average_ping = statistics.mean(

        ping_times

    )



    minimum_ping = min(

        ping_times

    )



    maximum_ping = max(

        ping_times

    )





    # ========================================================

    # JITTER

    #

    # Mean absolute difference between consecutive

    # successful ping measurements.

    # ========================================================



    if len(ping_times) >= 2:



        differences = []



        for i in range(

            1,

            len(ping_times)

        ):



            difference = abs(

                ping_times[i] -

                ping_times[i - 1]

            )



            differences.append(

                difference

            )





        jitter = statistics.mean(

            differences

        )



    else:



        jitter = 0.0





    # ========================================================

    # STATUS

    # ========================================================



    if average_ping <= 50:



        status = "excellent"



    elif average_ping <= 100:



        status = "good"



    elif average_ping <= 200:



        status = "average"



    else:



        status = "poor"





    return {



        "target": target,



        "packets_sent": packet_count,



        "packets_received": len(

            ping_times

        ),



        "packet_loss": round(

            packet_loss,

            2

        ),



        "ping_ms": round(

            average_ping,

            2

        ),



        "min_ping_ms": round(

            minimum_ping,

            2

        ),



        "max_ping_ms": round(

            maximum_ping,

            2

        ),



        "jitter_ms": round(

            jitter,

            2

        ),



        "samples": ping_times,



        "status": status

    }





# ============================================================

# SAVE NETWORK TEST

# ============================================================



@app.post("/api/network-test")

def save_network_test(data: NetworkTest):



    timestamp = (

        data.timestamp

        or datetime.now().isoformat()

    )





    connection = get_connection()



    cursor = connection.cursor()





    cursor.execute(

        """

        INSERT INTO network_tests (

            timestamp,

            download_mbps,

            upload_mbps,

            ping_ms,

            jitter_ms,

            packet_loss,

            network_type,

            connectivity_score,

            latitude,

            longitude

        )



        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

        """,



        (

            timestamp,



            data.download_mbps,



            data.upload_mbps,



            data.ping_ms,



            data.jitter_ms,



            data.packet_loss,



            data.network_type,



            data.connectivity_score,



            data.latitude,



            data.longitude

        )

    )





    connection.commit()



    test_id = cursor.lastrowid



    connection.close()





    return {



        "status": "success",



        "message": "Network test saved",



        "id": test_id

    }





# ============================================================

# NETWORK HISTORY

# ============================================================




@app.get("/api/network-history")
def get_network_history(
    range: str = "recent",
    start_date: date | None = None,
    end_date: date | None = None,
    min_score: float | None = Query(default=None, ge=0, le=100),
    max_score: float | None = Query(default=None, ge=0, le=100),
):
    # Validate date range.
    if (
        start_date is not None
        and end_date is not None
        and start_date > end_date
    ):
        raise HTTPException(
            status_code=422,
            detail="start_date must be on or before end_date",
        )

    # Validate connectivity score range.
    if (
        min_score is not None
        and max_score is not None
        and min_score > max_score
    ):
        raise HTTPException(
            status_code=422,
            detail="min_score must be less than or equal to max_score",
        )

    connection = get_connection()

    try:
        cursor = connection.cursor()

        conditions = []
        parameters = []

        # Preserve the existing time-range behaviour
        # whenever a custom date range is not supplied.
        if start_date is None and end_date is None:

            if range != "all":

                    range_windows = {
                        "1h": timedelta(hours=1),
                        "24h": timedelta(hours=24),
                        "7d": timedelta(days=7),
                        "recent": timedelta(days=1),

                        # Preserve existing API range values for compatibility.
                        "hourly": timedelta(hours=24),
                        "daily": timedelta(days=7),
                        "weekly": timedelta(days=30),
                        "monthly": timedelta(days=365),
                    }

                    duration = range_windows.get(
                        range,
                        timedelta(days=1),
                    )

                    since = datetime.now() - duration

                    conditions.append("timestamp >= ?")
                    parameters.append(since.isoformat())

        else:
            if start_date is not None:
                conditions.append("timestamp >= ?")
                parameters.append(start_date.isoformat())

            if end_date is not None:
                # Exclusive upper boundary includes the entire end date.
                end_exclusive = end_date + timedelta(days=1)

                conditions.append("timestamp < ?")
                parameters.append(end_exclusive.isoformat())

        if min_score is not None:
            conditions.append("connectivity_score >= ?")
            parameters.append(min_score)

        if max_score is not None:
            conditions.append("connectivity_score <= ?")
            parameters.append(max_score)

        query = """
             SELECT
                id,
                timestamp,
                download_mbps,
                upload_mbps,
                ping_ms,
                jitter_ms,
                packet_loss,
                network_type,
                connectivity_score,
                latitude,
                longitude
            FROM network_tests
        """

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY timestamp ASC"

        cursor.execute(query, parameters)

        rows = cursor.fetchall()

        return [dict(row) for row in rows]

    finally:
        connection.close()



# ============================================================
# AI STATUS
# ============================================================

@app.get("/api/ai/status")
def ai_status():
    data = load_network_data() if AI_IMPORT_ERROR is None else []

    return {
        "success": AI_MODELS_READY,
        "message": AI_MODELS_MESSAGE,
        "prediction_model": {
            "name": "HistGradientBoosting",
            "loaded": FINAL_PREDICTOR_READY,
        },
        "anomaly_model": {
            "name": "Transformer Autoencoder",
            "loaded": ai_anomaly_model is not None,
        },
        "records_available": len(data),
        "sequence_length": SEQUENCE_LENGTH,
    }


# ============================================================
# AI PREDICTION - HISTGRADIENTBOOSTING
# ============================================================

@app.get("/api/ai/prediction")
def ai_prediction():
    if not FINAL_PREDICTOR_READY:
        raise HTTPException(
            status_code=503,
            detail=getattr(final_predictor, "message", AI_MODELS_MESSAGE),
        )

    try:
        predicted_score = final_predictor.predict()

        if predicted_score >= 75:
            quality = "Excellent"
        elif predicted_score >= 50:
            quality = "Good"
        elif predicted_score >= 25:
            quality = "Average"
        else:
            quality = "Poor"

        return {
            "success": True,
            "model": "HistGradientBoosting",
            "input_records": SEQUENCE_LENGTH,
            "training_records": final_predictor.record_count,
            "training_samples": final_predictor.training_samples,
            "predicted_connectivity_score": round(
                predicted_score,
                2,
            ),
            "predicted_quality": quality,
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Prediction failed: {error}",
        )


# ============================================================
# AI ANOMALY
# ============================================================

@app.get("/api/ai/anomaly")
def ai_anomaly():
    if (
        not AI_MODELS_READY
        or ai_anomaly_model is None
        or ai_scaler is None
    ):
        raise HTTPException(
            status_code=503,
            detail=AI_MODELS_MESSAGE,
        )

    data = load_network_data()

    if not data:
        raise HTTPException(
            status_code=400,
            detail="No complete network record is available.",
        )

    latest = data[-1]

    try:
        normalized = normalize_values(
            latest["values"],
            ai_scaler,
        )

        sample = torch.tensor(
            normalized,
            dtype=torch.float32,
        ).reshape(1, 1, len(FEATURES))

        with torch.no_grad():
            reconstructed = ai_anomaly_model(sample)
            target = sample[:, -1, :]
            reconstruction_error = torch.mean(
                (reconstructed - target) ** 2
            ).item()

        threshold = float(ai_anomaly_threshold or 0.05)
        is_anomaly = reconstruction_error > threshold

        return {
            "success": True,
            "model": "Transformer Autoencoder",
            "timestamp": latest["timestamp"],
            "anomaly": bool(is_anomaly),
            "reconstruction_error": round(
                float(reconstruction_error),
                6,
            ),
            "threshold": round(threshold, 6),
            "status": (
                "Anomaly detected"
                if is_anomaly
                else "No anomaly detected"
            ),
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Anomaly detection failed: {error}",
        )


# ============================================================
# COMBINED AI ANALYSIS
# ============================================================

def _run_ai_analysis(component_name, analysis):
    """Run one AI component without interrupting the other."""
    try:
        result = analysis()
        # Keep the original successful payload fields at their existing
        # top-level locations while adding a normalized result envelope.
        payload = result if isinstance(result, dict) else {"result": result}
        return {
            **payload,
            "success": True,
            "data": result,
            "error": None,
        }
    except HTTPException as error:
        unavailable = error.status_code == 503 or error.status_code < 500
        if error.status_code == 503:
            message = "The AI analysis component is currently unavailable."
        elif error.status_code >= 500:
            # Server-side exception details can contain paths or other internals.
            message = (
                "The analysis could not be completed due to an internal error."
            )
        else:
            message = (
                error.detail
                if isinstance(error.detail, str)
                else "The analysis could not be completed."
            )

        return {
            "success": False,
            "data": None,
            "error": {
                "code": (
                    "analysis_unavailable"
                    if unavailable
                    else "analysis_failed"
                ),
                "message": message,
                "status_code": error.status_code,
            },
        }
    except Exception:
        # Avoid exposing implementation details in the public API response.
        import logging

        logging.getLogger(__name__).exception(
            "Unexpected %s analysis failure", component_name
        )
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "analysis_failed",
                "message": "The analysis could not be completed due to an internal error.",
                "status_code": 500,
            },
        }


@app.get("/api/ai/analyze")
def ai_analyze():
    """Return independent prediction and anomaly outcomes."""
    prediction_result = _run_ai_analysis("prediction", ai_prediction)
    anomaly_result = _run_ai_analysis("anomaly", ai_anomaly)

    successful_count = sum(
        result["success"]
        for result in (prediction_result, anomaly_result)
    )

    if successful_count == 2:
        status = "success"
    elif successful_count == 1:
        status = "partial_success"
    else:
        status = "failure"

    return {
        "success": successful_count == 2,
        "available": successful_count > 0,
        "status": status,
        "prediction": prediction_result,
        "anomaly": anomaly_result,
    }


# ============================================================

# DELETE NETWORK HISTORY

# ============================================================



@app.delete("/api/network-history")

def delete_network_history():



    connection = get_connection()



    cursor = connection.cursor()



    cursor.execute(

        "DELETE FROM network_tests"

    )



    connection.commit()



    connection.close()





    return {

        "status": "success",

        "message": "Network history deleted"

    }





# ============================================================

# RUN SERVER

# ============================================================



if __name__ == "__main__":



    import uvicorn



    uvicorn.run(

        "backend.main:app",

        host="127.0.0.1",

        port=8000,

        reload=True

    )