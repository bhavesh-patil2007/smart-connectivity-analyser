/**
 * Tests for Network Type Detection (Issue #3)
 *
 * Verifies that:
 * 1. Physical connection mediums (Wi-Fi, Cellular, Ethernet, Bluetooth, WiMAX) are detected accurately.
 * 2. Effective connection types ('3g', '4g') are NEVER falsely presented as confirmed cellular generations.
 * 3. Cellular connections are labeled as 'Mobile' without making unverified generation claims (like 5G/4G/3G).
 * 4. Unsupported browser APIs (Safari, Firefox) and unknown connection states are handled gracefully.
 * 5. Offline states (navigator.onLine = false, type = 'none') are correctly reported as 'Offline'.
 * 6. The returned network type string adheres to backend database length constraints (<= 50 chars).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
    resolveNetworkType,
    detectNetworkType
} = require("../js/script.js");

describe("Network Type Detection Suite", () => {

    /* =========================================================
       1. Physical Connection Media Detection
       ========================================================= */
    describe("Verified Physical Media", () => {
        it("identifies Wi-Fi connections", () => {
            const result = resolveNetworkType({ type: "wifi" }, true);
            assert.strictEqual(result.type, "Wi-Fi");
            assert.strictEqual(result.isKnown, true);
            assert.strictEqual(result.detail, "Wi-Fi connection");
        });

        it("handles case-insensitive Wi-Fi type strings", () => {
            const result = resolveNetworkType({ type: "WIFI" }, true);
            assert.strictEqual(result.type, "Wi-Fi");
            assert.strictEqual(result.isKnown, true);
        });

        it("identifies Ethernet connections", () => {
            const result = resolveNetworkType({ type: "ethernet" }, true);
            assert.strictEqual(result.type, "Ethernet");
            assert.strictEqual(result.isKnown, true);
            assert.strictEqual(result.detail, "Wired ethernet connection");
        });

        it("identifies Bluetooth tethering", () => {
            const result = resolveNetworkType({ type: "bluetooth" }, true);
            assert.strictEqual(result.type, "Bluetooth");
            assert.strictEqual(result.isKnown, true);
            assert.strictEqual(result.detail, "Bluetooth tethering connection");
        });

        it("identifies WiMAX connections", () => {
            const result = resolveNetworkType({ type: "wimax" }, true);
            assert.strictEqual(result.type, "WiMAX");
            assert.strictEqual(result.isKnown, true);
            assert.strictEqual(result.detail, "WiMAX wireless connection");
        });
    });

    /* =========================================================
       2. Cellular Generation Handling (Issue #3 Core Requirement)
       ========================================================= */
    describe("Cellular Network Handling & Generation Disclaimer", () => {
        it("reports cellular medium as 'Mobile' without fabricating 3G/4G/5G generation", () => {
            const result = resolveNetworkType({ type: "cellular" }, true);
            assert.strictEqual(result.type, "Mobile");
            assert.strictEqual(result.isKnown, true);
            assert.match(result.detail, /generation unverified/i);
        });

        it("does NOT display '3G' when device is on cellular with 3g effectiveType", () => {
            const result = resolveNetworkType({
                type: "cellular",
                effectiveType: "3g"
            }, true);

            // Must NOT claim "3G" as confirmed type
            assert.strictEqual(result.type, "Mobile");
            assert.strictEqual(result.isKnown, true);
            // Explicitly identifies speed tier while stating generation is unverified
            assert.match(result.detail, /~3G speed tier/i);
            assert.match(result.detail, /generation unverified/i);
        });

        it("does NOT display '4G' when device is on cellular with 4g effectiveType (e.g. 5G phone)", () => {
            const result = resolveNetworkType({
                type: "cellular",
                effectiveType: "4g"
            }, true);

            // Must NOT claim "4G" as confirmed type
            assert.strictEqual(result.type, "Mobile");
            assert.strictEqual(result.isKnown, true);
            assert.match(result.detail, /~4G speed tier/i);
            assert.match(result.detail, /generation unverified/i);
        });
    });

    /* =========================================================
       3. Avoid Misleading effectiveType Fallbacks (Desktop/Chromium)
       ========================================================= */
    describe("effectiveType without Physical Medium", () => {
        it("does NOT display '4G' when browser only provides effectiveType: '4g' (e.g. desktop Chrome)", () => {
            const result = resolveNetworkType({
                effectiveType: "4g"
            }, true);

            // In desktop Chrome, type is undefined but effectiveType is '4g'.
            // It MUST NOT report '4G' on home fiber / desktop Wi-Fi.
            assert.strictEqual(result.type, "Unknown");
            assert.strictEqual(result.isKnown, false);
            assert.match(result.detail, /medium unverified/i);
            assert.match(result.detail, /~4G speed tier/i);
        });

        it("does NOT display '3G' when browser only provides effectiveType: '3g'", () => {
            const result = resolveNetworkType({
                effectiveType: "3g"
            }, true);

            assert.strictEqual(result.type, "Unknown");
            assert.strictEqual(result.isKnown, false);
            assert.match(result.detail, /medium unverified/i);
            assert.match(result.detail, /~3G speed tier/i);
        });
    });

    /* =========================================================
       4. Offline Detection
       ========================================================= */
    describe("Offline State Detection", () => {
        it("reports 'Offline' when isOnline is false regardless of cached connection", () => {
            const result = resolveNetworkType({ type: "wifi" }, false);
            assert.strictEqual(result.type, "Offline");
            assert.strictEqual(result.isKnown, true);
            assert.strictEqual(result.detail, "No internet connection");
            assert.strictEqual(result.effectiveType, null);
        });

        it("reports 'Offline' when connection.type is 'none'", () => {
            const result = resolveNetworkType({ type: "none" }, true);
            assert.strictEqual(result.type, "Offline");
            assert.strictEqual(result.isKnown, true);
            assert.strictEqual(result.detail, "No active network connection");
        });
    });

    /* =========================================================
       5. Unsupported & Unknown Browser Environments
       ========================================================= */
    describe("Unsupported & Unknown Browser APIs", () => {
        it("handles null connection gracefully (e.g. Safari / Firefox)", () => {
            const result = resolveNetworkType(null, true);
            assert.strictEqual(result.type, "Unknown");
            assert.strictEqual(result.isKnown, false);
            assert.strictEqual(result.detail, "Network Information API not supported by browser");
            assert.strictEqual(result.effectiveType, null);
        });

        it("handles undefined connection gracefully", () => {
            const result = resolveNetworkType(undefined, true);
            assert.strictEqual(result.type, "Unknown");
            assert.strictEqual(result.isKnown, false);
            assert.strictEqual(result.detail, "Network Information API not supported by browser");
        });

        it("handles empty object connection gracefully", () => {
            const result = resolveNetworkType({}, true);
            assert.strictEqual(result.type, "Unknown");
            assert.strictEqual(result.isKnown, false);
            assert.strictEqual(result.detail, "Network type not reported by browser");
        });

        it("handles connection with type: 'unknown'", () => {
            const result = resolveNetworkType({ type: "unknown" }, true);
            assert.strictEqual(result.type, "Unknown");
            assert.strictEqual(result.isKnown, false);
            assert.strictEqual(result.detail, "Network type not reported by browser");
        });

        it("handles connection with type: 'other'", () => {
            const result = resolveNetworkType({ type: "other" }, true);
            assert.strictEqual(result.type, "Unknown");
            assert.strictEqual(result.isKnown, false);
        });

        it("handles unrecognized connection types", () => {
            const result = resolveNetworkType({ type: "quantum_link" }, true);
            assert.strictEqual(result.type, "Unknown");
            assert.strictEqual(result.isKnown, false);
        });
    });

    /* =========================================================
       6. Backend Schema Constraint Verification
       ========================================================= */
    describe("Backend Database & Length Constraints", () => {
        it("ensures all returned network types are strings <= 50 characters", () => {
            const testCases = [
                { type: "wifi" },
                { type: "cellular", effectiveType: "4g" },
                { type: "cellular", effectiveType: "3g" },
                { type: "ethernet" },
                { type: "bluetooth" },
                { type: "wimax" },
                { type: "none" },
                { effectiveType: "4g" },
                { type: "unknown" },
                null
            ];

            for (const testCase of testCases) {
                const onlineResult = resolveNetworkType(testCase, true);
                assert.ok(typeof onlineResult.type === "string");
                assert.ok(onlineResult.type.length <= 50, `Type "${onlineResult.type}" exceeded 50 chars`);

                const offlineResult = resolveNetworkType(testCase, false);
                assert.ok(typeof offlineResult.type === "string");
                assert.ok(offlineResult.type.length <= 50, `Offline type "${offlineResult.type}" exceeded 50 chars`);
            }
        });
    });

    /* =========================================================
       7. detectNetworkType Runtime Safety
       ========================================================= */
    describe("detectNetworkType() Execution", () => {
        it("executes without throwing in environments where browser globals are absent", () => {
            const result = detectNetworkType();
            assert.ok(result);
            assert.ok(typeof result.type === "string");
            assert.ok(typeof result.isKnown === "boolean");
        });
    });

    /* =========================================================
       8. Browser Capability & Platform Verification
       ========================================================= */
    describe("Platform & Browser Capabilities", () => {
        describe("Android Chrome", () => {
            it("handles Android Chrome on Wi-Fi correctly reaching Wi-Fi return statement", () => {
                const connection = {
                    type: "wifi",
                    effectiveType: "4g",
                    downlink: 10,
                    rtt: 50
                };
                const result = resolveNetworkType(connection, true);
                assert.strictEqual(result.type, "Wi-Fi");
                assert.strictEqual(result.isKnown, true);
                assert.strictEqual(result.detail, "Wi-Fi connection");
                assert.strictEqual(result.effectiveType, "4g");
            });

            it("handles Android Chrome WLAN alias correctly reaching Wi-Fi return statement", () => {
                const connection = {
                    type: "wlan",
                    effectiveType: "4g"
                };
                const result = resolveNetworkType(connection, true);
                assert.strictEqual(result.type, "Wi-Fi");
                assert.strictEqual(result.isKnown, true);
            });

            it("handles Android Chrome on mobile data (cellular) in 5G/4G area without false hardware generation", () => {
                const connection = {
                    type: "cellular",
                    effectiveType: "4g",
                    downlink: 25,
                    rtt: 30
                };
                const result = resolveNetworkType(connection, true);
                assert.strictEqual(result.type, "Mobile");
                assert.strictEqual(result.isKnown, true);
                assert.strictEqual(result.detail, "Cellular (~4G speed tier, generation unverified)");
                assert.strictEqual(result.effectiveType, "4g");
            });

            it("handles Android Chrome on mobile data in congested area (effectiveType 3g) without claiming 3G", () => {
                const connection = {
                    type: "cellular",
                    effectiveType: "3g",
                    downlink: 1.5,
                    rtt: 200
                };
                const result = resolveNetworkType(connection, true);
                assert.strictEqual(result.type, "Mobile");
                assert.strictEqual(result.isKnown, true);
                assert.strictEqual(result.detail, "Cellular (~3G speed tier, generation unverified)");
                assert.strictEqual(result.effectiveType, "3g");
            });

            it("handles Android Chrome mobile data with legacy or alternative cellular aliases", () => {
                const mobileAlias = resolveNetworkType({ type: "mobile", effectiveType: "4g" }, true);
                assert.strictEqual(mobileAlias.type, "Mobile");
                assert.strictEqual(mobileAlias.isKnown, true);

                const cellular3gAlias = resolveNetworkType({ type: "cellular3g", effectiveType: "3g" }, true);
                assert.strictEqual(cellular3gAlias.type, "Mobile");
                assert.strictEqual(cellular3gAlias.isKnown, true);
            });
        });

        describe("Desktop Chrome", () => {
            it("handles desktop Chrome with omitted type and 4g effectiveType without misreporting 4G", () => {
                // Chromium on desktop omits connection.type, but provides effectiveType: "4g"
                const connection = {
                    type: undefined,
                    effectiveType: "4g",
                    downlink: 10,
                    rtt: 50
                };
                const result = resolveNetworkType(connection, true);
                assert.strictEqual(result.type, "Unknown");
                assert.strictEqual(result.isKnown, false);
                assert.strictEqual(result.detail, "Estimated ~4G speed tier (medium unverified)");
            });

            it("handles desktop Chrome with type: 'none' as Offline", () => {
                const connection = {
                    type: "none",
                    effectiveType: "4g"
                };
                const result = resolveNetworkType(connection, true);
                assert.strictEqual(result.type, "Offline");
                assert.strictEqual(result.isKnown, true);
            });
        });

        describe("Unsupported Browsers (Safari / Firefox)", () => {
            it("handles Safari (connection === undefined) gracefully", () => {
                const result = resolveNetworkType(undefined, true);
                assert.strictEqual(result.type, "Unknown");
                assert.strictEqual(result.isKnown, false);
                assert.strictEqual(result.detail, "Network Information API not supported by browser");
            });

            it("handles Firefox (connection === null) gracefully", () => {
                const result = resolveNetworkType(null, true);
                assert.strictEqual(result.type, "Unknown");
                assert.strictEqual(result.isKnown, false);
                assert.strictEqual(result.detail, "Network Information API not supported by browser");
            });
        });
    });

    /* =========================================================
       9. Offline-to-Online and Network Switching Transitions
       ========================================================= */
    describe("Transitions & State Changes", () => {
        it("handles offline-to-online transition", () => {
            const connection = { type: "wifi", effectiveType: "4g" };

            // Step 1: Device is offline
            const offlineState = resolveNetworkType(connection, false);
            assert.strictEqual(offlineState.type, "Offline");
            assert.strictEqual(offlineState.detail, "No internet connection");

            // Step 2: Connection restored
            const onlineState = resolveNetworkType(connection, true);
            assert.strictEqual(onlineState.type, "Wi-Fi");
            assert.strictEqual(onlineState.detail, "Wi-Fi connection");
        });

        it("handles online-to-offline transition", () => {
            const connection = { type: "cellular", effectiveType: "4g" };

            // Step 1: Device is online
            const onlineState = resolveNetworkType(connection, true);
            assert.strictEqual(onlineState.type, "Mobile");

            // Step 2: Device goes offline
            const offlineState = resolveNetworkType(connection, false);
            assert.strictEqual(offlineState.type, "Offline");
            assert.strictEqual(offlineState.detail, "No internet connection");
        });

        it("handles network switching transition: Wi-Fi to Mobile data", () => {
            // Step 1: Connected to Wi-Fi
            const wifiConnection = { type: "wifi", effectiveType: "4g" };
            const stateBefore = resolveNetworkType(wifiConnection, true);
            assert.strictEqual(stateBefore.type, "Wi-Fi");

            // Step 2: Switches to Cellular
            const cellularConnection = { type: "cellular", effectiveType: "4g" };
            const stateAfter = resolveNetworkType(cellularConnection, true);
            assert.strictEqual(stateAfter.type, "Mobile");
            assert.match(stateAfter.detail, /generation unverified/i);
        });

        it("handles network switching transition: Mobile data to Wi-Fi", () => {
            // Step 1: On Cellular
            const cellularConnection = { type: "cellular", effectiveType: "3g" };
            const stateBefore = resolveNetworkType(cellularConnection, true);
            assert.strictEqual(stateBefore.type, "Mobile");

            // Step 2: Connects to Wi-Fi
            const wifiConnection = { type: "wifi", effectiveType: "4g" };
            const stateAfter = resolveNetworkType(wifiConnection, true);
            assert.strictEqual(stateAfter.type, "Wi-Fi");
            assert.strictEqual(stateAfter.detail, "Wi-Fi connection");
        });

        it("handles network switching transition: Mobile data to No Network", () => {
            // Step 1: On Cellular
            const cellularConnection = { type: "cellular", effectiveType: "4g" };
            const stateBefore = resolveNetworkType(cellularConnection, true);
            assert.strictEqual(stateBefore.type, "Mobile");

            // Step 2: Drops connection (type: 'none')
            const disconnectedConnection = { type: "none" };
            const stateAfter = resolveNetworkType(disconnectedConnection, true);
            assert.strictEqual(stateAfter.type, "Offline");
            assert.strictEqual(stateAfter.detail, "No active network connection");
        });

        it("dynamically updates DOM elements across network transitions when detectNetworkType() runs", () => {
            const originalNavDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
            const originalDoc = global.document;
            const original$ = global.$;

            try {
                const dom = {};
                global.document = {
                    getElementById: (id) => dom[id] || (dom[id] = { textContent: "", dataset: {}, setAttribute(k, v) { this[k] = v; } })
                };
                global.$ = global.document.getElementById;

                const mockNav = {
                    onLine: true,
                    connection: {
                        type: "wifi",
                        effectiveType: "4g"
                    }
                };
                Object.defineProperty(globalThis, "navigator", {
                    value: mockNav,
                    configurable: true,
                    writable: true
                });

                // Initial Wi-Fi
                detectNetworkType();
                assert.strictEqual(dom.networkType.textContent, "Wi-Fi");
                assert.strictEqual(dom.networkTypeDetail.textContent, "Wi-Fi connection");
                assert.strictEqual(dom.networkType.dataset.known, "true");

                // Switch to Cellular
                mockNav.connection.type = "cellular";
                mockNav.connection.effectiveType = "4g";
                detectNetworkType();
                assert.strictEqual(dom.networkType.textContent, "Mobile");
                assert.match(dom.networkTypeDetail.textContent, /~4G speed tier/);
                assert.match(dom.networkTypeDetail.textContent, /generation unverified/);
                assert.strictEqual(dom.networkType.dataset.known, "true");

                // Go Offline
                mockNav.onLine = false;
                detectNetworkType();
                assert.strictEqual(dom.networkType.textContent, "Offline");
                assert.strictEqual(dom.networkTypeDetail.textContent, "No internet connection");
                assert.strictEqual(dom.networkType.dataset.known, "true");

                // Reconnect to Wi-Fi
                mockNav.onLine = true;
                mockNav.connection.type = "wifi";
                detectNetworkType();
                assert.strictEqual(dom.networkType.textContent, "Wi-Fi");
                assert.strictEqual(dom.networkTypeDetail.textContent, "Wi-Fi connection");
            } finally {
                if (originalNavDescriptor) {
                    Object.defineProperty(globalThis, "navigator", originalNavDescriptor);
                }
                global.document = originalDoc;
                global.$ = original$;
            }
        });
    });
});

