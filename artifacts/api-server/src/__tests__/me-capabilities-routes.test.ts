import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * GET /api/me/capabilities over the REAL app — the UX hint the SPA uses to hide a surface whose governed
 * capability an admin has turned off (e.g. the Invoices nav under `finance:ar`). A pure read: the list is the
 * governed capabilities whose effective state isn't "off", or that a custom-role grant lifts for the caller.
 * The gate is still ENFORCED at each route; this endpoint is presentation only.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "me-capabilities-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ capabilityStates: { "finance:ar": { state: "off" } } });
});

async function enabled(cookie = ADMIN): Promise<string[]> {
  const r = await h.req("/me/capabilities", { cookie });
  assert.equal(r.status, 200);
  return ((await r.json()) as { enabled: string[] }).enabled;
}

test("everything is off by default, so no finance capability is listed as enabled", async () => {
  const ids = await enabled();
  assert.ok(!ids.includes("finance:ar"), "finance:ar is off by default");
  assert.ok(!ids.some((id) => id.startsWith("finance:")), "no finance capability enabled by default");
});

test("turning a capability on surfaces it in the enabled list; turning it off drops it again", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ capabilityStates: { "finance:ar": { state: "user-defined" } } });
  assert.ok((await enabled()).includes("finance:ar"), "finance:ar shows once enabled");

  updateSettings({ capabilityStates: { "finance:ar": { state: "off" } } });
  assert.ok(!(await enabled()).includes("finance:ar"), "finance:ar drops once turned off");
});

test("the read needs no session — a signed-out caller gets the same off-by-default list", async () => {
  const r = await h.req("/me/capabilities");
  assert.equal(r.status, 200);
  const { enabled: ids } = (await r.json()) as { enabled: string[] };
  assert.ok(!ids.includes("finance:ar"));
});
