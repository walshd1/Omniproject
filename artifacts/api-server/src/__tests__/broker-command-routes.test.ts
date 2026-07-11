import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the generic broker command passthrough (routes/broker-command.ts).
 *
 * The route is contributor-gated (demo auth clears it). Its own guards are what's reachable here:
 *  - no backend wired (demo mode) → the normalised "unavailable" broker error, never a live call;
 *  - with a broker URL wired: an invalid body → 400, the per-vendor governance gate (off by
 *    default) → a "turned off" refusal, and a well-formed command dispatched against a bogus
 *    broker → the error catch. A live broker success is NOT exercised (needs a real n8n backend).
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());

const BROKER_URL = "https://example.com/webhook"; // passes the egress guard, fails as a real broker
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ brokerUrl: null, backendSource: "all", capabilityStates: {} });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("no cookie → 401", async () => {
  const r = await h.req("/broker/command", { method: "POST", body: { action: "list_projects", payload: {} } });
  assert.equal(r.status, 401);
});

test("demo mode (no broker wired): the not-configured guard returns a normalised broker error", async () => {
  const r = await h.req("/broker/command", { method: "POST", cookie: adminCookie(), body: { action: "list_projects", payload: {} } });
  assert.ok(r.status >= 400, `expected an error status, got ${r.status}`);
  assert.match((await json(r)).error, /demo mode|No backend configured/i);
});

test("with a broker wired: an invalid body → 400 before any dispatch", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ brokerUrl: BROKER_URL });
  const r = await h.req("/broker/command", { method: "POST", cookie: adminCookie(), body: { payload: {} } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /Invalid request body/i);
});

test("with a broker wired: the per-vendor gate refuses when that vendor is turned off", async () => {
  const { updateSettings } = await import("../lib/settings");
  const { BACKENDS } = await import("@workspace/backend-catalogue");
  const vendorId = BACKENDS[0]!.id; // a real backend ⇒ a `vendor:<id>` capability exists (default OFF)
  updateSettings({ brokerUrl: BROKER_URL, backendSource: vendorId });
  const r = await h.req("/broker/command", { method: "POST", cookie: adminCookie(), body: { action: "list_projects", payload: {} } });
  assert.ok(r.status >= 400);
  assert.match((await json(r)).error, /turned off by the administrator/i);
});

test("with a broker wired: a well-formed command dispatches and surfaces the broker error against a bogus host", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ brokerUrl: BROKER_URL }); // backendSource stays "all" so the vendor gate is skipped
  const r = await h.req("/broker/command", { method: "POST", cookie: adminCookie(), body: { action: "list_projects", payload: { foo: "bar" } } });
  // The command dispatches then fails against the unreachable/invalid broker → broker error surfaced.
  assert.ok(r.status >= 400, `expected a broker error status, got ${r.status}`);
  assert.ok((await json(r)).error);
});
