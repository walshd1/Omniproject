import { defineConfig } from "@playwright/test";
import fs from "node:fs";

/**
 * Acceptance (end-to-end) harness. Drives the REAL built SPA in a real browser against the gateway
 * running in DEMO mode (stateless, sample data, demo auth — no broker/backend), so these specs
 * prove the product *behaves as intended* from the user's seat, not just that functions return X.
 *
 * Browser: the environment ships Chromium pre-installed under /opt/pw-browsers (symlinked at
 * /opt/pw-browsers/chromium). We point `executablePath` at it and never run `playwright install`.
 *
 * Build + serve: `pnpm e2e` builds the SPA + gateway first; the webServer below boots one Node
 * process that serves the built SPA (STATIC_DIR) and the API on PORT 5050.
 *
 * Every journey is written twice — a mouse path AND a keyboard-only path — because the product rule
 * is that every affordance is operable by both pointer and keyboard.
 */

const PORT = 5050;
const PRE_INSTALLED = "/opt/pw-browsers/chromium";
const executablePath = [process.env["PW_CHROMIUM"], PRE_INSTALLED].find((p) => p && fs.existsSync(p));

export default defineConfig({
  testDir: "artifacts/omniproject/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "line" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    trace: "on-first-retry",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command:
      `STATIC_DIR=artifacts/omniproject/dist/public PORT=${PORT} ` +
      `SESSION_SECRET=e2e-acceptance-deterministic-secret ` +
      // Demo/test server: disable the per-IP rate limiter so the full suite's repeated logins
      // don't trip it (deterministic runs; never set this in production).
      `RATE_LIMIT_DISABLED=true ` +
      `node --enable-source-maps artifacts/api-server/dist/index.mjs`,
    // Readiness on the SPA shell ("/" → 200). The deeper /healthz probe can report 500 in demo
    // (no broker wired), which Playwright would treat as never-ready.
    url: `http://127.0.0.1:${PORT}/`,
    timeout: 90_000,
    reuseExistingServer: !process.env["CI"],
  },
});
