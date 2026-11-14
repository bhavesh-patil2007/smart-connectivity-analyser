const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const output = path.join(process.cwd(), "artifacts");
fs.mkdirSync(output, { recursive: true });

const sampleHistory = [
  {
    timestamp: "2026-11-09T09:00:00.000Z",
    download_mbps: 24.5,
    upload_mbps: 8.2,
    ping_ms: 42,
    jitter_ms: 4,
    packet_loss: 0,
    connectivity_score: 78
  },
  {
    timestamp: "2026-11-09T10:00:00.000Z",
    download_mbps: 38.7,
    upload_mbps: 12.4,
    ping_ms: 35,
    jitter_ms: 3,
    packet_loss: 0,
    connectivity_score: 86
  }
];

async function openScenario(browser, scenario, viewport = { width: 1440, height: 1000 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    window.API_BASE = "http://127.0.0.1:8000/api";
  });

  // The browser scenarios use mocked API responses and do not depend on
  // third-party CDN assets. Block external requests so a slow or unavailable
  // font/script CDN cannot stall DOMContentLoaded in CI.
  await page.route("https://**/*", (route) => route.abort());

  await page.route("http://127.0.0.1:8000/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/network-history")) {
      if (scenario === "api-failure") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "History service unavailable (demo)" })
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(scenario === "populated" || scenario === "ai-fallback" ? sampleHistory : [])
        });
      }
      return;
    }
    if (url.pathname.endsWith("/ai/analyze")) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "AI model dependencies unavailable (demo)" })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("http://127.0.0.1:4173/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const empty = document.getElementById("historyEmptyState");
    const error = document.getElementById("historyErrorState");
    const chart = document.getElementById("historyChartContainer");
    return empty && error && chart && (
      !empty.hidden || !error.hidden || !chart.hidden
    );
  }, { timeout: 20000 });
  return page;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const empty = await openScenario(browser, "empty");
    await empty.waitForFunction(() => !document.getElementById("historyEmptyState").hidden);
    assert.equal(await empty.locator("#historyErrorState").isVisible(), false);
    assert.equal((await empty.locator("#historyFilterMessage").innerText()).trim(), "");
    await empty.screenshot({ path: path.join(output, "issue-5-empty-history.png"), fullPage: true });
    await empty.close();

    const failed = await openScenario(browser, "api-failure");
    await failed.waitForFunction(() => !document.getElementById("historyErrorState").hidden);
    assert.equal(await failed.locator("#historyEmptyState").isVisible(), false);
    assert.equal((await failed.locator("#historyFilterMessage").innerText()).trim(), "");
    await failed.screenshot({ path: path.join(output, "issue-5-history-api-failure.png"), fullPage: true });
    await failed.close();

    const populated = await openScenario(browser, "populated");
    await populated.waitForFunction(() => !document.getElementById("historyChartContainer").hidden);
    assert.equal(await populated.locator("#historyEmptyState").isVisible(), false);
    assert.equal(await populated.locator("#historyErrorState").isVisible(), false);
    await populated.screenshot({ path: path.join(output, "issue-5-populated-history.png"), fullPage: true });
    await populated.close();


    // Verify both empty-history and API-error states at a mobile viewport.
    const mobileViewport = { width: 390, height: 844 };

    const mobileEmpty = await openScenario(browser, "empty", mobileViewport);
    await mobileEmpty.waitForFunction(() => !document.getElementById("historyEmptyState").hidden);
    assert.equal(await mobileEmpty.locator("#historyEmptyState").isVisible(), true);
    assert.equal(await mobileEmpty.locator("#historyErrorState").isVisible(), false);
    assert.deepEqual(mobileEmpty.viewportSize(), mobileViewport);
    await mobileEmpty.screenshot({ path: path.join(output, "issue-5-mobile-empty-history.png"), fullPage: true });
    await mobileEmpty.close();

    const mobileFailed = await openScenario(browser, "api-failure", mobileViewport);
    await mobileFailed.waitForFunction(() => !document.getElementById("historyErrorState").hidden);
    assert.equal(await mobileFailed.locator("#historyErrorState").isVisible(), true);
    assert.equal(await mobileFailed.locator("#historyEmptyState").isVisible(), false);
    assert.deepEqual(mobileFailed.viewportSize(), mobileViewport);
    await mobileFailed.screenshot({ path: path.join(output, "issue-5-mobile-history-api-failure.png"), fullPage: true });
    await mobileFailed.close();

    const ai = await openScenario(browser, "ai-fallback");
    await ai.waitForFunction(() => {
      const prediction = document.getElementById("predictionResult")?.textContent || "";
      return prediction.includes("improving") || prediction.includes("declining") || prediction.includes("stable");
    }, { timeout: 20000 });
    const fallbackText = await ai.locator("#predictionResult").innerText();
    assert.match(fallbackText, /AI service is unavailable\. Showing local analysis/i);
    assert.match(fallbackText, /improving|declining|stable/i);
    await ai.screenshot({ path: path.join(output, "issue-5-ai-fallback.png"), fullPage: true });
    await ai.close();

    console.log("All four Issue #5 browser scenarios passed, including both 390x844 mobile checks. Screenshots saved in artifacts/.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
