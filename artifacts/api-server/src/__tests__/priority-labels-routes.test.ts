import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * Custom priority-level labels — admin/PMO relabel the canonical priorities (none/low/medium/high/urgent).
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => { (await import("../lib/settings")).updateSettings({ priorityLabels: {} }); });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /priority-labels returns the canonical levels and (empty) custom labels", async () => {
  const r = await h.req("/priority-labels", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const b = await json(r);
  assert.deepEqual(b.canonical, ["none", "low", "medium", "high", "urgent"]);
  assert.deepEqual(b.labels, {});
});

test("PUT /priority-labels sets custom labels; canonical-only keys, capped length", async () => {
  const ok = await h.req("/priority-labels", { method: "PUT", cookie: adminCookie(), body: { labels: { urgent: "P0", high: "Critical", low: "" } } });
  assert.equal(ok.status, 200);
  assert.deepEqual((await json(ok)).labels, { urgent: "P0", high: "Critical" }); // empty dropped

  const bad = await h.req("/priority-labels", { method: "PUT", cookie: adminCookie(), body: { labels: { bogus: "X" } } });
  assert.equal(bad.status, 400);
});
