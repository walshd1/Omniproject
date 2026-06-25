#!/usr/bin/env node
/**
 * Accessibility scan — axe-core (WCAG 2.1 A/AA) over the built SPA in a real
 * browser. Fails (exit 1) on any violation.
 *
 * Standalone CommonJS on purpose: Playwright + axe-core are NOT workspace deps
 * (the SPA doesn't ship them), so this resolves them via `require`, which honours
 * NODE_PATH. That lets CI install the browser tooling into a throwaway dir and
 * point NODE_PATH at it — no lockfile churn. If the tooling isn't resolvable it
 * prints SKIPPED and exits 0, so it never breaks the default test run.
 *
 * Local:
 *   mkdir -p /tmp/a11y && (cd /tmp/a11y && npm i playwright axe-core)
 *   npx --prefix /tmp/a11y playwright install chromium   # or use the system Chromium
 *   # build the SPA, boot the gateway with STATIC_DIR=…/dist/public, then:
 *   NODE_PATH=/tmp/a11y/node_modules A11Y_BASE=http://localhost:3000 node scripts/a11y-scan.cjs
 */
"use strict";
const { execSync } = require("node:child_process");

const BASE = process.env.A11Y_BASE || process.env.OMNI_API_BASE || "http://localhost:3000";
const ROUTES = (process.env.A11Y_ROUTES || "/,/projects,/reports,/settings")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);

function findChromium() {
  try {
    return execSync("find /opt/pw-browsers -type f -name chrome 2>/dev/null | head -1").toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

(async () => {
  let chromium, axeSource;
  try {
    ({ chromium } = require("playwright"));
    axeSource = require("axe-core").source;
    if (!chromium || !axeSource) throw new Error("missing exports");
  } catch {
    console.log(
      "a11y: SKIPPED — playwright + axe-core not resolvable. Install them and set NODE_PATH (see header).",
    );
    process.exit(0);
  }

  const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
  const page = await browser.newPage();
  let total = 0;

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.evaluate(axeSource);
    const result = await page.evaluate(async () =>
      window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }),
    );
    const nodes = result.violations.reduce((s, v) => s + v.nodes.length, 0);
    total += nodes;
    console.log(`\n  ${route} — ${result.violations.length} violation type(s), ${nodes} node(s)`);
    for (const v of result.violations) {
      console.log(`    [${v.impact}] ${v.id}: ${v.help} (x${v.nodes.length})`);
    }
  }

  await browser.close();

  if (total > 0) {
    console.error(`\n✗ a11y: ${total} WCAG A/AA violation node(s) across ${ROUTES.length} route(s)`);
    process.exit(1);
  }
  console.log(`\n✓ a11y: 0 WCAG A/AA violations across ${ROUTES.length} route(s)`);
})().catch((err) => {
  console.error("a11y: error —", (err && err.message) || err);
  process.exit(1);
});
