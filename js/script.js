/* =========================================================
   SMART CONNECTIVITY ANALYSER
   COMPLETE CORRECTED SCRIPT
   ========================================================= */

const API_BASE =
    typeof window !== "undefined" && window.API_BASE
        ? window.API_BASE
        : "http://127.0.0.1:8000/api";

const $ = (id) => document.getElementById(id);

let applicationInitialized = false;
let testInProgress = false;
let speedTest = null;
let speedTestTimeout = null;
let networkChart = null;
let connectivityMap = null;
let userMarker = null;
let savedMarkers = [];
let sessionTimer = null;
let sessionStartTime = Date.now();
let lastTestTime = null;
let downtimeSeconds = 0;
let currentLocation = null;
let sessionTests = [];
let savedLocations = [];

let currentMetrics = {
    download: null,
    upload: null,
    ping: null,
    jitter: null,
    packetLoss: null,
    networkType: "Unknown",
    score: 0
};

// ─── Metric Units ─────────────────────────────────────
const METRIC_UNITS = Object.freeze({
    download: "Mbps",
    download_mbps: "Mbps",
    upload: "Mbps",
    upload_mbps: "Mbps",
    ping: "ms",
    ping_ms: "ms",
    jitter: "ms",
    jitter_ms: "ms",
    packetLoss: "%",
    packet_loss: "%"
});

/* =========================================================
   HELPERS
   ========================================================= */

function isValidMetric(value) {
    return value !== null &&
        value !== undefined &&
        value !== "" &&
        typeof value !== "boolean" &&
        Number.isFinite(Number(value));
}

function safeNumber(value, fallback = null) {
    return isValidMetric(value) ? Number(value) : fallback;
}

function firstValid(...values) {
    for (const value of values) {
        if (isValidMetric(value)) return Number(value);
    }
    return null;
}

function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
}

function showToast(message) {
    const toast = $("toast");
    const toastMessage = $("toast-message");

    if (!toast) return;

    if (toastMessage) toastMessage.textContent = message;

    toast.classList.add("show");

    clearTimeout(showToast.timeout);

    showToast.timeout = setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

// ─── Format Metric ─────────────────────────────────────

function formatMetric(value, unitOrDecimals = "", decimals = 1) {
    if (!isValidMetricNumber(value)) {
        return "Unavailable";
    }

    // Maintain compatibility with existing formatMetric(value, 2) calls.
    let unit = "";

    if (typeof unitOrDecimals === "number") {
        decimals = unitOrDecimals;
    } else {
        unit = unitOrDecimals || "";
    }

    const formatted = Number(value).toFixed(decimals);

    return unit ? `${formatted} ${unit}` : formatted;
}

// ─── Metric Validation & Formatting Helpers ────────────

function isValidMetricNumber(value) {
    if (
        value === null ||
        value === undefined ||
        value === "" ||
        typeof value === "boolean" ||
        typeof value === "object" ||
        (typeof value === "string" && value.trim() === "")
    ) {
        return false;
    }

    return Number.isFinite(Number(value));
}


function formatNumber(value, decimals = 1) {
    if (!isValidMetricNumber(value)) {
        return "--";
    }

    return Number(value).toFixed(decimals);
}
function formatNetworkMetric(metricType, value, decimals = 1) {
    const unit = METRIC_UNITS[metricType] || "";

    return formatMetric(value, unit, decimals);
}
function setProgress(id, value) {
    const element = $(id);

    if (!element) return;

    element.style.width =
        `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initializeApplication,
            { once: true }
        );
    } else {
    initializeApplication();
}
}

async function initializeApplication() {
    if (applicationInitialized) return;

    applicationInitialized = true;

    setupButtons();
    setupNetworkListeners();
    detectNetworkType();

    initializeMap();
    initializeChart();
    loadSavedLocations();

    await loadNetworkHistory();

    updateDashboard();
    updateApplicationReadiness();
    updateAIAnalysis();
    updateAISectionsFromBackend();
    updateNetworkRecommendation();

    startSessionTimer();

    console.log("Smart Connectivity Analyser initialized.");
}

/* =========================================================
   BUTTONS + NETWORK EVENTS
   ========================================================= */

function setupButtons() {
    $("startTest")?.addEventListener("click", startNetworkTest);

    $("exportCSV")?.addEventListener(
        "click",
        exportHistoryToCSV
    );

    $("historyRange")?.addEventListener("change", (event) => {
        loadNetworkHistory(event.target.value);
    });
    // Apply history filters.
    $("applyHistoryFilters")?.addEventListener(
        "click",
        () => loadNetworkHistory()
    );

    // Reset history filters.
    $("resetHistoryFilters")?.addEventListener(
        "click",
        resetNetworkHistoryFilters
    );

    $("detectLocation")?.addEventListener(
        "click",
        detectLocation
    );

    $("saveLocation")?.addEventListener(
        "click",
        saveLocation
    );

    $("findBetterArea")?.addEventListener(
        "click",
        findBetterArea
    );
}

function setupNetworkListeners() {
    window.addEventListener("online", () => {
        updateNetworkStatus();
        showToast("Internet connection restored.");
    });

    window.addEventListener("offline", () => {
        updateNetworkStatus();
        showToast("Internet connection lost.");
    });

    window.addEventListener("resize", () => {
        connectivityMap?.invalidateSize();
        networkChart?.resize();
    });

    setInterval(() => {
        if (!navigator.onLine) {
            downtimeSeconds++;
        }

        updateSessionStatistics();
    }, 1000);
}

function updateNetworkStatus() {
    const dot = $("networkStatusDot");

    if (!navigator.onLine) {
        setText("status", "Offline");

        dot?.classList.remove("connected", "testing");
        dot?.classList.add("disconnected");
    } else if (!testInProgress) {
        setText(
            "status",
            currentMetrics.score
                ? getConnectivityStatus(currentMetrics.score)
                : "Online"
        );

        dot?.classList.remove("disconnected", "testing");
        dot?.classList.add("connected");
    }
}

function detectNetworkType() {
    const connection =
        navigator.connection ||
        navigator.mozConnection ||
        navigator.webkitConnection;

    let type = "Unknown";

    if (connection?.type) {
        type = connection.type;
    } else if (connection?.effectiveType) {
        type = connection.effectiveType.toUpperCase();
    }

    if (type.toLowerCase() === "wifi") {
        type = "Wi-Fi";
    }

    if (type.toLowerCase() === "cellular") {
        type = "Mobile";
    }

    currentMetrics.networkType = type;

    setText("networkType", type);
}

/* =========================================================
   MAP - OPENSTREETMAP
   ========================================================= */

function initializeMap() {
    const mapElement = $("connectivityMap");

    if (!mapElement) {
        console.warn("Map container not found.");
        return;
    }

    if (typeof L === "undefined") {
        console.error("Leaflet is not loaded.");

        setText(
            "locationResult",
            "Leaflet did not load. Check the Leaflet CDN scripts."
        );

        return;
    }

    if (connectivityMap) {
        setTimeout(() => {
            connectivityMap.invalidateSize(true);
        }, 150);

        return;
    }

    try {
        connectivityMap = L.map(mapElement, {
            zoomControl: true,
            scrollWheelZoom: true
        }).setView([19.0760, 72.8777], 12);

        const tileLayer = L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                minZoom: 1,
                maxZoom: 19,
                attribution:
                    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }
        );

        tileLayer.on("tileerror", (event) => {
            console.warn("OpenStreetMap tile error:", event);

            setText(
                "locationResult",
                "Map tiles could not load. Check your connection."
            );
        });

        tileLayer.addTo(connectivityMap);

        connectivityMap.whenReady(() => {
            setTimeout(() => {
                connectivityMap?.invalidateSize(true);
            }, 250);
        });

        console.log("OpenStreetMap initialized.");

    } catch (error) {
        console.error("Map initialization failed:", error);

        setText(
            "locationResult",
            "Unable to initialize the map."
        );
    }
}

function ensureMapReady() {
    if (!connectivityMap) {
        initializeMap();
    }

    if (connectivityMap) {
        setTimeout(() => {
            connectivityMap.invalidateSize(true);
        }, 100);
    }
}

/* =========================================================
   LOCATION
   ========================================================= */

function detectLocation() {
    if (!navigator.geolocation) {
        showToast("Geolocation is not supported.");

        setText(
            "locationResult",
            "Geolocation is not supported by this browser."
        );

        return;
    }

    setText(
        "locationResult",
        "Detecting your current location..."
    );

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;
            const accuracy = position.coords.accuracy;

            currentLocation = {
                latitude,
                longitude,
                accuracy,
                timestamp: position.timestamp
            };

            ensureMapReady();

            if (connectivityMap && typeof L !== "undefined") {
                const point = [latitude, longitude];

                connectivityMap.setView(point, 16);

                if (userMarker) {
                    userMarker.setLatLng(point);
                } else {
                    userMarker = L.marker(point).addTo(connectivityMap);
                }

                userMarker
                    .bindPopup("Your Current Location")
                    .openPopup();
            }

            setText(
                "locationResult",
                `Location detected: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (±${Math.round(accuracy)} m)`
            );

            showToast("Location detected successfully.");
        },

        (error) => {
            let message = "Unable to detect location.";

            if (error.code === 1) {
                message =
                    "Location permission denied. Allow location access in your browser.";
            } else if (error.code === 2) {
                message = "Location information is unavailable.";
            } else if (error.code === 3) {
                message = "Location request timed out. Try again.";
            }

            setText("locationResult", message);
            showToast(message);
        },

        {
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 0
        }
    );
}

function saveLocation() {
    let latitude;
    let longitude;

    if (currentLocation) {
        latitude = currentLocation.latitude;
        longitude = currentLocation.longitude;
    } else if (connectivityMap) {
        const center = connectivityMap.getCenter();

        latitude = center.lat;
        longitude = center.lng;
    } else {
        showToast("Detect your location first.");
        return;
    }

    const point = {
        latitude,
        longitude,
        score: currentMetrics.score,
        download: currentMetrics.download,
        upload: currentMetrics.upload,
        ping: currentMetrics.ping,
        timestamp: new Date().toISOString()
    };

    try {
        savedLocations.push(point);

        localStorage.setItem(
            "savedConnectivityLocations",
            JSON.stringify(savedLocations)
        );

        addSavedLocationToMap(point);

        setText("locationResult", "Network location saved.");

        showToast("Location saved successfully.");

    } catch (error) {
        console.error("Save location failed:", error);

        showToast("Unable to save location.");
    }
}

function loadSavedLocations() {
    try {
        const parsed = JSON.parse(
            localStorage.getItem("savedConnectivityLocations") || "[]"
        );

        savedLocations = Array.isArray(parsed) ? parsed : [];

        savedLocations.forEach(addSavedLocationToMap);

    } catch (error) {
        savedLocations = [];

        console.warn("Could not load saved locations:", error);
    }
}

function addSavedLocationToMap(point) {
    if (!connectivityMap || typeof L === "undefined") return;

    const lat = safeNumber(point.latitude);
    const lng = safeNumber(point.longitude);

    if (lat === null || lng === null) return;

    const marker = L.circleMarker([lat, lng], {
        radius: 7,
        weight: 2
    }).addTo(connectivityMap);

    marker.bindPopup(
        `Saved network point<br>Score: ${safeNumber(point.score, 0)}/100`
    );

    savedMarkers.push(marker);
}

function findBetterArea() {
    const result = $("navigationResult");

    if (!currentLocation) {
        if (result) {
            result.textContent = "Detect your current location first.";
        }

        showToast("Detect your current location first.");
        return;
    }

    const betterPoints = savedLocations
        .filter((point) =>
            safeNumber(point.score, -1) > currentMetrics.score &&
            isValidMetric(point.latitude) &&
            isValidMetric(point.longitude)
        )
        .sort((a, b) => Number(b.score) - Number(a.score));

    if (!betterPoints.length) {
        if (result) {
            result.textContent =
                "No saved location has a higher connectivity score yet.";
        }

        showToast("No better saved network point found.");
        return;
    }

    const target = betterPoints[0];

    const distance = calculateDistanceKm(
        currentLocation.latitude,
        currentLocation.longitude,
        Number(target.latitude),
        Number(target.longitude)
    );

    const direction = bearingToDirection(
        calculateBearing(
            currentLocation.latitude,
            currentLocation.longitude,
            Number(target.latitude),
            Number(target.longitude)
        )
    );

    if (result) {
        result.textContent =
            `Better saved area found. Score: ${target.score}/100. Distance: ${distance.toFixed(2)} km. Direction: ${direction}.`;
    }

    connectivityMap?.setView(
        [Number(target.latitude), Number(target.longitude)],
        15
    );
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const toRad = (degrees) => degrees * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return 6371 * 2 *
        Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const toRad = (degrees) => degrees * Math.PI / 180;
    const toDeg = (radians) => radians * 180 / Math.PI;

    const phi1 = toRad(lat1);
    const phi2 = toRad(lat2);
    const lambda = toRad(lon2 - lon1);

    const y = Math.sin(lambda) * Math.cos(phi2);

    const x =
        Math.cos(phi1) * Math.sin(phi2) -
        Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda);

    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function bearingToDirection(bearing) {
    const directions = [
        "North",
        "North-East",
        "East",
        "South-East",
        "South",
        "South-West",
        "West",
        "North-West"
    ];

    return directions[Math.round(bearing / 45) % 8];
}

/* =========================================================
   CHART.JS
   ========================================================= */

function initializeChart() {
    const canvas = $("networkChart");

    if (!canvas) {
        console.warn("Chart canvas #networkChart was not found.");
        return;
    }

    if (typeof Chart === "undefined") {
        console.error("Chart.js is not loaded.");

        setText(
            "testMessage",
            "Chart.js could not load. Check the Chart.js CDN."
        );

        return;
    }

    if (networkChart) return;

    const context = canvas.getContext("2d");

    if (!context) return;

    networkChart = new Chart(context, {
        type: "line",

        data: {
            labels: [],

            datasets: [
                {
                    label: "Connectivity Score",
                    data: [],
                    borderColor: "#8b5cf6",
                    backgroundColor: "rgba(139, 92, 246, 0.15)",
                    borderWidth: 3,
                    fill: true,
                    tension: 0.35,
                    spanGaps: true,
                    yAxisID: "scoreAxis"
                },

                {
                    label: "Download Speed (Mbps)",
                    data: [],
                    borderColor: "#ec4899",
                    backgroundColor: "rgba(236, 72, 153, 0.10)",
                    borderWidth: 3,
                    fill: false,
                    tension: 0.35,
                    spanGaps: true,
                    yAxisID: "speedAxis"
                }
            ]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            interaction: {
                intersect: false,
                mode: "index"
            },

            plugins: {
                legend: {
                    display: true,
                    position: "bottom"
                },

                tooltip: {
                    enabled: true
                }
            },

            scales: {
                scoreAxis: {
                    type: "linear",
                    position: "left",
                    min: 0,
                    max: 100,

                    title: {
                        display: true,
                        text: "Connectivity Score"
                    }
                },

                speedAxis: {
                    type: "linear",
                    position: "right",
                    beginAtZero: true,

                    title: {
                        display: true,
                        text: "Download Mbps"
                    },

                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        }
    });

    console.log("Chart.js initialized.");
}

/* =========================================================
   HISTORY
   ========================================================= */

function normalizeHistoryItem(item = {}) {
    return {
        timestamp:
            item.timestamp ||
            item.created_at ||
            item.time ||
            new Date().toISOString(),

        download_mbps: firstValid(
            item.download_mbps,
            item.download,
            item.downloadSpeed
        ),

        upload_mbps: firstValid(
            item.upload_mbps,
            item.upload,
            item.uploadSpeed
        ),

        ping: firstValid(item.ping_ms, item.ping),

        jitter: firstValid(item.jitter_ms, item.jitter),

        packet_loss: firstValid(
            item.packet_loss,
            item.packetLoss,
            item.packet_loss_percent
        ),

        connectivity_score: firstValid(
            item.connectivity_score,
            item.score
        )
    };
}
/* =========================================================
   NETWORK HISTORY FILTER HELPERS
   ========================================================= */

function validateHistoryFilterValues({
    startDate = "",
    endDate = "",
    minScore = "",
    maxScore = ""
} = {}) {

    const normalize = value =>
        String(value ?? "").trim();

    startDate = normalize(startDate);
    endDate = normalize(endDate);
    minScore = normalize(minScore);
    maxScore = normalize(maxScore);

    function isValidDate(value) {
        if (!value) return true;

        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return false;
        }

        const parsed = new Date(
            `${value}T00:00:00.000Z`
        );

        return (
            !Number.isNaN(parsed.getTime()) &&
            parsed.toISOString().slice(0, 10) === value
        );
    }

    if (!isValidDate(startDate) || !isValidDate(endDate)) {
        return {
            valid: false,
            error: "Please enter valid dates."
        };
    }

    if (startDate && endDate && startDate > endDate) {
        return {
            valid: false,
            error: "Start date cannot be after end date."
        };
    }

    function parseScore(value, label) {
        if (value === "") {
            return {
                valid: true,
                value: null
            };
        }

        const score = Number(value);

        if (
            !Number.isFinite(score) ||
            score < 0 ||
            score > 100
        ) {
            return {
                valid: false,
                error: `${label} must be between 0 and 100.`
            };
        }

        return {
            valid: true,
            value: score
        };
    }

    const minimum = parseScore(minScore, "Minimum score");

    if (!minimum.valid) {
        return {
            valid: false,
            error: minimum.error
        };
    }

    const maximum = parseScore(maxScore, "Maximum score");

    if (!maximum.valid) {
        return {
            valid: false,
            error: maximum.error
        };
    }

    if (
        minimum.value !== null &&
        maximum.value !== null &&
        minimum.value > maximum.value
    ) {
        return {
            valid: false,
            error: "Minimum score cannot exceed maximum score."
        };
    }

    return {
        valid: true,
        filters: {
            startDate,
            endDate,
            minScore: minimum.value,
            maxScore: maximum.value
        }
    };
}


function setHistoryFilterMessage(message, isError = false) {
    const element = $("historyFilterMessage");

    if (!element) return;

    element.textContent = message;

    element.classList.toggle(
        "is-error",
        isError
    );
}


function resetNetworkHistoryFilters() {
    const filterIds = [
        "historyStartDate",
        "historyEndDate",
        "historyMinScore",
        "historyMaxScore"
    ];

    filterIds.forEach(id => {
        const element = $(id);

        if (element) {
            element.value = "";
        }
    });

    const rangeElement = $("historyRange");

    if (rangeElement) {
        rangeElement.value = "all";
    }

    setHistoryFilterMessage("");

    loadNetworkHistory("all");
}

async function loadNetworkHistory(range = null) {
    const selectedRange =
        range || $("historyRange")?.value || "recent";

    const validation = validateHistoryFilterValues({
        startDate: $("historyStartDate")?.value || "",
        endDate: $("historyEndDate")?.value || "",
        minScore: $("historyMinScore")?.value || "",
        maxScore: $("historyMaxScore")?.value || ""
    });

    if (!validation.valid) {
        setHistoryFilterMessage(validation.error, true);
        return;
    }

    const filters = validation.filters;
    const params = new URLSearchParams();

    params.set("range", selectedRange);

    if (filters.startDate) {
        params.set("start_date", filters.startDate);
    }

    if (filters.endDate) {
        params.set("end_date", filters.endDate);
    }

    if (filters.minScore !== null) {
        params.set("min_score", filters.minScore);
    }

    if (filters.maxScore !== null) {
        params.set("max_score", filters.maxScore);
    }

    const canvasContainer = $("historyChartContainer");
    const emptyState = $("historyEmptyState");
    const errorState = $("historyErrorState");

    try {
        setHistoryFilterMessage("Loading network history...");

        const response = await fetch(
            `${API_BASE}/network-history?${params.toString()}`,
            {
                method: "GET",
                cache: "no-store"
            }
        );

        if (!response.ok) {
            throw new Error(
                `History API returned ${response.status}`
            );
        }

        const result = await response.json();

        const data = Array.isArray(result)
            ? result
            : (
                result.history ||
                result.data ||
                result.results ||
                []
            );

        if (!Array.isArray(data)) {
            throw new Error("Unexpected network history format.");
        }

        if (errorState) errorState.hidden = true;

        sessionTests = data
            .map(normalizeHistoryItem)
            .filter((item) =>
                Number.isFinite(Date.parse(item.timestamp))
            );

        if (sessionTests.length === 0) {
            updateHistoryChart([], "all");

            if (canvasContainer) {
                canvasContainer.hidden = true;
            }

            if (emptyState) {
                emptyState.hidden = false;
            }

            updateSessionStatistics();

            setHistoryFilterMessage("");

            return;
        }

        if (canvasContainer) {
            canvasContainer.hidden = false;
        }

        if (emptyState) {
            emptyState.hidden = true;
        }

        // The backend has already applied all selected filters.
        updateHistoryChart(sessionTests, "all");

        updateSessionStatistics();

        setHistoryFilterMessage(
            `Showing ${sessionTests.length} matching network record(s).`
        );

        // Preserve the existing latest-measurement restoration.
        const latest = sessionTests[sessionTests.length - 1];

        if (
            currentMetrics.download === null &&
            latest.download_mbps !== null
        ) {
            currentMetrics.download = Number(
                latest.download_mbps
            );
        }

        if (
            currentMetrics.upload === null &&
            latest.upload_mbps !== null
        ) {
            currentMetrics.upload = Number(
                latest.upload_mbps
            );
        }

    } catch (error) {
        console.warn(
            "Network history could not be loaded:",
            error.message
        );

        sessionTests = [];

        updateHistoryChart([], "all");

        if (canvasContainer) {
            canvasContainer.hidden = true;
        }

        if (emptyState) {
            emptyState.hidden = true;
        }

        if (errorState) {
            errorState.hidden = false;
        }

        updateSessionStatistics();

        setHistoryFilterMessage("");
    }
}

function updateHistoryChart(history = sessionTests, range = null) {
    if (!networkChart) initializeChart();

    if (!networkChart) return;

    const selectedRange =
        range || $("historyRange")?.value || "recent";

    const now = Date.now();

    const durations = {
        "1h": 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000
    };

    const filtered = history
        .map(normalizeHistoryItem)
        .filter((item) => {
            const time = Date.parse(item.timestamp);

            if (!Number.isFinite(time)) return false;

            if (selectedRange === "recent") return true;

            const duration = durations[selectedRange];

            return duration
                ? now - time <= duration && now - time >= 0
                : true;
        })
        .sort((a, b) =>
            Date.parse(a.timestamp) - Date.parse(b.timestamp)
        );

    networkChart.data.labels = filtered.map((item) =>
        new Date(item.timestamp).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        })
    );

    networkChart.data.datasets[0].data =
        filtered.map((item) => item.connectivity_score);

    networkChart.data.datasets[1].data =
        filtered.map((item) => item.download_mbps);

    networkChart.update();
}

/* =========================================================
   NETWORK TEST
   ========================================================= */

async function startNetworkTest() {
    if (testInProgress) return;

    if (!navigator.onLine) {
        setText("status", "Offline");

        setText(
            "testMessage",
            "Your device is offline. Connect to a network first."
        );

        showToast("Your device is offline.");
        return;
    }

    testInProgress = true;

    const button = $("startTest");

    if (button) {
        button.disabled = true;
        button.textContent = "Testing...";
    }

    $("networkStatusDot")?.classList.add("testing");

    setText("status", "Testing");

    setText(
        "testMessage",
        "Measuring download, upload, ping and jitter..."
    );

    currentMetrics = {
        download: null,
        upload: null,
        ping: null,
        jitter: null,
        packetLoss: null,
        networkType: currentMetrics.networkType,
        score: 0
    };

    updateDashboard();

    try {
        const [backendResult, bandwidthResult] =
            await Promise.all([
                runBackendNetworkQualityTest(),
                runCloudflareBandwidthTest()
            ]);

        applyBackendMetrics(backendResult);
        applyBandwidthMetrics(bandwidthResult);

        if (
            currentMetrics.ping === null ||
            currentMetrics.jitter === null
        ) {
            const latency = await measureBrowserLatency();

            if (currentMetrics.ping === null) {
                currentMetrics.ping = latency.ping;
            }

            if (currentMetrics.jitter === null) {
                currentMetrics.jitter = latency.jitter;
            }
        }

        detectNetworkType();

        currentMetrics.score =
            calculateConnectivityScore(currentMetrics);

        lastTestTime = new Date().toISOString();

        updateDashboard();
        updateApplicationReadiness();
        updateAIAnalysis();
        updateNetworkRecommendation();

        await updateAISectionsFromBackend();

        const entry = {
            timestamp: lastTestTime,

            download_mbps: currentMetrics.download,
            upload_mbps: currentMetrics.upload,

            ping_ms: currentMetrics.ping,
            jitter_ms: currentMetrics.jitter,

            packet_loss: currentMetrics.packetLoss,

            connectivity_score: currentMetrics.score,

            network_type: currentMetrics.networkType,

            latitude: currentLocation?.latitude ?? null,
            longitude: currentLocation?.longitude ?? null
        };

        sessionTests.push(normalizeHistoryItem(entry));

        updateHistoryChart(sessionTests);
        updateSessionStatistics();

        await saveNetworkTest(entry);

        setText(
            "testMessage",
            "Network test completed successfully."
        );

        showToast("Network test completed.");

    } catch (error) {
        console.error("Network test failed:", error);

        setText(
            "testMessage",
            "Network test failed. Check your backend and browser console."
        );

        showToast("Network test failed.");

    } finally {
        testInProgress = false;

        if (button) {
            button.disabled = false;
            button.textContent = "Start Test";
        }

        $("networkStatusDot")?.classList.remove("testing");

        updateNetworkStatus();
    }
}

/* =========================================================
   BACKEND NETWORK QUALITY
   ========================================================= */

async function runBackendNetworkQualityTest() {
    try {
        const response = await fetch(
            `${API_BASE}/network-quality`,
            {
                method: "GET",
                cache: "no-store"
            }
        );

        if (!response.ok) {
            throw new Error(
                `Network quality API returned ${response.status}`
            );
        }

        const data = await response.json();

        console.log("Backend network quality:", data);

        return data.metrics || data.data || data;

    } catch (error) {
        console.warn(
            "Backend network-quality endpoint unavailable:",
            error.message
        );

        return null;
    }
}

function applyBackendMetrics(data) {
    if (!data || typeof data !== "object") return;

    currentMetrics.ping = firstValid(
        data.ping_ms,
        data.ping,
        currentMetrics.ping
    );

    currentMetrics.jitter = firstValid(
        data.jitter_ms,
        data.jitter,
        currentMetrics.jitter
    );

    currentMetrics.packetLoss = firstValid(
        data.packet_loss,
        data.packet_loss_percent,
        data.packetLoss,
        currentMetrics.packetLoss
    );

    currentMetrics.download = firstValid(
        data.download_mbps,
        data.download,
        data.downloadSpeed,
        currentMetrics.download
    );

    currentMetrics.upload = firstValid(
        data.upload_mbps,
        data.upload,
        data.uploadSpeed,
        currentMetrics.upload
    );

    currentMetrics.networkType =
        data.network_type ||
        data.networkType ||
        currentMetrics.networkType;
}

/* =========================================================
   CLOUDFLARE SPEED TEST
   ========================================================= */

async function runCloudflareBandwidthTest() {
    try {
        setText(
            "testMessage",
            "Measuring download and upload speed..."
        );

        const module = await import(
            "https://cdn.skypack.dev/@cloudflare/speedtest"
        );

        const SpeedTest = module.default;

        if (typeof SpeedTest !== "function") {
            throw new Error(
                "Cloudflare Speedtest module unavailable."
            );
        }

        const test = new SpeedTest({
            autoStart: false,

            measureDownloadLoadedLatency: false,
            measureUploadLoadedLatency: false,

            bandwidthFinishRequestDuration: 500,

            measurements: [
                {
                    type: "download",
                    bytes: 100000,
                    count: 2,
                    bypassMinDuration: true
                },
                {
                    type: "download",
                    bytes: 1000000,
                    count: 2,
                    bypassMinDuration: true
                },
                {
                    type: "upload",
                    bytes: 100000,
                    count: 2,
                    bypassMinDuration: true
                },
                {
                    type: "upload",
                    bytes: 1000000,
                    count: 2,
                    bypassMinDuration: true
                }
            ]
        });

        speedTest = test;

        return await new Promise((resolve) => {
            let completed = false;

            const finish = (result) => {
                if (completed) return;

                completed = true;

                clearTimeout(speedTestTimeout);

                resolve(result);
            };

            test.onResultsChange = ({ type } = {}) => {
                try {
                    if (type === "download") {
                        const value =
                            test.results?.getDownloadBandwidth?.();

                        if (isValidMetric(value)) {
                            currentMetrics.download =
                                Number(value) / 1000000;

                            setText(
                                "download",
                                currentMetrics.download.toFixed(2)
                            );
                        }
                    }

                    if (type === "upload") {
                        const value =
                            test.results?.getUploadBandwidth?.();

                        if (isValidMetric(value)) {
                            currentMetrics.upload =
                                Number(value) / 1000000;

                            setText(
                                "upload",
                                currentMetrics.upload.toFixed(2)
                            );
                        }
                    }

                } catch (error) {
                    console.debug(
                        "Live bandwidth result not ready:",
                        error
                    );
                }
            };

            test.onFinish = (results) => {
                let download = null;
                let upload = null;

                try {
                    download = safeNumber(
                        results?.getDownloadBandwidth?.()
                    );

                    upload = safeNumber(
                        results?.getUploadBandwidth?.()
                    );

                } catch (error) {
                    console.warn(
                        "Could not read final speed results:",
                        error
                    );
                }

                finish({
                    download:
                        download === null ? null : download / 1000000,

                    upload:
                        upload === null ? null : upload / 1000000
                });
            };

            test.onError = (error) => {
                console.warn("Cloudflare speed test error:", error);

                finish({
                    download: null,
                    upload: null
                });
            };

            speedTestTimeout = setTimeout(() => {
                try {
                    test.pause?.();
                } catch (_) {}

                finish({
                    download: null,
                    upload: null
                });

            }, 90000);

            try {
                test.play();

            } catch (error) {
                console.error(
                    "Could not start Cloudflare test:",
                    error
                );

                finish({
                    download: null,
                    upload: null
                });
            }
        });

    } catch (error) {
        console.warn(
            "Cloudflare Speedtest unavailable:",
            error.message
        );

        return {
            download: null,
            upload: null
        };
    }
}

function applyBandwidthMetrics(result) {
    if (!result) return;

    if (
        currentMetrics.download === null &&
        isValidMetric(result.download)
    ) {
        currentMetrics.download = Number(result.download);
    }

    if (
        currentMetrics.upload === null &&
        isValidMetric(result.upload)
    ) {
        currentMetrics.upload = Number(result.upload);
    }
}

/* =========================================================
   BROWSER LATENCY
   ========================================================= */

async function measureBrowserLatency() {
    const samples = [];

    for (let i = 0; i < 4; i++) {
        const start = performance.now();

        try {
            await fetch(
                `https://www.cloudflare.com/cdn-cgi/trace?nocache=${Date.now()}-${i}`,
                {
                    cache: "no-store",
                    mode: "no-cors"
                }
            );

            samples.push(performance.now() - start);

        } catch (error) {
            console.debug("Latency sample failed:", error);
        }
    }

    if (!samples.length) {
        return {
            ping: null,
            jitter: null
        };
    }

    const average =
        samples.reduce((sum, value) => sum + value, 0) /
        samples.length;

    const deviations = samples.map(
        (value) => Math.abs(value - average)
    );

    const jitter =
        deviations.reduce((sum, value) => sum + value, 0) /
        deviations.length;

    return {
        ping: Number(average.toFixed(2)),
        jitter: Number(jitter.toFixed(2))
    };
}

/* =========================================================
   CONNECTIVITY SCORE
   ========================================================= */

function calculateConnectivityScore(metrics) {
    const components = [];

    if (isValidMetric(metrics.download)) {
        components.push(
            Math.min(100, Math.max(0, Number(metrics.download)))
        );
    }

    if (isValidMetric(metrics.upload)) {
        components.push(
            Math.min(100, Math.max(0, Number(metrics.upload) * 2))
        );
    }

    if (isValidMetric(metrics.ping)) {
        components.push(
            Math.max(0, 100 - Number(metrics.ping) * 0.6)
        );
    }

    if (isValidMetric(metrics.jitter)) {
        components.push(
            Math.max(0, 100 - Number(metrics.jitter) * 1.5)
        );
    }

    if (isValidMetric(metrics.packetLoss)) {
        components.push(
            Math.max(0, 100 - Number(metrics.packetLoss) * 10)
        );
    }

    if (!components.length) return 0;

    return Math.round(
        components.reduce((sum, value) => sum + value, 0) /
        components.length
    );
}

function getConnectivityStatus(score) {
    if (!navigator.onLine) return "Offline";
    if (score >= 80) return "Excellent";
    if (score >= 60) return "Good";
    if (score >= 40) return "Fair";
    if (score > 0) return "Poor";

    return "Online";
}

/* =========================================================
   DASHBOARD
   ========================================================= */

function updateDashboard() {
    setText(
        "download",
        formatMetric(currentMetrics.download)
    );

    setText(
        "upload",
        formatMetric(currentMetrics.upload)
    );

    setText(
        "ping",
        formatMetric(currentMetrics.ping)
    );

    setText(
        "jitter",
        formatMetric(currentMetrics.jitter)
    );

    setText(
        "packetLoss",
        formatMetric(currentMetrics.packetLoss)
    );

    setText(
        "networkType",
        currentMetrics.networkType || "Unknown"
    );

    currentMetrics.score =
        calculateConnectivityScore(currentMetrics);

    setText("score", currentMetrics.score);

    setProgress("scoreProgress", currentMetrics.score);

    const status = getConnectivityStatus(currentMetrics.score);

    setText("status", status);

    const dot = $("networkStatusDot");

    if (dot) {
        dot.classList.remove(
            "connected",
            "disconnected",
            "testing",
            "excellent",
            "good",
            "fair",
            "poor"
        );

        dot.classList.add(
            navigator.onLine ? "connected" : "disconnected"
        );
    }

    updateSessionStatistics();
}

/* =========================================================
   APPLICATION READINESS
   ========================================================= */

function updateApplicationReadiness() {
    const download = safeNumber(currentMetrics.download);
    const upload = safeNumber(currentMetrics.upload);
    const ping = safeNumber(currentMetrics.ping);
    const jitter = safeNumber(currentMetrics.jitter);
    const loss = safeNumber(currentMetrics.packetLoss);

    const gaming = readinessScore(
        [
            download === null ? null : Math.min(25, download * 2.5),
            upload === null ? null : Math.min(15, upload * 3),
            ping === null ? null : Math.max(0, 35 - ping * 0.35),
            jitter === null ? null : Math.max(0, 15 - jitter * 0.75),
            loss === null ? null : Math.max(0, 10 - loss * 5)
        ],
        [25, 15, 35, 15, 10]
    );

    const video = readinessScore(
        [
            download === null ? null : Math.min(25, download * 5),
            upload === null ? null : Math.min(30, upload * 6),
            ping === null ? null : Math.max(0, 20 - ping * 0.08),
            jitter === null ? null : Math.max(0, 15 - jitter * 0.3),
            loss === null ? null : Math.max(0, 10 - loss * 3)
        ],
        [25, 30, 20, 15, 10]
    );

    const streaming = download === null
        ? null
        : download >= 25 ? 100
        : download >= 10 ? 85
        : download >= 5 ? 70
        : download >= 3 ? 55
        : download >= 1 ? 30
        : 10;

    const browsing = readinessScore(
        [
            download === null ? null : Math.min(55, download * 5.5),
            ping === null ? null : Math.max(0, 35 - ping * 0.12),
            loss === null ? null : Math.max(0, 10 - loss * 2)
        ],
        [55, 35, 10]
    );

    updateReadinessDisplay("gamingScore", "gamingProgress", gaming);

    updateReadinessDisplay(
        "videoCallScore",
        "videoCallProgress",
        video
    );

    updateReadinessDisplay(
        "streamingScore",
        "streamingProgress",
        streaming
    );

    updateReadinessDisplay(
        "browsingScore",
        "browsingProgress",
        browsing
    );
}

function readinessScore(parts, maxima) {
    let earned = 0;
    let available = 0;

    parts.forEach((value, index) => {
        if (value !== null && Number.isFinite(value)) {
            earned += value;
            available += maxima[index];
        }
    });

    if (!available) return null;

    return Math.round(
        Math.max(0, Math.min(100, earned / available * 100))
    );
}

function updateReadinessDisplay(textId, barId, value) {
    setText(
        textId,
        value === null ? "—" : `${value}%`
    );

    if (value !== null) {
        setProgress(barId, value);
    }
}

/* =========================================================
   AI ANALYSIS
   ========================================================= */

function updateAIAnalysis() {
    const prediction = $("predictionResult");
    const anomaly = $("anomalyResult");

    if (sessionTests.length < 2) {
        if (prediction) {
            prediction.textContent =
                "Collect more network measurements to identify connectivity trends.";
        }

        if (anomaly) {
            anomaly.textContent =
                "Insufficient measurements for reliable anomaly analysis.";
        }

        return;
    }

    const recent = sessionTests.slice(-5);

    const speeds = recent
        .map((item) => safeNumber(item.download_mbps))
        .filter((value) => value !== null);

    const pings = recent
        .map((item) => safeNumber(item.ping))
        .filter((value) => value !== null);

    if (prediction) {
        if (speeds.length >= 2) {
            const first = speeds[0];
            const last = speeds[speeds.length - 1];

            prediction.textContent =
                last > first
                    ? "Recent download measurements show an improving trend."
                    : last < first
                    ? "Recent download measurements show a declining trend."
                    : "Download performance appears relatively stable.";
        } else {
            prediction.textContent =
                "More download measurements are required.";
        }
    }

    if (anomaly) {
        if (pings.length >= 2) {
            const average =
                pings.reduce((sum, value) => sum + value, 0) /
                pings.length;

            const latest = pings[pings.length - 1];

            anomaly.textContent =
                latest > average * 1.5
                    ? "Possible latency anomaly detected."
                    : "No significant latency anomaly detected.";
        } else {
            anomaly.textContent =
                "More latency measurements are required.";
        }
    }
}

async function updateAISectionsFromBackend() {
    try {
        const response = await fetch(
            `${API_BASE}/ai/analyze`,
            { cache: "no-store" }
        );

        if (!response.ok) {
            const prediction = $("predictionResult");
            if (prediction) {
                prediction.textContent =
                    "AI service is unavailable. Showing local analysis: " +
                    prediction.textContent;
            }
            return;
        }

        const result = await response.json();

        // Partial success is useful: render whichever component completed.
        // Older backend responses did not include "available", so retain their
        // previous success-based handling as a compatibility fallback.
        const resultsAvailable = typeof result?.available === "boolean"
            ? result.available
            : Boolean(result?.success);

        if (!resultsAvailable) {
            const prediction = $("predictionResult");
            if (prediction) {
                prediction.textContent =
                    "AI analysis is unavailable. Showing local analysis: " +
                    prediction.textContent;
            }
            return;
        }

        const predictionResult = result.prediction || {};
        const anomalyResult = result.anomaly || {};

        // New responses expose both a data envelope and the old fields.
        // Old responses can still be read directly.
        const predictionData = predictionResult.data || predictionResult;
        const anomalyData = anomalyResult.data || anomalyResult;

        if (
            predictionResult.success !== false &&
            predictionData.predicted_connectivity_score !== undefined
        ) {
            setText(
                "predictionResult",
                `Predicted connectivity score: ${Number(
                    predictionData.predicted_connectivity_score
                ).toFixed(2)}/100 (${predictionData.predicted_quality || "Unknown"}).`
            );
        }

        if (
            anomalyResult.success !== false &&
            typeof anomalyData.anomaly === "boolean"
        ) {
            const error = safeNumber(
                anomalyData.reconstruction_error
            );

            const threshold = safeNumber(
                anomalyData.threshold
            );

            setText(
                "anomalyResult",
                anomalyData.anomaly
                    ? `Anomaly detected. Reconstruction error: ${error === null ? "Unavailable" : error.toFixed(6)}.`
                    : `No anomaly detected. Reconstruction error: ${error === null ? "Unavailable" : error.toFixed(6)}.`
            );
        }

    } catch (error) {
        const prediction = $("predictionResult");
        if (prediction) {
            prediction.textContent =
                "AI service is unavailable. Showing local analysis: " +
                prediction.textContent;
        }
        console.info(
            "Backend AI analysis unavailable:",
            error.message
        );
    }
}

function updateNetworkRecommendation() {
    let recommendation =
        "Continue monitoring your connection.";

    if (
        currentMetrics.ping !== null &&
        currentMetrics.ping > 100
    ) {
        recommendation =
            "High response latency detected. Try moving closer to your router or checking network congestion.";

    } else if (
        currentMetrics.download !== null &&
        currentMetrics.download < 10
    ) {
        recommendation =
            "Download speed is low. Check background downloads and router placement.";

    } else if (
        currentMetrics.packetLoss !== null &&
        currentMetrics.packetLoss > 2
    ) {
        recommendation =
            "Packet loss detected. Check your router, Wi-Fi signal and network connection.";

    } else if (currentMetrics.score >= 80) {
        recommendation =
            "Your measured network performance looks good.";
    }

    setText("recommendation", recommendation);
}

/* =========================================================
   SAVE NETWORK TEST
   ========================================================= */

async function saveNetworkTest(testData) {
    try {
        const response = await fetch(
            `${API_BASE}/network-test`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify(testData)
            }
        );

        if (response.ok) {
            console.log("Network test saved to backend.");
            return;
        }

        console.warn(
            "POST /network-test returned:",
            response.status
        );

    } catch (error) {
        console.warn(
            "Could not save network test:",
            error.message
        );
    }
}

/* =========================================================
   CSV EXPORT
   ========================================================= */

function exportHistoryToCSV() {
    if (!sessionTests.length) {
        showToast("No network history available to export.");
        return;
    }

    const headers = [
        "Timestamp",
        "Download Mbps",
        "Upload Mbps",
        "Ping ms",
        "Jitter ms",
        "Packet Loss %",
        "Connectivity Score"
    ];

    const rows = sessionTests.map((raw) => {
        const item = normalizeHistoryItem(raw);

        return [
            item.timestamp,
            item.download_mbps ?? "",
            item.upload_mbps ?? "",
            item.ping ?? "",
            item.jitter ?? "",
            item.packet_loss ?? "",
            item.connectivity_score ?? ""
        ];
    });

    const csv = [headers, ...rows]
        .map((row) =>
            row.map((value) =>
                `"${String(value).replace(/"/g, '""')}"`
            ).join(",")
        )
        .join("\r\n");

    const blob = new Blob(
        ["\uFEFF" + csv],
        { type: "text/csv;charset=utf-8;" }
    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;

    link.download =
        `connectivity-history-${new Date().toISOString().slice(0, 10)}.csv`;

    document.body.appendChild(link);

    link.click();

    link.remove();

    URL.revokeObjectURL(url);

    showToast("CSV exported successfully.");
}

/* =========================================================
   SESSION TIMER
   ========================================================= */

function startSessionTimer() {
    if (sessionTimer) {
        clearInterval(sessionTimer);
    }

    const update = () => {
        const elapsed = Math.floor(
            (Date.now() - sessionStartTime) / 1000
        );

        const hours = Math.floor(elapsed / 3600);

        const minutes = Math.floor(
            (elapsed % 3600) / 60
        );

        const seconds = elapsed % 60;

        setText(
            "sessionTime",
            [hours, minutes, seconds]
                .map((value) =>
                    String(value).padStart(2, "0")
                )
                .join(":")
        );

        updateSessionStatistics();
    };

    update();

    sessionTimer = setInterval(update, 1000);
}

/* =========================================================
   SESSION STATISTICS
   ========================================================= */

function updateSessionStatistics() {
    const speeds = sessionTests
        .map((raw) =>
            safeNumber(
                normalizeHistoryItem(raw).download_mbps
            )
        )
        .filter((value) => value !== null);

    const pings = sessionTests
        .map((raw) =>
            safeNumber(
                normalizeHistoryItem(raw).ping
            )
        )
        .filter((value) => value !== null);

    const averageSpeed = speeds.length
        ? speeds.reduce((a, b) => a + b, 0) / speeds.length
        : null;

    const averagePing = pings.length
        ? pings.reduce((a, b) => a + b, 0) / pings.length
        : null;

    const peakSpeed = speeds.length
        ? Math.max(...speeds)
        : null;

    setText(
        "averageSpeed",
        averageSpeed === null
            ? "—"
            : `${averageSpeed.toFixed(2)} Mbps`
    );

    setText(
        "averagePing",
        averagePing === null
            ? "—"
            : `${averagePing.toFixed(2)} ms`
    );

    setText(
        "peakSpeed",
        peakSpeed === null
            ? "—"
            : `${peakSpeed.toFixed(2)} Mbps`
    );

    setText(
        "downtime",
        `${Math.floor(downtimeSeconds / 60)} min`
    );
}

/* =========================================================
   BACKEND HEALTH
   ========================================================= */

async function checkBackendHealth() {
    try {
        const response = await fetch(
            `${API_BASE}/health`,
            { cache: "no-store" }
        );

        if (!response.ok) return false;

        return true;

    } catch (error) {
        console.warn(
            "Backend health check failed:",
            error.message
        );

        return false;
    }
}

/* =========================================================
   PUBLIC API
   ========================================================= */

const smartConnectivity = {
    getCurrentNetworkData() {
        return {
            ...currentMetrics,
            location: currentLocation,
            history: sessionTests
        };
    },

    checkBackendHealth,
    loadNetworkHistory,
    detectLocation,
    saveLocation,
    findBetterArea,
    startNetworkTest,
    exportHistoryToCSV,
    validateHistoryFilterValues,
    calculateConnectivityScore
};

/* ─── Browser Exports ───────────────────────────────── */

if (typeof window !== "undefined") {
    window.smartConnectivity = smartConnectivity;

    window.calculateConnectivityScore =
        calculateConnectivityScore;

    window.exportHistoryToCSV =
        exportHistoryToCSV;

    window.loadNetworkHistory =
        loadNetworkHistory;

    window.METRIC_UNITS = METRIC_UNITS;
}

/* ─── Node.js Exports for Tests ─────────────────────── */

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        METRIC_UNITS,
        isValidMetricNumber,
        formatNumber,
        formatMetric,
        formatNetworkMetric,
        validateHistoryFilterValues
    };
}
/* =========================================================
   END OF SCRIPT
   ========================================================= */