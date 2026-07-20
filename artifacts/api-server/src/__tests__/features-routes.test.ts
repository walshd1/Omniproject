import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { signOffRelaxation } from "./_signoff";

/**
 * Feature gating + governance routes over the REAL app: scoped GET resolution and the
 * programme/project governance PUTs (parent-ceiling + stateless scope-ownership checks). The demo
 * session holds every grant and sees the demo project graph, so it can govern the demo
 * programmes/projects but not ids outside that graph (the ownership 403 path). Coarse RBAC
 * role-gating itself is covered in the rbac unit tests.
 */
const SECRET = "test-session-secret-features-routes";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
// This "production" is a test-harness convenience flag, not a real deployment: no OIDC is
// configured (demo auth) and rate-limiting is deliberately off, both of which are now CRITICAL
// boot-refusing findings by default. Opt out for this harness only.
process.env["SECURITY_STRICT"] = "off";

let server: Server;
let base: string;
function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = cookie({ sub: "u-feat", name: "Grace Hopper", email: "grace@x.io", roles: ["omni-admins"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ programmeFeatures: {}, projectFeatures: {}, featureGovernance: { required: [], forbidden: [] }, enabledFeatures: [], disabledFeatures: [], governanceRules: [] });
});

const getFeatures = (q = "") =>
  fetch(`${base}/api/features${q}`, { headers: { cookie: ADMIN } }).then(async (r) => ({ status: r.status, body: await r.json() as { features: { id: string; enabled: boolean; blockedAt?: string }[] } }));
const put = (path: string, body: unknown) =>
  fetch(`${base}/api${path}`, { method: "PUT", headers: { cookie: ADMIN, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("GET /api/features returns the resolved status (grid on, presence off by default)", async () => {
  const { status, body } = await getFeatures();
  assert.equal(status, 200);
  assert.equal(body.features.find((f) => f.id === "grid")!.enabled, true);
  assert.equal(body.features.find((f) => f.id === "presence")!.enabled, false); // default-off (cost)
});

// `prog-platform` / `proj-001` are real demo programmes/projects the (demo, all-grants) session can
// see — so they pass the stateless scope-ownership check (the backend is the ownership oracle).
test("a programme PUT forbid disables a feature for that programme scope", async () => {
  const r = await put("/features/programme/prog-platform", { forbidden: ["grid"] });
  assert.equal(r.status, 200);
  // org scope: grid still on; programme scope: off + blocked at programme.
  assert.equal((await getFeatures()).body.features.find((f) => f.id === "grid")!.enabled, true);
  const scoped = (await getFeatures("?programmeId=prog-platform")).body.features.find((f) => f.id === "grid")!;
  assert.equal(scoped.enabled, false);
  assert.equal(scoped.blockedAt, "programme");
});

test("a programme cannot require a feature outside the org-approved set (ceiling → 400)", async () => {
  // presence is default-off and not org-enabled → a programme can't mandate it.
  const r = await put("/features/programme/prog-platform", { required: ["presence"] });
  assert.equal(r.status, 400);
});

test("a caller cannot govern a programme they have no project in (scope-ownership → 403)", async () => {
  // `prog-unowned` is a valid id shape with a valid body, but it's not in the caller's project graph.
  const r = await put("/features/programme/prog-unowned", { forbidden: ["grid"] });
  assert.equal(r.status, 403);
});

test("a caller cannot govern a project they can't see (scope-ownership → 403)", async () => {
  const r = await put("/features/project/proj-not-mine", { forbidden: ["grid"] });
  assert.equal(r.status, 403);
});

test("a self-contradictory config (same id required AND forbidden) is rejected", async () => {
  const r = await put("/features/programme/prog-1", { required: ["grid"], forbidden: ["grid"] });
  assert.equal(r.status, 400);
});

test("an unknown catalogue id is rejected (no silent dead config)", async () => {
  const r = await put("/features/programme/prog-1", { forbidden: ["definitely-not-a-feature"] });
  assert.equal(r.status, 400);
});

test("a reserved prototype key as the scope id is rejected", async () => {
  const r = await put("/features/programme/__proto__", { forbidden: ["grid"] });
  assert.equal(r.status, 400);
});

test("a project cannot require a feature the programme forbade (project ceiling honours programme forbid)", async () => {
  // programme prog-platform forbids grid; proj-001 (which belongs to it) then tries to mandate grid.
  // The ceiling uses the project's REAL programme (resolved server-side), so → 400.
  assert.equal((await put("/features/programme/prog-platform", { forbidden: ["grid"] })).status, 200);
  const r = await put("/features/project/proj-001", { required: ["grid"] });
  assert.equal(r.status, 400);
});

test("governance rules round-trip and restrict predicates to the sync-safe fields", async () => {
  // a valid rule (scoped by projectType) is accepted — but editing a governance CONTROL is held for a
  // signed sign-off (§0), so it goes live only after the solo admin confirm+signs.
  const ok = await put("/features/governance-rules", {
    governanceRules: [{ id: "r1", when: { all: [{ field: "projectType", op: "eq", value: "internal" }] }, forbid: ["report:evm"] }],
  });
  assert.equal(ok.status, 202);
  await signOffRelaxation(((await ok.json()) as { pending: { proposalId: string } }).pending.proposalId, "u-feat");
  const got = await fetch(`${base}/api/features/governance-rules`, { headers: { cookie: ADMIN } }).then((r) => r.json()) as { governanceRules: { id: string }[] };
  assert.deepEqual(got.governanceRules.map((r) => r.id), ["r1"]);
  // a predicate on a non-sync-safe field (budget) is rejected — it couldn't be enforced consistently
  const bad = await put("/features/governance-rules", { governanceRules: [{ id: "r2", when: { all: [{ field: "budget", op: "gt", value: 1000 }] }, forbid: ["report:evm"] }] });
  assert.equal(bad.status, 400);
  // an unknown catalogue id is rejected
  const badId = await put("/features/governance-rules", { governanceRules: [{ id: "r3", forbid: ["not-a-report"] }] });
  assert.equal(badId.status, 400);
});

test("a non-array field in a scope config is rejected → 400 (readScopeConfig shape guard)", async () => {
  const r = await put("/features/programme/prog-platform", { disabled: "not-an-array" });
  assert.equal(r.status, 400);
});

test("a project PUT with a malformed config is rejected → 400 (SettingsValidationError path)", async () => {
  // proj-001 is owned, so we get past ownership/ceiling and hit the body-shape validation error.
  const r = await put("/features/project/proj-001", { forbidden: [123] });
  assert.equal(r.status, 400);
});

test("a project the caller owns can be governed → 200 (project scope config saved)", async () => {
  const r = await put("/features/project/proj-001", { forbidden: ["grid"] });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { projectId: string; config: { forbidden: string[] } };
  assert.equal(body.projectId, "proj-001");
  assert.deepEqual(body.config.forbidden, ["grid"]);
  // and the project scope now reports grid blocked
  const scoped = (await getFeatures("?projectId=proj-001")).body.features.find((f) => f.id === "grid")!;
  assert.equal(scoped.enabled, false);
});

test("governance rules carry a label, require/disable arrays, and an `any` predicate set", async () => {
  const r = await put("/features/governance-rules", {
    governanceRules: [
      { id: "labelled", label: "internal locks report", when: { any: [{ field: "projectType", op: "eq", value: "internal" }] }, require: ["grid"], disable: ["presence"] },
    ],
  });
  assert.equal(r.status, 202); // held: a governance-control edit needs a signed sign-off
  await signOffRelaxation(((await r.json()) as { pending: { proposalId: string } }).pending.proposalId, "u-feat");
  const got = (await fetch(`${base}/api/features/governance-rules`, { headers: { cookie: ADMIN } }).then((x) => x.json())) as { governanceRules: { id: string; label?: string; require?: string[]; disable?: string[] }[] };
  assert.equal(got.governanceRules[0]!.label, "internal locks report");
  assert.deepEqual(got.governanceRules[0]!.require, ["grid"]);
  assert.deepEqual(got.governanceRules[0]!.disable, ["presence"]);
});

test("a governance rule with a non-array require field is rejected → 400", async () => {
  const r = await put("/features/governance-rules", { governanceRules: [{ id: "bad", require: "grid" }] });
  assert.equal(r.status, 400);
});

test("a governance rule without an id is rejected → 400", async () => {
  // readGovernanceRules: `if (!asStr(o["id"])) throw` — a rule object missing its id.
  const r = await put("/features/governance-rules", { governanceRules: [{ label: "no id here", forbid: ["report:evm"] }] });
  assert.equal(r.status, 400);
});

test("a governance rule with a malformed predicate (unknown op) is rejected → 400", async () => {
  // validatePredicate rejects the op before the sync-safe-field check, so the `if (err) throw` arm fires.
  const r = await put("/features/governance-rules", {
    governanceRules: [{ id: "bad-pred", when: { all: [{ field: "projectType", op: "definitely-not-an-op", value: "internal" }] }, forbid: ["report:evm"] }],
  });
  assert.equal(r.status, 400);
});

test("PUT governance-rules with no governanceRules array clears the list → 200", async () => {
  // readGovernanceRules: the `Array.isArray(raw) ? raw : []` false arm — a body with no array.
  const r = await put("/features/governance-rules", {});
  assert.equal(r.status, 200);
  const body = (await r.json()) as { governanceRules: unknown[] };
  assert.deepEqual(body.governanceRules, []);
});

test("a reserved prototype key as the project scope id is rejected → 400", async () => {
  // The project handler's safeScopeKey guard (mirror of the programme one), which was uncovered.
  const r = await put("/features/project/__proto__", { forbidden: ["grid"] });
  assert.equal(r.status, 400);
});

test("an org `forbid report:x` actually withholds the report from /setup/reports (not just the admin table)", async () => {
  const reportsOf = () => fetch(`${base}/api/setup/reports`, { headers: { cookie: ADMIN } }).then(async (r) => (await r.json() as { id: string }[]).map((x) => x.id));
  assert.ok((await reportsOf()).includes("evm")); // present by default
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ featureGovernance: { required: [], forbidden: ["report:evm"] } });
  assert.ok(!(await reportsOf()).includes("evm")); // forbidden → gone from what's served
});

test("disabling a UI feature also 404s its persistence endpoint (the gate is not decorative)", async () => {
  const { updateSettings } = await import("../lib/settings");
  const hit = (path: string) => fetch(`${base}/api${path}`, { headers: { cookie: ADMIN } }).then((r) => r.status);

  // Enabled by default (no defaultOff): the endpoints answer.
  assert.notEqual(await hit("/views"), 404, "views reachable when savedViews on");
  assert.notEqual(await hit("/dashboards"), 404, "dashboards reachable when on");
  assert.notEqual(await hit("/content-pages"), 404, "content-pages reachable when on");

  // Disable the features org-wide — the persistence endpoints must 404, not just the SPA UI.
  updateSettings({ disabledFeatures: ["savedViews", "dashboards", "contentPages"] });
  assert.equal(await hit("/views"), 404, "views 404s once savedViews disabled");
  assert.equal(await hit("/dashboards"), 404, "dashboards 404s once disabled");
  assert.equal(await hit("/content-pages"), 404, "content-pages 404s once disabled");
});
