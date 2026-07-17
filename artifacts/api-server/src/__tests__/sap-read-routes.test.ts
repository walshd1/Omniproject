import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, memberCookie, type Harness } from "./_harness";

/**
 * SAP / ERP read models over the REAL app (roadmap §4.6, docs/SAP-CONNECTOR.md). The demo broker fronts an ERP
 * for the fixtures, so `/projects/:id/wbs` + `/wbs/:wbsId/financials` return the WBS cost tree + per-WBS
 * roll-up a "copy of a SAP screen" renders. READ-ONLY, project-scope-gated; content is brokered (zero-at-rest).
 */
let h: Harness;
const MEMBER = memberCookie();

before(async () => { h = await startHarness(); });
after(() => h?.close());

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

test("an unknown WBS element's financials are 404 (not a silent empty)", async () => {
  assert.equal((await req("/projects/proj-001/wbs/NOPE/financials")).status, 404);
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
