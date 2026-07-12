import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the admin-managed broker list (brokerKinds). Read-open to any authenticated
 * session; writes are admin-gated (the harness's demo admin clears that, so reachable branches are
 * 200 / 400). Unknown kinds are rejected against the catalogue.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ brokerKinds: [] });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /broker-kinds defaults to []", async () => {
  const r = await h.req("/broker-kinds", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).brokerKinds, []);
});

test("a known broker kind is saved (normalised)", async () => {
  const r = await h.req("/broker-kinds", { method: "PUT", cookie: adminCookie(), body: { brokerKinds: [" N8N ", "make", "make"] } });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).brokerKinds, ["n8n", "make"]);
});

test("an unknown broker kind is rejected → 400", async () => {
  const r = await h.req("/broker-kinds", { method: "PUT", cookie: adminCookie(), body: { brokerKinds: ["totally-not-a-broker"] } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /unknown broker kind/);
});
