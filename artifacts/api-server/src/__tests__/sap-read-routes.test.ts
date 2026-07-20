import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// The sidecar write path (below) needs the sealed artifact store — configure a temp OMNI_CONFIG_DIR before the
// app boots. The read-only broker tests are unaffected (they never touch the sidecar).
process.env["OMNI_CONFIG_DIR"] = fs.mkdtempSync(path.join(os.tmpdir(), "sap-wbs-"));
import { startHarness, memberCookie, adminCookie, type Harness } from "./_harness";

/**
 * SAP / ERP read models over the REAL app (roadmap §4.6, docs/SAP-CONNECTOR.md). The demo broker fronts an ERP
 * for the fixtures, so `/projects/:id/wbs` + `/wbs/:wbsId/financials` return the WBS cost tree + per-WBS
 * roll-up a "copy of a SAP screen" renders. READ-ONLY, project-scope-gated; content is brokered (zero-at-rest).
 * The write path authors a WBS into the sealed sidecar and reads it back through the resolved mapping.
 */
let h: Harness;
const MEMBER = memberCookie();

before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(process.env["OMNI_CONFIG_DIR"]!, { recursive: true, force: true }); });

const req = (path: string) => h.req(path, { cookie: MEMBER });

test("WBS structure: a project's cost tree comes back with parent nesting", async () => {
  const r = await req("/projects/proj-001/wbs");
  assert.equal(r.status, 200);
  const wbs = (await r.json()) as { id: string; parentId: string | null; level: number }[];
  assert.ok(wbs.length >= 3);
  const root = wbs.find((w) => w.parentId === null);
  assert.ok(root && root.level === 1, "a level-1 root WBS element is present");
  assert.ok(wbs.some((w) => w.parentId === root!.id), "children reference the root");
});

test("WBS financials: a per-WBS roll-up, available = budget − (actual + commitment)", async () => {
  const r = await req("/projects/proj-001/wbs/PLT-1/financials");
  assert.equal(r.status, 200);
  const f = (await r.json()) as { wbsId: string; currency: string; budget: number; actual: number; commitment: number; available: number };
  assert.equal(f.wbsId, "PLT-1");
  assert.equal(f.currency, "GBP");
  assert.equal(f.available, f.budget - (f.actual + f.commitment));
});

test("cost-rows: the WBS+financials join shaped as { rows } for the generic table panel", async () => {
  const r = await req("/projects/proj-001/wbs/cost-rows");
  assert.equal(r.status, 200);
  const body = (await r.json()) as { rows: { wbs: string; name: string; budget: number | null; available: number | null }[] };
  assert.ok(body.rows.length >= 3);
  const root = body.rows.find((x) => x.wbs === "PLT-1")!;
  assert.equal(root.name, "Platform Rewrite");
  assert.equal(typeof root.budget, "number");
  assert.equal(root.available, root.budget! - (312000 + 52000));
});

test("the effective WBS mapping resolves from the shipped core (system store) for a project", async () => {
  const r = await req("/projects/proj-001/wbs/mapping");
  assert.equal(r.status, 200);
  const m = (await r.json()) as { id: string; name: string; currencyDefault?: string; budget?: unknown };
  // The seeded core mapping: structure keys are home field names, currency default GBP.
  assert.equal(m.id, "id");
  assert.equal(m.name, "name");
  assert.equal(m.currencyDefault, "GBP");
  assert.equal(m.budget, "budget");
});

test("an unknown WBS element's financials are 404 (not a silent empty)", async () => {
  assert.equal((await req("/projects/proj-001/wbs/NOPE/financials")).status, 404);
});

test("write path (all-in-one): author a WBS into the sidecar, read it back through cost-rows", async () => {
  const ADMIN = adminCookie();
  const pid = "proj-sidecar-wbs"; // a project with no ERP structure — the sidecar is its SoR
  const put = await h.req(`/projects/${pid}/wbs/WBS-1`, {
    method: "PUT", cookie: ADMIN, body: { fields: { name: "Design", budget: 1000, actual: 400, commitment: 100 } },
  });
  assert.equal(put.status, 200);
  const w = (await put.json()) as { written: string[]; external: unknown[]; unmapped: string[] };
  assert.deepEqual([...w.written].sort(), ["actual", "budget", "commitment", "name"]);
  assert.equal(w.external.length, 0);      // all fields routed home to the sidecar (no external backend)

  // cost-rows now serves the sidecar via the resolved mapping — the same shape the SAP screen binds to.
  const cr = await h.req(`/projects/${pid}/wbs/cost-rows`, { cookie: ADMIN });
  assert.equal(cr.status, 200);
  const body = (await cr.json()) as { rows: { wbs: string; name: string; budget: number | null; available: number | null }[] };
  const row = body.rows.find((r) => r.wbs === "WBS-1")!;
  assert.ok(row, "the authored WBS element is served from the sidecar");
  assert.equal(row.name, "Design");
  assert.equal(row.budget, 1000);
  assert.equal(row.available, 1000 - 400 - 100);
});

test("a field-by-field save merges (partial write leaves the rest intact)", async () => {
  const ADMIN = adminCookie();
  const pid = "proj-sidecar-wbs2";
  await h.req(`/projects/${pid}/wbs/A`, { method: "PUT", cookie: ADMIN, body: { fields: { name: "Root", budget: 500 } } });
  await h.req(`/projects/${pid}/wbs/A`, { method: "PUT", cookie: ADMIN, body: { fields: { actual: 200 } } }); // only actual
  const cr = await h.req(`/projects/${pid}/wbs/cost-rows`, { cookie: ADMIN });
  const row = ((await cr.json()) as { rows: { wbs: string; name: string; budget: number; available: number }[] }).rows.find((r) => r.wbs === "A")!;
  assert.equal(row.name, "Root");    // preserved from the first save
  assert.equal(row.budget, 500);     // preserved
  assert.equal(row.available, 500 - 200 - 0);
});

test("a project the ERP doesn't structure returns an empty WBS list (graceful)", async () => {
  const r = await req("/projects/proj-002/wbs");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), []);
});

test("the read is project-scope gated (a member not on the project is refused)", async () => {
  // Flip out of demo so row-level scope bites, then read as a member scoped elsewhere.
  const prev = process.env["OIDC_ISSUER_URL"];
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  try {
    const scoped = memberCookie({ projectIds: ["proj-999"] });
    const r = await h.req("/projects/proj-001/wbs", { cookie: scoped });
    assert.ok(r.status === 403 || r.status === 404, `expected a scope refusal, got ${r.status}`);
  } finally {
    if (prev === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prev;
  }
});
