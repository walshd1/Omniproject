/**
 * Manual connector smoke test — drives the REAL app in a real browser against a live backend
 * (e.g. the docker-compose.loadtest.yml stack: gateway + n8n + OpenProject) and saves screenshots
 * as evidence the connector actually works end to end, not just against demo-mode sample data.
 *
 * NOT part of the CI/build pipeline and not wired into scripts/package.json — this is a one-off,
 * run-it-yourself tool for local verification. It reuses this repo's existing Playwright
 * dependency (@playwright/test, already a root devDependency for playwright.config.ts) rather
 * than adding a new one.
 *
 * Usage:
 *   pnpm exec tsx scripts/manual/connector-smoke-screenshots.ts
 *   BASE_URL=http://localhost:5000 OUT_DIR=./smoke-screenshots pnpm exec tsx scripts/manual/connector-smoke-screenshots.ts
 *   HEADED=1 pnpm exec tsx scripts/manual/connector-smoke-screenshots.ts   # watch it drive the browser
 *
 * Prerequisites: the app must already be reachable at BASE_URL with a real broker wired
 * (BROKER_URL pointed at an ACTIVATED n8n workflow) — this script only drives the UI, it doesn't
 * stand up the stack or import/activate the workflow for you. See the compose file's own header
 * comment and the accompanying chat guidance for that one-time setup.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const BASE_URL = process.env["BASE_URL"] ?? "http://localhost:5000";
const OUT_DIR = process.env["OUT_DIR"] ?? "./smoke-screenshots";
const HEADED = process.env["HEADED"] === "1";

// Same pre-installed-browser detection as playwright.config.ts: some environments (this repo's
// remote sandbox) ship Chromium at a fixed path instead of Playwright's own managed install.
// Falls through to Playwright's normal resolution (e.g. after `pnpm exec playwright install`)
// when that path doesn't exist — so this runs unmodified on a normal machine too.
const PRE_INSTALLED = "/opt/pw-browsers/chromium";
const executablePath = [process.env["PW_CHROMIUM"], PRE_INSTALLED].find((p) => p && existsSync(p));

// Matches the product rule (and the existing e2e helpers): the login screen's single control
// reads "ENTER (DEMO MODE)" when no real OIDC/SAML/OAuth2 provider is configured (which is the
// case in the loadtest stack — it wires a broker, not an identity provider) or "SIGN IN..." once
// one is. Demo AUTH with a REAL broker still uses this button; only the DATA behind it is real.
const LOGIN_BUTTON = /enter \(demo mode\)|sign in/i;

async function shoot(page: import("@playwright/test").Page, name: string) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  → ${file}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: !HEADED, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  console.log(`Driving ${BASE_URL} …`);

  console.log("1. Login");
  await page.goto(`${BASE_URL}/login`);
  await page.getByRole("button", { name: LOGIN_BUTTON }).click();
  await page.waitForURL(/\/$|\/#?$/);
  await shoot(page, "01-dashboard");

  console.log("2. Configurator → Verify (proves the real broker contract works)");
  await page.goto(`${BASE_URL}/configurator`);
  await page.waitForLoadState("networkidle");
  await shoot(page, "02-configurator");
  const verifyButton = page.getByRole("button", { name: /run the check/i });
  if (await verifyButton.isVisible().catch(() => false)) {
    await verifyButton.click();
    // Verification calls the real broker webhook per action — give it real network time,
    // not the fast local-mock timing demo mode would have.
    await page.waitForTimeout(3_000);
    await shoot(page, "03-verify-result");
  } else {
    console.log("   (Verify button not visible/enabled — connect step 2 first; see docs/QUICKSTART.md)");
  }

  console.log("3. Projects list (real backend data, not demo sample data)");
  await page.goto(`${BASE_URL}/projects`);
  await page.waitForLoadState("networkidle");
  await shoot(page, "04-projects-list");

  console.log("4. First real project's detail page");
  const firstProjectLink = page.locator('a[href^="/projects/"]').first();
  if (await firstProjectLink.isVisible().catch(() => false)) {
    await firstProjectLink.click();
    await page.waitForLoadState("networkidle");
    await shoot(page, "05-project-detail");
  } else {
    console.log("   (No project rows found — is the connector actually wired + returning data?)");
  }

  await browser.close();
  console.log(`\nDone. Screenshots in ${OUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
