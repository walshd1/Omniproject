import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/logging-sync.ts over the REAL app — the SECURITY-classified `logging-sync` config def (Phase C).
 * GET is any-authed; PUT is admin + validated (sanitizeLoggingSync: url + warranty-ack before enable → 400).
 * Enabling REDUCES the posture → held for a signed sign-off (202 + pending); disabling strengthens → 200.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "logging-sync-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });
afterEach(async () => {
  const { writeOrgConfigCollection } = await import("../lib/scoped-config");
  writeOrgConfigCollection("logging-sync", "Logging sync", { enabled: false, url: null, acknowledgedWarranty: false });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();
const put = (loggingSync: unknown) => h.req("/logging-sync", { method: "PUT", cookie: adminCookie(), body: { loggingSync } });

test("GET without a cookie → 401", async () => {
  assert.equal((await h.req("/logging-sync")).status, 401);
});

test("GET defaults to off when nothing is stored", async () => {
  const r = await h.req("/logging-sync", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).loggingSync, { enabled: false, url: null, acknowledgedWarranty: false });
});

test("PUT enabling without a warranty acknowledgement → 400", async () => {
  const r = await put({ enabled: true, url: "https://logs.internal:9200/ingest", acknowledgedWarranty: false });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /warranty/i);
});

test("PUT enabling with a metadata URL → 400 (SSRF)", async () => {
  const r = await put({ enabled: true, url: "http://169.254.169.254/ingest", acknowledgedWarranty: true });
  assert.equal(r.status, 400);
});

test("PUT enabling (relax) is held for a signed sign-off → 202 + pending, value unchanged", async () => {
  const r = await put({ enabled: true, url: "https://logs.internal:9200/ingest", acknowledgedWarranty: true });
  assert.equal(r.status, 202);
  const body = await json(r);
  assert.ok(body.pending?.proposalId, "a proposal id is returned");
  assert.deepEqual(body.pending?.relaxes, ["logging-sync"]);
  // Still off — the enable is pending the sign-off, not applied.
  assert.equal((await json(await h.req("/logging-sync", { cookie: adminCookie() }))).loggingSync.enabled, false);
});

test("PUT disabling (strengthen) applies immediately → 200", async () => {
  const { writeOrgConfigCollection } = await import("../lib/scoped-config");
  writeOrgConfigCollection("logging-sync", "Logging sync", { enabled: true, url: "https://logs.internal/ingest", acknowledgedWarranty: true });
  const r = await put({ enabled: false, url: null, acknowledgedWarranty: false });
  assert.equal(r.status, 200);
  assert.equal((await json(r)).loggingSync.enabled, false);
});
