import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * Error/validation/branch coverage for routes/projects.ts over the REAL app (demo broker).
 * The happy paths are exercised by routes-integration.test.ts; this file drives the
 * UNCOVERED branches: body-validation 400s, brokered not_found/conflict → catch handlers,
 * and the business-ruleset block (422) + warning-header paths. The demo session holds every
 * grant and the demo backend declares every entity storable, so the coarse-RBAC 403 and the
 * capability-gating 403s are NOT reachable here (covered by unit tests) and are omitted.
 */
let h: Harness;
const ADMIN = adminCookie();

before(async () => {
  h = await startHarness();
});
after(() => h?.close());

afterEach(async () => {
  // Reset any business-rule modes we toggled and any demo-store mutations so state never leaks.
  const { setRuleModes } = await import("../lib/ruleset");
  setRuleModes({ "read-only": "off", "no-deletes": "off", "require-assignee": "off", "require-description": "off", "due-after-start": "off" });
  const { resetDemoBrokerState } = await import("../broker/demo");
  resetDemoBrokerState();
});

const req = (path: string, opts: Parameters<Harness["req"]>[1] = {}) => h.req(path, { cookie: ADMIN, ...opts });

test("POST /projects with a body missing name → 400 (zod contract)", async () => {
  const r = await req("/projects", { method: "POST", body: { identifier: "X" } });
  assert.equal(r.status, 400);
});

test("POST /projects with an empty name passes zod but fails the field registry → 400", async () => {
  // name is a string ("") so CreateProjectBody accepts it, but validateEntityInput requires
  // a non-empty value — this drives the field-registry error branch, not the zod one.
  const r = await req("/projects", { method: "POST", body: { name: "" } });
  assert.equal(r.status, 400);
  const body = (await r.json()) as { error: string; errors: { field: string }[] };
  assert.ok(Array.isArray(body.errors) && body.errors.some((e) => e.field === "name"));
});

test("GET /projects is live-only by default and accepts ?includeClosed", async () => {
  const r1 = await req("/projects");
  assert.equal(r1.status, 200);
  assert.ok(Array.isArray(await r1.json()), "returns the (live) project list");
  const r2 = await req("/projects?includeClosed=1");
  assert.equal(r2.status, 200); // opting in is accepted and served (distinct ETag)
});

test("POST /projects stamps a backend-independent correlation GUID (omniInstanceId)", async () => {
  const r = await req("/projects", { method: "POST", body: { name: "Apollo" } });
  assert.equal(r.status, 201);
  const body = (await r.json()) as { omniInstanceId?: string };
  assert.match(body.omniInstanceId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("PATCH /projects/:id with an invalid body → 400", async () => {
  const r = await req("/projects/proj-001", { method: "PATCH", body: { name: 123 } });
  assert.equal(r.status, 400);
});

test("PATCH /projects/:id setting programmeId takes the programme-gated branch → 200", async () => {
  const r = await req("/projects/proj-001", { method: "PATCH", body: { programmeId: "prog-platform" } });
  assert.equal(r.status, 200);
});

test("PATCH /projects/:id for an unknown project → broker not_found → 404", async () => {
  const r = await req("/projects/no-such-project", { method: "PATCH", body: { name: "Renamed" } });
  assert.equal(r.status, 404);
});

test("PATCH an unknown issue → broker not_found → 404", async () => {
  const r = await req("/projects/proj-001/issues/iss-does-not-exist", { method: "PATCH", body: { status: "done" } });
  assert.equal(r.status, 404);
});

test("PATCH an issue with a stale expectedVersion → broker conflict → 409", async () => {
  const created = await req("/projects/proj-001/issues", { method: "POST", body: { title: "conflict probe", estimateHours: 1 } });
  assert.equal(created.status, 201);
  const issue = (await created.json()) as { id: string; version: number };
  const r = await req(`/projects/proj-001/issues/${issue.id}`, { method: "PATCH", body: { status: "in_progress", expectedVersion: issue.version + 5 } });
  assert.equal(r.status, 409);
});

test("DELETE an issue on a project the backend has no issues for → not_found → 404", async () => {
  const r = await req("/projects/project-with-no-issues/issues/iss-x", { method: "DELETE" });
  assert.equal(r.status, 404);
});

test("POST a task item with an invalid body → 400", async () => {
  const r = await req("/projects/proj-001/issues/iss-001/items", { method: "POST", body: { kind: "not-a-kind" } });
  assert.equal(r.status, 400);
});

test("POST a raid entry with an invalid body → 400", async () => {
  const r = await req("/projects/proj-001/raid", { method: "POST", body: { title: "" } });
  assert.equal(r.status, 400);
});

test("a hard business rule blocks a write → 422", async () => {
  const { setRuleModes } = await import("../lib/ruleset");
  setRuleModes({ "read-only": "hard" }); // freeze all writes
  const r = await req("/projects/proj-001/issues", { method: "POST", body: { title: "should be blocked" } });
  assert.equal(r.status, 422);
  const body = (await r.json()) as { rule: string };
  assert.equal(body.rule, "read-only");
});

test("a warn business rule allows the write but attaches the rule-warning header", async () => {
  const { setRuleModes } = await import("../lib/ruleset");
  setRuleModes({ "require-description": "warn" }); // warn (don't block) when a new issue has no description
  const r = await req("/projects/proj-001/issues", { method: "POST", body: { title: "no description here" } });
  assert.equal(r.status, 201);
  assert.ok((r.headers.get("x-omniproject-rule-warnings") ?? "").includes("require-description"));
});

test("GET /fx-rates with an asOf query drives the as-of branch", async () => {
  const r = await req("/fx-rates?asOf=2024-01-01");
  assert.equal(r.status, 200);
  const body = (await r.json()) as { base: string };
  assert.equal(typeof body.base, "string");
});
