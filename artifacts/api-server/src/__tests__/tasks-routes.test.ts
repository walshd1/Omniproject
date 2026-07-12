import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/tasks.ts over the real app (demo broker, which models GTD tasks). Tasks are ACTIONABLE
 * next-actions, distinct from issues.
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => h?.close());
const req = (path: string, opts: Parameters<Harness["req"]>[1] = {}) => h.req(path, { cookie: ADMIN, ...opts });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /tasks lists the demo GTD tasks", async () => {
  const r = await req("/tasks");
  assert.equal(r.status, 200);
  const tasks = await json(r);
  assert.ok(Array.isArray(tasks) && tasks.length >= 1);
  assert.ok(tasks.every((t: { status: string }) => typeof t.status === "string"));
});

test("GET /tasks?projectId= scopes to a project", async () => {
  const all = await json(await req("/tasks"));
  const withProject = all.find((t: { projectId?: string | null }) => t.projectId);
  if (!withProject) return;
  const scoped = await json(await req(`/tasks?projectId=${encodeURIComponent(withProject.projectId)}`));
  assert.ok(scoped.every((t: { projectId?: string }) => t.projectId === withProject.projectId));
});

test("POST /tasks creates an actionable next-action; PATCH updates its GTD status", async () => {
  const created = await req("/tasks", { method: "POST", body: { title: "Call the auditor", status: "next", context: "@calls" } });
  assert.equal(created.status, 201);
  const task = await json(created);
  assert.equal(task.title, "Call the auditor");
  assert.equal(task.status, "next");
  assert.match(task.id, /^task-/);

  const patched = await req(`/tasks/${task.id}`, { method: "PATCH", body: { status: "waiting", waitingOn: "Auditor" } });
  assert.equal(patched.status, 200);
  assert.equal((await json(patched)).status, "waiting");
});

test("POST /tasks rejects a bad GTD status and a missing title", async () => {
  const badStatus = await req("/tasks", { method: "POST", body: { title: "x", status: "nonsense" } });
  assert.equal(badStatus.status, 400);
  const noTitle = await req("/tasks", { method: "POST", body: { status: "next" } });
  assert.equal(noTitle.status, 400);
});

test("GET /tasks/:id 404s for an unknown id", async () => {
  const r = await req("/tasks/task-does-not-exist");
  assert.equal(r.status, 404);
});
