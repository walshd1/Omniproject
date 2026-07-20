import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/workflows.ts — authoring (GET/PUT, pmo-gated) + running (POST /workflows/:id/run). The run is
 * scope-authorized (org⇒pmo, project⇒manager; the demo harness admin clears both) and, when the run
 * action is bound to an approval chain, HELD for a signed sign-off (202) instead of running now. The run
 * effect is a fail-closed allowlist, so a workflow of broker reads + notify returns results directly.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ workflows: [], approvalChains: [], approvalBindings: [] });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

const READS_WORKFLOW = {
  id: "wf-health", scope: { kind: "org" as const },
  steps: [
    { id: "projects", kind: "action", action: "broker.listProjects" },
    { id: "health", kind: "action", action: "broker.portfolioHealth" },
    { id: "gate", kind: "condition", test: { result: "projects", exists: true }, then: [
      { id: "note", kind: "action", action: "notify", params: { title: "Health checked", body: "see dashboard" } },
    ] },
  ],
};

test("GET /workflows defaults to []", async () => {
  const r = await h.req("/workflows", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).workflows, []);
});

test("PUT /workflows authors a definition (validated + normalised)", async () => {
  const r = await h.req("/workflows", { method: "PUT", cookie: adminCookie(), body: { workflows: [READS_WORKFLOW] } });
  assert.equal(r.status, 200);
  assert.equal((await json(r)).workflows[0].id, "wf-health");
});

test("PUT /workflows rejects a malformed definition → 400", async () => {
  const r = await h.req("/workflows", { method: "PUT", cookie: adminCookie(), body: { workflows: [{ id: "bad", scope: { kind: "org" }, steps: [{ id: "x", kind: "nonsense" }] }] } });
  assert.equal(r.status, 400);
});

test("POST /workflows/:id/run on an unknown id → 404", async () => {
  const r = await h.req("/workflows/nope/run", { method: "POST", cookie: adminCookie() });
  assert.equal(r.status, 404);
});

test("POST /workflows/:id/run runs an unbound workflow directly → 200 with results", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ workflows: [READS_WORKFLOW] });
  const r = await h.req("/workflows/wf-health/run", { method: "POST", cookie: adminCookie() });
  assert.equal(r.status, 200);
  const body = await json(r);
  assert.equal(body.ran, "wf-health");
  // The broker reads returned results (demo broker has projects); the conditional's notify recorded nothing
  // in results (notify returns {sent:true} under its own step id).
  assert.ok("projects" in body.results);
  assert.deepEqual(body.results.note, { sent: true });
});

test("POST /workflows/:id/run HOLDS a chain-bound run for a signed sign-off → 202", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({
    workflows: [READS_WORKFLOW],
    approvalChains: [{ id: "run-gate", scope: { kind: "org" }, rejectionPolicy: "abort", stages: [{ id: "s1", approvers: [{ kind: "role", role: "pmo" }] }] }],
    approvalBindings: [{ action: "workflow.run:wf-health", chainId: "run-gate" }],
  });
  const r = await h.req("/workflows/wf-health/run", { method: "POST", cookie: adminCookie() });
  assert.equal(r.status, 202);
  const body = await json(r);
  assert.equal(typeof body.pending.proposalId, "string");
  assert.equal(body.pending.action, "workflow.run:wf-health");
});
