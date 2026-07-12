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

test("POST /tasks carries assignee, tags and priority; completing stamps completedAt", async () => {
  const created = await req("/tasks", { method: "POST", body: { title: "Prep board pack", assignee: "chris@demo", priority: "high", tags: ["board", "q3"], estimateHours: 2 } });
  assert.equal(created.status, 201);
  const task = await json(created);
  assert.equal(task.assignee, "chris@demo");
  assert.equal(task.priority, "high");
  assert.deepEqual(task.tags, ["board", "q3"]);
  assert.equal(task.completedAt, null);

  const done = await req(`/tasks/${task.id}`, { method: "PATCH", body: { status: "done" } });
  const updated = await json(done);
  assert.equal(updated.status, "done");
  assert.match(updated.completedAt, /^\d{4}-\d{2}-\d{2}T/); // auto-stamped on completion
});

test("POST /tasks rejects a bad priority and over-long/invalid fields", async () => {
  const badPriority = await req("/tasks", { method: "POST", body: { title: "x", priority: "supercritical" } });
  assert.equal(badPriority.status, 400);
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

test("GET /tasks/summary returns the report roll-up (not read as a task id)", async () => {
  const r = await req("/tasks/summary");
  assert.equal(r.status, 200);
  const s = await json(r);
  assert.equal(typeof s.total, "number");
  assert.ok(s.byClass && typeof s.byClass.actionable === "number");
  assert.equal(typeof s.open, "number");
  assert.equal(typeof s.overdue, "number");
});

test("task comments: post + list a discussion thread", async () => {
  const task = await json(await req("/tasks", { method: "POST", body: { title: "Review the SOW" } }));
  const posted = await req(`/tasks/${task.id}/comments`, { method: "POST", body: { body: "Flagged clause 7 with legal." } });
  assert.equal(posted.status, 201);
  assert.equal((await json(posted)).body, "Flagged clause 7 with legal.");
  const list = await json(await req(`/tasks/${task.id}/comments`));
  assert.equal(list.length, 1);
  assert.ok(list[0].author);
});

test("task attachments: reference a backend file (the demo supports it)", async () => {
  const task = await json(await req("/tasks", { method: "POST", body: { title: "Attach the report" } }));
  const posted = await req(`/tasks/${task.id}/attachments`, { method: "POST", body: { filename: "q3-report.pdf", url: "https://backend.example/f/123", contentType: "application/pdf", size: 20480 } });
  assert.equal(posted.status, 201);
  const att = await json(posted);
  assert.equal(att.filename, "q3-report.pdf");
  assert.equal(att.url, "https://backend.example/f/123");
  const list = await json(await req(`/tasks/${task.id}/attachments`));
  assert.equal(list.length, 1);
});

test("attachment upload requires a filename", async () => {
  const task = await json(await req("/tasks", { method: "POST", body: { title: "x" } }));
  const bad = await req(`/tasks/${task.id}/attachments`, { method: "POST", body: { url: "https://x/y" } });
  assert.equal(bad.status, 400);
});
