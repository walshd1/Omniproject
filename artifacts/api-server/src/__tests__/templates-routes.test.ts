import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/templates.ts over the REAL app (demo broker). The template definitions store (admin/PMO write) plus
 * INSTANTIATE — create a project + seed its work items through the broker (manager+).
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ templates: [] });
  const { resetDemoBrokerState } = await import("../broker/demo");
  resetDemoBrokerState();
});
const req = (p: string, o: Parameters<Harness["req"]>[1] = {}) => h.req(p, { cookie: ADMIN, ...o });

const TEMPLATE = {
  id: "scrum", label: "Scrum project",
  project: { description: "A scrum project." },
  seedIssues: [{ title: "Sprint 0", status: "todo" }, { title: "Definition of Done" }],
};

test("templates: save definitions + read them back", async () => {
  assert.equal((await req("/templates", { method: "PUT", body: { templates: [TEMPLATE] } })).status, 200);
  const got = (await (await req("/templates")).json()) as { templates: Array<{ id: string }> };
  assert.equal(got.templates[0]!.id, "scrum");
});

test("templates: instantiate creates a project and seeds its work items", async () => {
  await req("/templates", { method: "PUT", body: { templates: [TEMPLATE] } });
  const r = await req("/templates/scrum/instantiate", { method: "POST", body: { name: "Apollo" } });
  assert.equal(r.status, 201);
  const body = (await r.json()) as { project: { id: string; name: string }; seeded: number };
  assert.equal(body.project.name, "Apollo");
  assert.equal(body.seeded, 2);
  // The seeded issues are readable on the new project.
  const issues = (await (await req(`/projects/${body.project.id}/issues`)).json()) as Array<{ title: string }>;
  assert.ok(issues.some((i) => i.title === "Sprint 0"));
});

test("templates: a shipped built-in instantiates directly without saving an org copy", async () => {
  // No org templates saved (afterEach reset). The shipped catalogue resolves server-side.
  const r = await req("/templates/scrum-starter/instantiate", { method: "POST", body: { name: "Vega" } });
  assert.equal(r.status, 201);
  const body = (await r.json()) as { project: { name: string }; seeded: number };
  assert.equal(body.project.name, "Vega");
  assert.ok(body.seeded > 0);
});

test("templates: an org override of a built-in id wins over the shipped default", async () => {
  await req("/templates", { method: "PUT", body: { templates: [{ id: "scrum-starter", label: "Org scrum", seedIssues: [{ title: "Only one" }] }] } });
  const r = await req("/templates/scrum-starter/instantiate", { method: "POST", body: { name: "Rigel" } });
  assert.equal(r.status, 201);
  const body = (await r.json()) as { project: { id: string }; seeded: number };
  assert.equal(body.seeded, 1);
  const issues = (await (await req(`/projects/${body.project.id}/issues`)).json()) as Array<{ title: string }>;
  assert.ok(issues.some((i) => i.title === "Only one"));
});

test("templates: instantiating an unknown template → 404", async () => {
  assert.equal((await req("/templates/ghost/instantiate", { method: "POST", body: { name: "X" } })).status, 404);
});

test("templates: malformed template → 400", async () => {
  const r = await req("/templates", { method: "PUT", body: { templates: [{ id: "x", label: "X", seedIssues: [{ status: "todo" }] }] } });
  assert.equal(r.status, 400);
});
