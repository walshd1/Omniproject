import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, memberCookie, adminCookie, type Harness } from "./_harness";

/**
 * Dependency graph (roadmap §5.5) over the REAL app. Directed edges between work items, brokered from the SoR
 * (the demo broker stands in). Read is project-scope-gated; write/delete are contributor+. Zero-at-rest — only
 * id→id relationships cross the seam, never item content.
 */
let h: Harness;
const MEMBER = memberCookie();
const ADMIN = adminCookie();

before(async () => { h = await startHarness(); });
after(() => h?.close());

test("GET returns the project's dependency edges (directed from→to, with kind)", async () => {
  const r = await h.req("/projects/proj-001/dependencies", { cookie: MEMBER });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { edges: { fromId: string; toId: string; kind: string }[] };
  assert.ok(body.edges.length >= 3);
  const e = body.edges.find((x) => x.fromId === "iss-002" && x.toId === "iss-001")!;
  assert.equal(e.kind, "depends_on");
});

test("write → read round-trip: assert an edge, it comes back; idempotent on from·kind·to", async () => {
  const put = await h.req("/projects/proj-001/dependencies", { method: "POST", cookie: ADMIN, body: { fromId: "iss-005", toId: "iss-006", kind: "blocks", note: "schema first" } });
  assert.equal(put.status, 201);
  // Re-assert the same edge — must not duplicate.
  await h.req("/projects/proj-001/dependencies", { method: "POST", cookie: ADMIN, body: { fromId: "iss-005", toId: "iss-006", kind: "blocks" } });
  const edges = ((await (await h.req("/projects/proj-001/dependencies", { cookie: ADMIN })).json()) as { edges: { fromId: string; toId: string; kind: string }[] }).edges;
  assert.equal(edges.filter((e) => e.fromId === "iss-005" && e.toId === "iss-006" && e.kind === "blocks").length, 1);
});

test("delete removes the edge", async () => {
  await h.req("/projects/proj-001/dependencies", { method: "POST", cookie: ADMIN, body: { fromId: "iss-007", toId: "iss-008", kind: "relates_to" } });
  const del = await h.req("/projects/proj-001/dependencies", { method: "DELETE", cookie: ADMIN, body: { fromId: "iss-007", toId: "iss-008", kind: "relates_to" } });
  assert.equal(del.status, 204);
  const edges = ((await (await h.req("/projects/proj-001/dependencies", { cookie: ADMIN })).json()) as { edges: { fromId: string; toId: string }[] }).edges;
  assert.ok(!edges.some((e) => e.fromId === "iss-007" && e.toId === "iss-008"));
});

test("a self-edge, a missing id, or an unknown kind is rejected 400", async () => {
  for (const bad of [{ fromId: "iss-001", toId: "iss-001", kind: "blocks" }, { fromId: "iss-001", kind: "blocks" }, { fromId: "iss-001", toId: "iss-002", kind: "nope" }]) {
    const r = await h.req("/projects/proj-001/dependencies", { method: "POST", cookie: ADMIN, body: bad });
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }
});
