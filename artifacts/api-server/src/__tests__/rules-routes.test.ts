import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the entry business-rule enforcement:
 *  - GET /api/rules/active — the client-readable, any-authenticated-session view of the effective field
 *    requirements (so the SPA can push back inline before submit).
 *  - POST /api/tasks — the ruleset is now enforced on the GTD task surface, so a "require-priority" rule
 *    hard-blocks a task with no (or "none") priority, exactly as it already did on issue create.
 * Rule modes are process-global in lib/ruleset, so each test resets them afterwards.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rules-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

afterEach(async () => {
  const { setRuleModes, setFieldRules } = await import("../lib/ruleset");
  setRuleModes({});
  setFieldRules([]);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /api/rules/active: no cookie → 401 (behind requireAuth)", async () => {
  assert.equal((await h.req("/rules/active")).status, 401);
});

test("GET /api/rules/active: empty by default (engine inert until an admin opts in)", async () => {
  const r = await h.req("/rules/active", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).requirements, []);
});

test("GET /api/rules/active: surfaces require-priority for the entry actions once on", async () => {
  const { setRuleModes } = await import("../lib/ruleset");
  setRuleModes({ "require-priority": "hard" });
  const reqs = (await json(await h.req("/rules/active", { cookie: adminCookie() }))).requirements as { action: string; field: string; mode: string }[];
  assert.ok(reqs.some((x) => x.action === "create_task" && x.field === "priority" && x.mode === "hard"));
  assert.ok(reqs.some((x) => x.action === "create_issue" && x.field === "priority" && x.mode === "hard"));
});

test("POST /api/tasks: require-priority hard-blocks a task with no priority (422 + rule id)", async () => {
  const { setRuleModes } = await import("../lib/ruleset");
  setRuleModes({ "require-priority": "hard" });
  const blocked = await h.req("/tasks", { method: "POST", cookie: adminCookie(), body: { title: "no priority" } });
  assert.equal(blocked.status, 422);
  const out = await json(blocked);
  assert.equal(out.rule, "require-priority");
  assert.match(out.error, /priority is required/i);
});

test("POST /api/tasks: the UI's 'none' sentinel is still treated as unset → 422", async () => {
  const { setRuleModes } = await import("../lib/ruleset");
  setRuleModes({ "require-priority": "hard" });
  const blocked = await h.req("/tasks", { method: "POST", cookie: adminCookie(), body: { title: "none priority", priority: "none" } });
  assert.equal(blocked.status, 422);
  assert.equal((await json(blocked)).rule, "require-priority");
});

test("POST /api/tasks: a real priority satisfies the rule → 201", async () => {
  const { setRuleModes } = await import("../lib/ruleset");
  setRuleModes({ "require-priority": "hard" });
  const ok = await h.req("/tasks", { method: "POST", cookie: adminCookie(), body: { title: "has priority", priority: "high" } });
  assert.equal(ok.status, 201);
});
