/**
 * Tests for Offline Metric Handling & Connectivity Score Status Indicators
 *
 * Verifies that:
 * 1. Offline transitions clear stale download/upload (and all live) metrics
 *    so they render "Unavailable" rather than stale real-time speeds.
 * 2. Initial history loading while offline does not inject previous download
 *    and upload speeds into real-time metric displays.
 * 3. History-restored metrics when online are clearly identified via the
 *    metrics subtitle until a live test runs.
 * 4. Connectivity score status indicators (Poor, Fair, Good, Excellent,
 *    Online, Offline, Testing) map to accurate CSS dot & label classes
 *    (never showing a green dot for "Poor" or "Fair" or "Offline").
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    resolveConnectivityIndicator,
    resolveDashboardDisplayState,
    getConnectivityStatus,
    isDeviceOffline,
    clearLiveMetrics,
    applyConnectivityStatusIndicator,
    updateDashboard,
    handleConnectivityTransition,
    loadNetworkHistory,
    detectNetworkType
} = require("../js/script.js");

function loadFreshScriptModule() {
    const modPath = require.resolve("../js/script.js");
    delete require.cache[modPath];
    return require(modPath);
}

function createMockClassList() {
    const classes = new Set();
    return {
        add(...tokens) {
            tokens.forEach((t) => classes.add(t));
        },
        remove(...tokens) {
            tokens.forEach((t) => classes.delete(t));
        },
        toggle(token, force) {
            if (force === undefined) {
                if (classes.has(token)) {
                    classes.delete(token);
                    return false;
                }
                classes.add(token);
                return true;
            }
            if (force) {
                classes.add(token);
                return true;
            }
            classes.delete(token);
            return false;
        },
        contains(token) {
            return classes.has(token);
        },
        toArray() {
            return Array.from(classes);
        }
    };
}

function createMockElement() {
    return {
        textContent: "",
        style: {},
        dataset: {},
        attributes: {},
        classList: createMockClassList(),
        hidden: false,
        setAttribute(k, v) {
            this.attributes[k] = String(v);
        },
        getAttribute(k) {
            return this.attributes[k];
        }
    };
}

function withMockBrowserEnv(initialNav, fn) {
    const originalNavDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const originalDoc = global.document;
    const original$ = global.$;
    const originalFetch = global.fetch;

    const dom = {};
    global.document = {
        getElementById(id) {
            if (!dom[id]) dom[id] = createMockElement();
            return dom[id];
        }
    };
    global.$ = (id) => global.document.getElementById(id);

    Object.defineProperty(globalThis, "navigator", {
        value: initialNav,
        configurable: true,
        writable: true
    });

    const restore = () => {
        if (originalNavDescriptor) {
            Object.defineProperty(globalThis, "navigator", originalNavDescriptor);
        }
        global.document = originalDoc;
        global.$ = original$;
        global.fetch = originalFetch;
    };

    try {
        const result = fn(dom, initialNav);
        if (result && typeof result.then === "function") {
            return result.finally(restore);
        }
        restore();
        return result;
    } catch (error) {
        restore();
        throw error;
    }
}

describe("Connectivity Score Status Indicator & Offline Metrics Suite", () => {
    describe("resolveConnectivityIndicator()", () => {
        it("returns Offline + disconnected (red) when offline regardless of high previous score", () => {
            const indicator = resolveConnectivityIndicator(95, { isOffline: true });
            assert.strictEqual(indicator.status, "Offline");
            assert.strictEqual(indicator.dotClass, "disconnected");
            assert.strictEqual(indicator.score, 0);
        });

        it("returns Testing + testing (amber) when online and test in progress", () => {
            const indicator = resolveConnectivityIndicator(0, { isOffline: false, isTesting: true });
            assert.strictEqual(indicator.status, "Testing");
            assert.strictEqual(indicator.dotClass, "testing");
        });

        it("returns Offline instead of Testing if device drops offline during a test", () => {
            const indicator = resolveConnectivityIndicator(50, { isOffline: true, isTesting: true });
            assert.strictEqual(indicator.status, "Offline");
            assert.strictEqual(indicator.dotClass, "disconnected");
        });

        it("maps Poor score (1..39) to 'poor' (red) and NEVER 'connected' (green)", () => {
            for (const score of [1, 8, 25, 39]) {
                const indicator = resolveConnectivityIndicator(score, { isOffline: false });
                assert.strictEqual(indicator.status, "Poor");
                assert.strictEqual(indicator.dotClass, "poor");
                assert.notStrictEqual(indicator.dotClass, "connected");
            }
        });

        it("maps Fair score (40..59) to 'fair' (amber)", () => {
            for (const score of [40, 50, 59]) {
                const indicator = resolveConnectivityIndicator(score, { isOffline: false });
                assert.strictEqual(indicator.status, "Fair");
                assert.strictEqual(indicator.dotClass, "fair");
            }
        });

        it("maps Good score (60..79) to 'good' (green)", () => {
            for (const score of [60, 72, 79]) {
                const indicator = resolveConnectivityIndicator(score, { isOffline: false });
                assert.strictEqual(indicator.status, "Good");
                assert.strictEqual(indicator.dotClass, "good");
            }
        });

        it("maps Excellent score (80..100) to 'excellent' (green)", () => {
            for (const score of [80, 92, 100]) {
                const indicator = resolveConnectivityIndicator(score, { isOffline: false });
                assert.strictEqual(indicator.status, "Excellent");
                assert.strictEqual(indicator.dotClass, "excellent");
            }
        });

        it("maps score 0 when online and idle to 'Online' + 'connected'", () => {
            const indicator = resolveConnectivityIndicator(0, { isOffline: false });
            assert.strictEqual(indicator.status, "Online");
            assert.strictEqual(indicator.dotClass, "connected");
        });
    });

    describe("resolveDashboardDisplayState()", () => {
        it("renders 'Unavailable' for download, upload, ping, jitter, packetLoss and score 0 when offline", () => {
            const state = resolveDashboardDisplayState(
                {
                    download: 54.2,
                    upload: 12.8,
                    ping: 24.5,
                    jitter: 3.1,
                    packetLoss: 0.2,
                    score: 88
                },
                { isOffline: true }
            );

            assert.strictEqual(state.download, "Unavailable");
            assert.strictEqual(state.upload, "Unavailable");
            assert.strictEqual(state.ping, "Unavailable");
            assert.strictEqual(state.jitter, "Unavailable");
            assert.strictEqual(state.packetLoss, "Unavailable");
            assert.strictEqual(state.score, 0);
            assert.strictEqual(state.metricsSubtitle, "Offline — live measurements unavailable");
            assert.strictEqual(state.indicator.status, "Offline");
            assert.strictEqual(state.indicator.dotClass, "disconnected");
        });

        it("labels history-restored online measurements clearly until a live test runs", () => {
            const state = resolveDashboardDisplayState(
                {
                    download: 0.4,
                    upload: 0.3,
                    ping: null,
                    jitter: null,
                    packetLoss: null,
                    score: 1
                },
                { isOffline: false, isHistoryRestored: true }
            );

            assert.strictEqual(state.download, "0.4");
            assert.strictEqual(state.upload, "0.3");
            assert.strictEqual(state.ping, "Unavailable");
            assert.strictEqual(
                state.metricsSubtitle,
                "Last recorded measurements (run a test for live metrics)"
            );
            assert.strictEqual(state.indicator.status, "Poor");
            assert.strictEqual(state.indicator.dotClass, "poor");
        });

        it("labels live online test results as 'Live performance measurements'", () => {
            const state = resolveDashboardDisplayState(
                {
                    download: 85.4,
                    upload: 22.1,
                    ping: 14,
                    jitter: 2,
                    packetLoss: 0,
                    score: 91
                },
                { isOffline: false, isHistoryRestored: false }
            );

            assert.strictEqual(state.download, "85.4");
            assert.strictEqual(state.upload, "22.1");
            assert.strictEqual(state.metricsSubtitle, "Live performance measurements");
            assert.strictEqual(state.indicator.status, "Excellent");
            assert.strictEqual(state.indicator.dotClass, "excellent");
        });
    });

    describe("DOM Updates & Offline/Online Transitions", () => {
        it("applies red 'poor' class (not green 'connected') when score is 1 ('Poor')", () => {
            withMockBrowserEnv(
                { onLine: true, connection: { type: "wifi", effectiveType: "4g" } },
                (dom) => {
                    detectNetworkType();
                    const indicator = applyConnectivityStatusIndicator(1);
                    assert.strictEqual(indicator.status, "Poor");
                    assert.strictEqual(indicator.dotClass, "poor");
                    assert.strictEqual(dom.status.textContent, "Poor");
                    assert.strictEqual(dom.networkStatusDot.classList.contains("poor"), true);
                    assert.strictEqual(dom.networkStatusDot.classList.contains("connected"), false);
                    assert.strictEqual(dom.status.classList.contains("poor"), true);
                }
            );
        });

        it("switches dot class cleanly between Poor -> Fair -> Good -> Excellent -> Offline", () => {
            withMockBrowserEnv(
                { onLine: true, connection: { type: "wifi" } },
                (dom, mockNav) => {
                    applyConnectivityStatusIndicator(15);
                    assert.strictEqual(dom.status.textContent, "Poor");
                    assert.deepStrictEqual(dom.networkStatusDot.classList.toArray(), ["poor"]);

                    applyConnectivityStatusIndicator(50);
                    assert.strictEqual(dom.status.textContent, "Fair");
                    assert.deepStrictEqual(dom.networkStatusDot.classList.toArray(), ["fair"]);

                    applyConnectivityStatusIndicator(70);
                    assert.strictEqual(dom.status.textContent, "Good");
                    assert.deepStrictEqual(dom.networkStatusDot.classList.toArray(), ["good"]);

                    applyConnectivityStatusIndicator(90);
                    assert.strictEqual(dom.status.textContent, "Excellent");
                    assert.deepStrictEqual(dom.networkStatusDot.classList.toArray(), ["excellent"]);

                    mockNav.onLine = false;
                    applyConnectivityStatusIndicator(90);
                    assert.strictEqual(dom.status.textContent, "Offline");
                    assert.deepStrictEqual(dom.networkStatusDot.classList.toArray(), ["disconnected"]);
                }
            );
        });

        it("clears previous download/upload values to 'Unavailable' when transitioning online -> offline", async () => {
            const fresh = loadFreshScriptModule();
            await withMockBrowserEnv(
                { onLine: true, connection: { type: "wifi", effectiveType: "4g" } },
                async (dom, mockNav) => {
                    // Fresh state with history returned while online
                    global.fetch = async () => ({
                        ok: true,
                        json: async () => [
                            {
                                timestamp: "2026-11-11T10:00:00.000Z",
                                download_mbps: 0.4,
                                upload_mbps: 0.3,
                                ping_ms: null,
                                jitter_ms: null,
                                packet_loss: null,
                                connectivity_score: 1
                            }
                        ]
                    });

                    await fresh.loadNetworkHistory("all");
                    fresh.detectNetworkType();
                    fresh.updateDashboard();

                    assert.strictEqual(dom.download.textContent, "0.4");
                    assert.strictEqual(dom.upload.textContent, "0.3");
                    assert.strictEqual(dom.status.textContent, "Poor");
                    assert.strictEqual(dom.networkStatusDot.classList.contains("poor"), true);
                    assert.strictEqual(
                        dom.metricsSubtitle.textContent,
                        "Last recorded measurements (run a test for live metrics)"
                    );

                    // Now go offline: previous download/upload MUST become 'Unavailable'
                    mockNav.onLine = false;
                    fresh.handleConnectivityTransition({ showToastNotification: false });

                    assert.strictEqual(dom.download.textContent, "Unavailable");
                    assert.strictEqual(dom.upload.textContent, "Unavailable");
                    assert.strictEqual(dom.ping.textContent, "Unavailable");
                    assert.strictEqual(dom.jitter.textContent, "Unavailable");
                    assert.strictEqual(dom.packetLoss.textContent, "Unavailable");
                    assert.strictEqual(dom.networkType.textContent, "Offline");
                    assert.strictEqual(dom.score.textContent, "0");
                    assert.strictEqual(dom.scoreProgress.style.width, "0%");
                    assert.strictEqual(dom.scoreMeter.getAttribute("aria-valuenow"), "0");
                    assert.strictEqual(dom.status.textContent, "Offline");
                    assert.strictEqual(dom.networkStatusDot.classList.contains("disconnected"), true);
                    assert.strictEqual(
                        dom.metricsSubtitle.textContent,
                        "Offline — live measurements unavailable"
                    );

                    // Transition back online: stale speeds remain 'Unavailable' until tested
                    mockNav.onLine = true;
                    mockNav.connection.type = "wifi";
                    fresh.handleConnectivityTransition({ showToastNotification: false });

                    assert.strictEqual(dom.networkType.textContent, "Wi-Fi");
                    assert.strictEqual(dom.download.textContent, "Unavailable");
                    assert.strictEqual(dom.upload.textContent, "Unavailable");
                    assert.strictEqual(dom.status.textContent, "Online");
                    assert.strictEqual(dom.networkStatusDot.classList.contains("connected"), true);
                    assert.strictEqual(
                        dom.metricsSubtitle.textContent,
                        "Live performance measurements"
                    );
                    assert.strictEqual(
                        dom.testMessage.textContent,
                        "Run a connectivity test to analyse your network."
                    );
                }
            );
        });

        it("handles connection.type === 'none' as offline even if navigator.onLine is true", () => {
            const fresh = loadFreshScriptModule();
            withMockBrowserEnv(
                { onLine: true, connection: { type: "none" } },
                (dom) => {
                    assert.strictEqual(fresh.isDeviceOffline(), true);
                    assert.strictEqual(fresh.getConnectivityStatus(85), "Offline");

                    fresh.handleConnectivityTransition({ showToastNotification: false });
                    assert.strictEqual(dom.download.textContent, "Unavailable");
                    assert.strictEqual(dom.upload.textContent, "Unavailable");
                    assert.strictEqual(dom.networkType.textContent, "Offline");
                    assert.strictEqual(dom.status.textContent, "Offline");
                    assert.strictEqual(dom.networkStatusDot.classList.contains("disconnected"), true);
                }
            );
        });

        it("prevents loadNetworkHistory() from restoring download/upload into real-time cards while offline", async () => {
            const fresh = loadFreshScriptModule();
            await withMockBrowserEnv(
                { onLine: false, connection: { type: "none" } },
                async (dom) => {
                    global.fetch = async () => ({
                        ok: true,
                        json: async () => [
                            {
                                timestamp: "2026-11-11T10:00:00.000Z",
                                download_mbps: 0.4,
                                upload_mbps: 0.3,
                                connectivity_score: 1
                            }
                        ]
                    });

                    await fresh.loadNetworkHistory("all");
                    fresh.detectNetworkType();
                    fresh.updateDashboard();

                    assert.strictEqual(dom.download.textContent, "Unavailable");
                    assert.strictEqual(dom.upload.textContent, "Unavailable");
                    assert.strictEqual(dom.score.textContent, "0");
                    assert.strictEqual(dom.status.textContent, "Offline");
                    assert.strictEqual(dom.networkStatusDot.classList.contains("disconnected"), true);
                    assert.strictEqual(fresh.smartConnectivity.getCurrentNetworkData().history.length, 1);
                }
            );
        });
    });

    describe("CSS & Markup Consistency for Status Indicators", () => {
        it("defines Poor as red (#ef4444) and Fair as amber (#f59e0b) in both index.html and css/style.css", () => {
            const repoRoot = path.resolve(__dirname, "..");
            const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
            const css = fs.readFileSync(path.join(repoRoot, "css", "style.css"), "utf8");

            for (const source of [html, css]) {
                assert.match(source, /\.status-dot\.poor[\s\S]*?#ef4444/i);
                assert.match(source, /\.status-dot\.fair[\s\S]*?#f59e0b/i);
                assert.match(source, /\.status-dot\.excellent[\s\S]*?#22c55e/i);
                assert.match(source, /\.status-dot\.good[\s\S]*?#22c55e/i);
                assert.match(source, /\.status-dot\.disconnected[\s\S]*?#ef4444/i);
            }

            assert.match(html, /id="metricsSubtitle"/);
            assert.match(html, /id="scoreMeter"/);
        });
    });
});
