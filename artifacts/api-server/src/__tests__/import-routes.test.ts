import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/import.ts — the tabular column/field mapper over HTTP. The happy path
 * (preview + a clean commit) is covered by integration-routes.test.ts; this file
 * drives the commit GUARD branches: the projectId / rows validation 400s, an
 * explicit caller-supplied mapping, an all-unmappable-headers 400, and the
 * "nothing landed" case where every row is skipped by a hard business rule.
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => h?.close());

const req = (path: string, opts: Parameters<Harness["req"]>[1] = {}) => h.req(path, { cookie: ADMIN, ...opts });
const commit = (body: unknown) => req("/import/commit", { method: "POST", body });
const setRule = (body: unknown) => req("/admin/ruleset", { method: "PUT", body });

afterEach(() => setRule({ "require-description": "off" }));

test("commit without a projectId → 400", async () => {
  const r = await commit({ rows: [{ Summary: "x" }] });
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as { error: string }).error, /projectId/);
});

test("commit with an empty rows array → 400", async () => {
  const r = await commit({ projectId: "proj-1", rows: [] });
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as { error: string }).error, /non-empty/);
});

test("commit honours a caller-supplied explicit mapping", async () => {
  const r = await commit({
    projectId: "proj-1",
    rows: [{ Heading: "Explicitly mapped" }],
    mapping: [{ column: "Heading", field: "title", type: "string" }],
  });
  assert.equal(r.status, 201);
  const json = (await r.json()) as { created: unknown[]; fields: { field: string }[] };
  assert.equal(json.created.length, 1);
  assert.ok(json.fields.some((f) => f.field === "title"));
});

test("commit with only unmappable headers → 400 (no usable column mapping)", async () => {
  const r = await commit({ projectId: "proj-1", rows: [{ Zzzql: "a", Qwxyz: "b" }] });
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as { error: string }).error, /mapping|title/);
});

test("commit where every row is skipped by a hard rule → error (nothing imported)", async () => {
  await setRule({ "require-description": "hard" }); // no row supplies a description → all skipped
  const r = await commit({
    projectId: "proj-1",
    rows: [{ Summary: "No desc A" }, { Summary: "No desc B" }],
  });
  assert.equal(r.status, 502);
  assert.match(((await r.json()) as { error: string }).error, /unreachable|imported/i);
});
