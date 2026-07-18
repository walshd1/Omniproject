import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, memberCookie, adminCookie, type Harness } from "./_harness";

/**
 * Sprints / iterations (roadmap §5.5) over the REAL app. Time-boxed iterations with a goal + a work-item
 * membership set, brokered from the SoR (the demo broker stands in). Read is project-scope-gated; write/delete
 * are contributor+. Zero-at-rest — a sprint carries its own metadata + member ids, never item content.
 */
let h: Harness;
const MEMBER = memberCookie();
const ADMIN = adminCookie();

before(async () => { h = await startHarness(); });
after(() => h?.close());

test("GET returns the project's sprints with goal, dates, state, and member ids", async () => {
  const r = await h.req("/projects/proj-001/sprints", { cookie: MEMBER });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { sprints: { id: string; name: string; state: string; itemIds: string[] }[] };
  assert.ok(body.sprints.length >= 2);
  const active = body.sprints.find((s) => s.id === "spr-001")!;
  assert.equal(active.state, "active");
  assert.deepEqual(active.itemIds, ["iss-001", "iss-002"]);
});

test("write → read round-trip: upsert a sprint by id (a re-write replaces, does not duplicate)", async () => {
  const put = await h.req("/projects/proj-001/sprints", { method: "POST", cookie: ADMIN, body: { id: "spr-900", name: "Hardening", goal: "burn down debt", startDate: "2026-08-03", endDate: "2026-08-14", state: "planned", itemIds: ["iss-004", "iss-004"] } });
  assert.equal(put.status, 201);
  const saved = (await put.json()) as { itemIds: string[] };
  assert.deepEqual(saved.itemIds, ["iss-004"]); // duplicate member ids collapsed
  // Re-write the same id with a new state — must replace, not duplicate.
  await h.req("/projects/proj-001/sprints", { method: "POST", cookie: ADMIN, body: { id: "spr-900", name: "Hardening", state: "active", itemIds: ["iss-004"] } });
  const list = ((await (await h.req("/projects/proj-001/sprints", { cookie: ADMIN })).json()) as { sprints: { id: string; state: string }[] }).sprints;
  const rows = list.filter((s) => s.id === "spr-900");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.state, "active");
});

test("delete removes the sprint by id", async () => {
  await h.req("/projects/proj-001/sprints", { method: "POST", cookie: ADMIN, body: { id: "spr-901", name: "Temp", state: "planned", itemIds: [] } });
  const del = await h.req("/projects/proj-001/sprints/spr-901", { method: "DELETE", cookie: ADMIN });
  assert.equal(del.status, 204);
  const list = ((await (await h.req("/projects/proj-001/sprints", { cookie: ADMIN })).json()) as { sprints: { id: string }[] }).sprints;
  assert.ok(!list.some((s) => s.id === "spr-901"));
});

test("a missing id/name, an unknown state, or an end-before-start is rejected 400", async () => {
  for (const bad of [
    { name: "No id", state: "planned", itemIds: [] },
    { id: "spr-x", state: "planned", itemIds: [] },
    { id: "spr-x", name: "Bad state", state: "nope", itemIds: [] },
    { id: "spr-x", name: "Bad dates", state: "planned", startDate: "2026-08-14", endDate: "2026-08-03", itemIds: [] },
  ]) {
    const r = await h.req("/projects/proj-001/sprints", { method: "POST", cookie: ADMIN, body: bad });
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }
});
