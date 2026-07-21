import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * OUTPUT surfaces are hard-gated by the methodology composition (server-authoritative): an output curated
 * out of the deployment's composition has its endpoint refuse with 403, not just a hidden SPA tile. An
 * uncurated (null) composition leaves every output on, so default behaviour is unchanged. The composition
 * lives in the composition model as the `methodology-composition` config def, so enable the sealed store.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "output-composition-gate-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

async function setComposition(value: string[] | null): Promise<void> {
  const { writeOrgConfigCollection } = await import("../lib/scoped-config");
  writeOrgConfigCollection("methodology-composition", "Methodology composition", value);
}

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });
afterEach(async () => { await setComposition(null); }); // back to relaxed
const req = (p: string) => h.req(p, { cookie: adminCookie() });

test("uncurated (null) composition: an output endpoint is served normally", async () => {
  await setComposition(null);
  const r = await req("/calendar.ics");
  assert.notEqual(r.status, 403, "iCal is available when nothing is curated out");
});

test("curated composition WITHOUT the output → 403 (hard gate)", async () => {
  // Strict deployment that enables only a report — iCal (and every other output) is curated out.
  await setComposition(["report:evm"]);
  const r = await req("/calendar.ics");
  assert.equal(r.status, 403);
  assert.match((await r.json() as { error: string }).error, /ical.*disabled|composition/i);
});

test("curated composition WITH the output → served", async () => {
  await setComposition(["output:ical", "report:evm"]);
  const r = await req("/calendar.ics");
  assert.notEqual(r.status, 403, "explicitly composed output is served");
});

test("OData is gated too (curated out → 403)", async () => {
  await setComposition(["report:evm"]);
  const r = await req("/odata");
  assert.equal(r.status, 403);
});
