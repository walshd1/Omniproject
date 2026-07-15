import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * The per-deployment report-definition store (routes/reports.ts). Seeded from the built-in catalogue at
 * first boot, then deployment-owned JSON: GET is read-open, PUT is pmo+ and validated. This is the storage
 * half of "reports are data in the deployment's JSON store, bound to a registered renderer — never in code".
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  // Restore the store to the catalogue seed so tests don't leak a mutated set.
  const { updateSettings } = await import("../lib/settings");
  const { reportCatalogue } = await import("@workspace/backend-catalogue");
  updateSettings({ reports: reportCatalogue() });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /reports is seeded from the built-in catalogue", async () => {
  const r = await h.req("/reports", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const body = await json(r);
  assert.ok(Array.isArray(body.reports) && body.reports.length >= 20, "seeded with the catalogue");
  const evm = body.reports.find((x: { id: string }) => x.id === "evm");
  assert.ok(evm, "the built-in EVM report is present");
  assert.equal(evm.renderer.component, "FinancialEvmChart");
});

test("PUT /reports persists a deployment-authored definition (bound to a registered renderer)", async () => {
  const { reportCatalogue } = await import("@workspace/backend-catalogue");
  const next = [
    ...reportCatalogue(),
    { id: "my-evm", label: "Our EVM", docsUrl: "", kind: "financial", order: 999, tools: [], capabilities: { requiresCapability: "financials", timeSeries: true, exports: [] }, renderer: { engine: "builtin", component: "FinancialEvmChart" } },
  ];
  const put = await h.req("/reports", { method: "PUT", cookie: adminCookie(), body: { reports: next } });
  assert.equal(put.status, 200);
  const got = await json(await h.req("/reports", { cookie: adminCookie() }));
  assert.ok(got.reports.find((x: { id: string }) => x.id === "my-evm"), "the authored report persisted");
});

test("PUT /reports rejects a malformed definition → 400", async () => {
  const bad = await h.req("/reports", { method: "PUT", cookie: adminCookie(), body: { reports: [{ id: "broken", label: "x", kind: "not-a-kind", order: 1, renderer: { engine: "builtin" } }] } });
  assert.equal(bad.status, 400);
  assert.match((await json(bad)).error, /unknown kind/);
});

test("PUT /reports rejects a definition with no renderer → 400", async () => {
  const bad = await h.req("/reports", { method: "PUT", cookie: adminCookie(), body: { reports: [{ id: "no-rend", label: "x", kind: "portfolio", order: 1 }] } });
  assert.equal(bad.status, 400);
  assert.match((await json(bad)).error, /renderer/);
});
