import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * OUTPUT surfaces are hard-gated by the methodology composition (server-authoritative): an output curated
 * out of the deployment's composition has its endpoint refuse with 403, not just a hidden SPA tile. An
 * uncurated (null) composition leaves every output on, so default behaviour is unchanged.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ methodologyComposition: null }); // back to relaxed
});
const req = (p: string) => h.req(p, { cookie: adminCookie() });

test("uncurated (null) composition: an output endpoint is served normally", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ methodologyComposition: null });
  const r = await req("/calendar.ics");
  assert.notEqual(r.status, 403, "iCal is available when nothing is curated out");
});

test("curated composition WITHOUT the output → 403 (hard gate)", async () => {
  const { updateSettings } = await import("../lib/settings");
  // Strict deployment that enables only a report — iCal (and every other output) is curated out.
  updateSettings({ methodologyComposition: ["report:evm"] });
  const r = await req("/calendar.ics");
  assert.equal(r.status, 403);
  assert.match((await r.json() as { error: string }).error, /ical.*disabled|composition/i);
});

test("curated composition WITH the output → served", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ methodologyComposition: ["output:ical", "report:evm"] });
  const r = await req("/calendar.ics");
  assert.notEqual(r.status, 403, "explicitly composed output is served");
});

test("OData is gated too (curated out → 403)", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ methodologyComposition: ["report:evm"] });
  const r = await req("/odata");
  assert.equal(r.status, 403);
});
