import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/error-telemetry.ts over the REAL app — the SECURITY-classified `error-telemetry` config def (Phase C).
 * GET is any-authed; PUT is admin + validated boolean. Because enabling REDUCES the posture it is HELD for a
 * signed sign-off (202 + pending); disabling strengthens and applies immediately (200). Store enabled.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "error-telemetry-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });
afterEach(async () => {
  const { writeOrgConfigCollection } = await import("../lib/scoped-config");
  writeOrgConfigCollection("error-telemetry", "Error telemetry", false);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET without a cookie → 401", async () => {
  assert.equal((await h.req("/error-telemetry")).status, 401);
});

test("GET defaults to false (off) when nothing is stored", async () => {
  const r = await h.req("/error-telemetry", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.equal((await json(r)).errorTelemetry, false);
});

test("PUT false (strengthen/off) applies immediately → 200", async () => {
  const { writeOrgConfigCollection } = await import("../lib/scoped-config");
  writeOrgConfigCollection("error-telemetry", "Error telemetry", true); // start ON so OFF is a strengthening move
  const r = await h.req("/error-telemetry", { method: "PUT", cookie: adminCookie(), body: { errorTelemetry: false } });
  assert.equal(r.status, 200);
  assert.equal((await json(r)).errorTelemetry, false);
});

test("PUT true (enable = relax) is held for a signed sign-off → 202 + pending, value unchanged", async () => {
  const r = await h.req("/error-telemetry", { method: "PUT", cookie: adminCookie(), body: { errorTelemetry: true } });
  assert.equal(r.status, 202);
  const body = await json(r);
  assert.ok(body.pending?.proposalId, "a proposal id is returned");
  assert.deepEqual(body.pending?.relaxes, ["error-telemetry"]);
  // Still off — the enable is pending the sign-off, not applied.
  assert.equal((await json(await h.req("/error-telemetry", { cookie: adminCookie() }))).errorTelemetry, false);
});

test("PUT a non-boolean → 400", async () => {
  const r = await h.req("/error-telemetry", { method: "PUT", cookie: adminCookie(), body: { errorTelemetry: "yes" } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /boolean/i);
});
