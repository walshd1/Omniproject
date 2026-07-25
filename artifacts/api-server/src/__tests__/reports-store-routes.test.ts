import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * The per-deployment report-definition store (routes/reports.ts). Seeded from the built-in catalogue at
 * first boot, then deployment-owned JSON: GET is read-open, PUT is pmo+ and validated. This is the storage
 * half of "reports are data in the deployment's JSON store, bound to a registered renderer — never in code".
 * The composition gate reads the `methodology-composition` config def, so enable the sealed store.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "reports-store-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

async function setComposition(value: string[] | null): Promise<void> {
  const { writeOrgConfigCollection } = await import("../lib/scoped-config");
  writeOrgConfigCollection("methodology-composition", "Methodology composition", value);
}

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });
afterEach(async () => {
  // Restore the store to the catalogue seed so tests don't leak a mutated set.
  const { updateSettings } = await import("../lib/settings");
  const { reportCatalogue } = await import("@workspace/backend-catalogue");
  updateSettings({ reports: reportCatalogue() });
  await setComposition(null);
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

test("GET /reports is HARD-GATED by the methodology composition (curated → only composed reports)", async () => {
  try {
    // Curate the deployment strictly to two reports.
    await setComposition(["report:evm", "report:burndown"]);
    const body = await json(await h.req("/reports", { cookie: adminCookie() }));
    const ids = body.reports.map((r: { id: string }) => r.id).sort();
    assert.deepEqual(ids, ["burndown", "evm"], "only the composed reports are served");
    // A curated-out report is NOT retrievable via the API — server-authoritative, not just an SPA filter.
    assert.equal(body.reports.find((r: { id: string }) => r.id === "portfolio-rag"), undefined);
  } finally {
    await setComposition(null); // back to relaxed (everything)
  }
});

test("GET /reports with a null (uncurated) composition serves everything", async () => {
  await setComposition(null);
  const body = await json(await h.req("/reports", { cookie: adminCookie() }));
  assert.ok(body.reports.length >= 20, "uncurated ⇒ all reports");
});
