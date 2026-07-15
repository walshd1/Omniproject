import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, stepUpAdminCookie, memberCookie, type Harness } from "./_harness";
import { signOffRelaxation } from "./_signoff";

/**
 * Capability governance plane over the REAL app. GET /governance is open to any authed
 * session; the writes are admin + step-up. Tests drive the reachable branches: the step-up
 * gate, body validation (400), unknown capability (404), and the write success paths.
 * Global toggles the tests flip (ai-kill, containment) are reset in afterEach.
 */
let h: Harness;
let capId: string; // a real resolved-capability id, discovered at runtime
before(async () => {
  h = await startHarness();
  const gov = await h.req("/governance", { cookie: adminCookie() }).then((r) => r.json()) as { capabilities: { id: string }[] };
  capId = gov.capabilities[0]?.id ?? "mcp";
});
after(() => h.close());
afterEach(async () => {
  const { releaseAiKill } = await import("../lib/ai-kill");
  const { setContainmentRelax } = await import("../lib/ai-containment");
  releaseAiKill();
  setContainmentRelax("off");
});

test("GET /governance is readable by any authenticated session", async () => {
  const r = await h.req("/governance", { cookie: memberCookie() });
  assert.equal(r.status, 200);
  const body = await r.json() as { capabilities: unknown[]; surfaces: unknown[] };
  assert.ok(Array.isArray(body.capabilities));
  assert.ok(Array.isArray(body.surfaces));
});

test("admin governance dashboards return 200", async () => {
  for (const p of ["/governance/log", "/governance/autonomous", "/governance/approved", "/governance/actions"]) {
    const r = await h.req(p, { cookie: adminCookie() });
    assert.equal(r.status, 200, `${p} -> ${r.status}`);
  }
});

test("PUT /governance/approved without a fresh step-up is 403", async () => {
  const r = await h.req("/governance/approved", { method: "PUT", cookie: adminCookie(), body: { actions: ["list_projects"] } });
  assert.equal(r.status, 403);
  assert.equal((await r.json() as { code: string }).code, "step_up_required");
});

test("PUT /governance/approved adds actions/vocab and replaces on { replace:true }", async () => {
  const add = await h.req("/governance/approved", { method: "PUT", cookie: stepUpAdminCookie(), body: { actions: ["list_projects"], vocab: ["Sprint"], rules: [{ action: "create_task", scope: { minRole: "manager" } }], remove: ["nope"] } });
  assert.equal(add.status, 200);
  const replaced = await h.req("/governance/approved", { method: "PUT", cookie: stepUpAdminCookie(), body: { replace: true, actions: ["list_projects"], vocab: ["Epic"] } });
  assert.equal(replaced.status, 200);
});

test("PUT /governance/ai-kill toggles the kill switch (engage then release)", async () => {
  const on = await h.req("/governance/ai-kill", { method: "PUT", cookie: stepUpAdminCookie(), body: { engage: true } });
  assert.equal(on.status, 200);
  assert.equal((await on.json() as { aiKill: boolean }).aiKill, true);
  const off = await h.req("/governance/ai-kill", { method: "PUT", cookie: stepUpAdminCookie(), body: { engage: false } });
  assert.equal(off.status, 200);
  assert.equal((await off.json() as { aiKill: boolean }).aiKill, false);
});

test("PUT /governance/containment validates the level and applies a valid one", async () => {
  const bad = await h.req("/governance/containment", { method: "PUT", cookie: stepUpAdminCookie(), body: { level: "sideways" } });
  assert.equal(bad.status, 400);
  const ok = await h.req("/governance/containment", { method: "PUT", cookie: stepUpAdminCookie(), body: { level: "local" } });
  assert.equal(ok.status, 200);
  assert.ok("level" in (await ok.json() as object));
});

test("POST /governance/:id/test 404s an unknown capability and probes a known one", async () => {
  const missing = await h.req("/governance/not-a-capability/test", { method: "POST", cookie: adminCookie(), body: { endpoint: "https://example.com" } });
  assert.equal(missing.status, 404);
  const probe = await h.req(`/governance/${capId}/test`, { method: "POST", cookie: adminCookie(), body: { endpoint: "https://broker.invalid/x" } });
  assert.equal(probe.status, 200); // reachability result, reachable:false for the bogus host
  // Empty endpoint in the body -> falls back to the capability's stored endpoint (here: none).
  const fallback = await h.req(`/governance/${capId}/test`, { method: "POST", cookie: adminCookie(), body: {} });
  assert.equal(fallback.status, 200);
});

test("PUT /governance/:id 404s an unknown capability and LOWERING exposure applies immediately", async () => {
  const missing = await h.req("/governance/not-a-capability", { method: "PUT", cookie: stepUpAdminCookie(), body: { state: "off" } });
  assert.equal(missing.status, 404);
  // Setting a capability OFF is the lowest exposure → strengthens → applies immediately (not held).
  const ok = await h.req(`/governance/${capId}`, { method: "PUT", cookie: stepUpAdminCookie(), body: { state: "off" } });
  assert.equal(ok.status, 200);
  assert.ok("setting" in (await ok.json() as object));
});

test("PUT /governance/:id HOLDS an exposure-raising change (new egress endpoint) for a signed sign-off", async () => {
  try {
    // Pointing a capability at a NEW egress endpoint is a security reduction → held (202), then applied by
    // the executor once the solo admin confirm+signs.
    const held = await h.req(`/governance/${capId}`, { method: "PUT", cookie: stepUpAdminCookie(), body: { state: "off", endpoint: "https://sink.example.com/ingest" } });
    assert.equal(held.status, 202);
    const body = await held.json() as { pending: { proposalId: string; relaxes: string[] } };
    assert.deepEqual(body.pending.relaxes, ["capabilityStates"]);

    await signOffRelaxation(body.pending.proposalId, "u-harness");
    const { getSettings } = await import("../lib/settings");
    assert.equal(getSettings().capabilityStates[capId]?.endpoint, "https://sink.example.com/ingest");
  } finally {
    const { updateSettings } = await import("../lib/settings");
    updateSettings({ capabilityStates: {} });
  }
});
