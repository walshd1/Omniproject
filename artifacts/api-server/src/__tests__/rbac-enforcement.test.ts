import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, cookie, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * REAL RBAC enforcement over the live app — the coverage the rest of the route suite can't give.
 *
 * Every other harness-based route test boots in DEMO auth (no IdP configured), where `grantsFromClaims`
 * hands every session all authorities — so `adminCookie()` and `memberCookie()` are the SAME principal
 * and any "member gets 200" assertion is tautological. This file deliberately leaves demo mode
 * (`isDemoAuth` checks the auth env live, per request) and pins the claim→role env, so the five fixed
 * roles map deterministically and the gates are genuinely exercised end-to-end.
 *
 * It also pins down two load-bearing subtleties of the model that a demo-mode (all-authorities) test
 * can never catch:
 *  - `pmo` and `admin` are ORTHOGONAL authorities (lib/rbac.ts grantsSatisfy) — a pure admin does NOT
 *    satisfy a `pmo` gate and vice versa;
 *  - the pmo/admin authorities are only granted with STRONG AUTH (`grantsFromClaims`), so these
 *    sessions carry a strong `amr` (WebAuthn `hwk`); the member deliberately does not.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());

// Strong-auth sessions (amr: hwk) so the pmo/admin authorities are actually granted, not withheld.
const STRONG = { amr: ["hwk"] };
const strongAdmin = () => adminCookie(STRONG);
const pmoCookie = () => cookie({ sub: "u-pmo", name: "Pat PMO", email: "pat@x.io", roles: ["omni-pmo"], ...STRONG });

/** Run `fn` with real RBAC in force: leave demo mode and pin the claim→role mapping, then restore. */
async function withRealRbac(fn: () => Promise<void>): Promise<void> {
  const keys = ["OIDC_ISSUER_URL", "OIDC_ADMIN_ROLES", "OIDC_PMO_ROLES"] as const;
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_ADMIN_ROLES"] = "omni-admins";
  process.env["OIDC_PMO_ROLES"] = "omni-pmo";
  try {
    await fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("admin-gated route (GET /ai/providers): admin passes, member and (orthogonal) pmo are 403", async () => {
  await withRealRbac(async () => {
    assert.equal((await h.req("/ai/providers", { cookie: strongAdmin() })).status, 200);
    assert.equal((await h.req("/ai/providers", { cookie: memberCookie() })).status, 403);
    // A pure PMO must NOT clear an admin gate — proves the authorities are orthogonal, not ranked.
    assert.equal((await h.req("/ai/providers", { cookie: pmoCookie() })).status, 403);
  });
});

test("pmo-gated write (PUT /views): pmo passes the gate, member and (orthogonal) admin are 403", async () => {
  await withRealRbac(async () => {
    // Not asserting the exact success code (that's body-validation's job) — only that the gate let
    // the PMO through (any non-403), while the two non-PMO principals are rejected at the gate.
    const pmo = await h.req("/views", { cookie: pmoCookie(), method: "PUT", body: { views: [] } });
    assert.notEqual(pmo.status, 403);
    assert.equal((await h.req("/views", { cookie: memberCookie(), method: "PUT", body: { views: [] } })).status, 403);
    // A pure admin must NOT clear a PMO gate — the mirror of the case above.
    assert.equal((await h.req("/views", { cookie: strongAdmin(), method: "PUT", body: { views: [] } })).status, 403);
  });
});

test("reads stay open to any authenticated principal even under real RBAC (GET /views)", async () => {
  await withRealRbac(async () => {
    assert.equal((await h.req("/views", { cookie: memberCookie() })).status, 200);
  });
});

// ── IDOR fix: GET /history/trends is scope-checked (P0) ───────────────────────
// Before the fix any authenticated principal could read any project's retained history by naming its
// id. A scoped (user-level) principal must not read cross-scope history; a PMO (all scope) still can.
test("history trends: a scoped principal can't read portfolio-wide or out-of-scope history", async () => {
  await withRealRbac(async () => {
    // A user-level principal (member) has no portfolio scope → portfolio-wide trend is refused.
    const wide = await h.req("/history/trends/completionPct", { cookie: memberCookie() });
    assert.equal(wide.status, 403);
    // Naming a specific project they can't see is refused too (fail-closed on an unknown/out-of-scope id).
    const proj = await h.req("/history/trends/completionPct?projectId=some-other-teams-project", { cookie: memberCookie() });
    assert.equal(proj.status, 403);
  });
});

test("history trends: a portfolio-scoped principal (PMO) is not blocked by the scope guard", async () => {
  await withRealRbac(async () => {
    // all-scope ⇒ the guard passes; the response is the honest trend/availability payload, never a 403.
    const r = await h.req("/history/trends/completionPct?projectId=any-project", { cookie: pmoCookie() });
    assert.notEqual(r.status, 403);
  });
});

// ── IDOR fix: GET /history/replay is scope-checked (portfolio-wide retained history) ──
// Replay returns recorded portfolio-wide states; like the portfolio-wide branch of the trends guard it
// requires portfolio (PMO/admin) scope, else any scoped principal could read the whole portfolio's log.
test("history replay: a scoped principal can't read portfolio-wide retained history (403); PMO can", async () => {
  const { updateSettings } = await import("../lib/settings");
  await withRealRbac(async () => {
    updateSettings({ loggingSync: { enabled: true, url: "https://logs.example.com", acknowledgedWarranty: true } });
    try {
      // A user-level principal has no portfolio scope → the portfolio-wide replay is refused.
      assert.equal((await h.req("/history/replay", { cookie: memberCookie() })).status, 403);
      // A portfolio-scoped principal (PMO) passes the guard (never a 403).
      assert.notEqual((await h.req("/history/replay", { cookie: pmoCookie() })).status, 403);
    } finally {
      updateSettings({ loggingSync: { enabled: false } });
    }
  });
});

// ── IDOR fix: every per-:projectId route is scope-checked (guardProjectScope) ──
// The broker enforces scope only on listProjects/updateProject; before this fix every other
// per-project read/write served a caller-supplied :projectId straight to a scope-blind broker method.
// A scoped principal must not read or mutate a project outside its scope by naming the id.
test("per-project routes: a scoped principal is refused an out-of-scope project (403), reads AND writes", async () => {
  await withRealRbac(async () => {
    const other = "some-other-teams-project";
    // Reads
    for (const path of [
      `/projects/${other}/summary`,
      `/projects/${other}/financials`,
      `/projects/${other}/issues`,
      `/projects/${other}/history`,
      `/projects/${other}/raid`,
      `/projects/${other}/baseline`,
      `/projects/${other}/members`,
      `/projects/${other}/capacity`,
    ]) {
      assert.equal((await h.req(path, { cookie: memberCookie() })).status, 403, `GET ${path}`);
    }
    // Writes (member holds contributor tier under demo-authorities, so a 403 here is the SCOPE gate,
    // not the role gate — proving the write path is scope-checked, not just tier-checked).
    const create = await h.req(`/projects/${other}/issues`, { cookie: memberCookie(), method: "POST", body: { title: "x" } });
    assert.equal(create.status, 403, "POST issues out-of-scope");
  });
});

test("per-project routes: a portfolio-scoped principal (PMO) is not blocked by the scope guard", async () => {
  await withRealRbac(async () => {
    // all-scope ⇒ guardProjectScope passes for any id; the response is the broker's (404/200/…), never 403.
    const r = await h.req("/projects/any-project/summary", { cookie: pmoCookie() });
    assert.notEqual(r.status, 403);
  });
});

// ── IDOR follow-up: tasks / comments / export / calendar are scope-checked too ─
test("tasks: a scoped principal can't read a task outside its scope (project-linked OR personal)", async () => {
  await withRealRbac(async () => {
    // task-3 is a PERSONAL task (projectId null) owned by sam@demo — a scoped member is neither its owner
    // nor a collaborator, so the personal-owner branch of assertTaskScope refuses it.
    assert.equal((await h.req("/tasks/task-3", { cookie: memberCookie() })).status, 403);
    // Its comments/attachments sub-resources are gated the same way (the task is fetched + scoped first).
    assert.equal((await h.req("/tasks/task-3/comments", { cookie: memberCookie() })).status, 403);
  });
});

test("tasks: a portfolio-scoped principal (PMO) is not blocked by the task scope guard", async () => {
  await withRealRbac(async () => {
    const r = await h.req("/tasks/task-1", { cookie: pmoCookie() }); // project-linked sample task
    assert.notEqual(r.status, 403);
  });
});

test("tasks list: a scoped principal's GET /tasks is filtered — other users' personal tasks don't leak", async () => {
  await withRealRbac(async () => {
    // Sample data: task-3 (personal, sam@demo) and task-4 (personal, unassigned) belong to no one the
    // harness member (grace@x.io) is the owner/collaborator of. Before the fix, listTasks handed the raw
    // list back scope-blind; now filterTasksInScope drops out-of-scope personal tasks.
    const r = await h.req("/tasks", { cookie: memberCookie() });
    assert.equal(r.status, 200);
    const ids = new Set((await r.json() as Array<{ id: string }>).map((t) => t.id));
    assert.equal(ids.has("task-3"), false, "another user's personal task must not leak in the list");
    assert.equal(ids.has("task-4"), false, "an unowned personal task must not leak in the list");
  });
});

test("tasks list: a portfolio-scoped principal (PMO) still sees every task including personal ones", async () => {
  await withRealRbac(async () => {
    const r = await h.req("/tasks", { cookie: pmoCookie() });
    assert.equal(r.status, 200);
    const ids = new Set((await r.json() as Array<{ id: string }>).map((t) => t.id));
    assert.equal(ids.has("task-3"), true); // all-scope is unfiltered
    assert.equal(ids.has("task-4"), true);
  });
});

test("rate-card: project-type read/write is scope-checked (a manager can't touch another tenant's config)", async () => {
  await withRealRbac(async () => {
    assert.equal((await h.req("/projects/some-other-teams-project/type", { cookie: memberCookie() })).status, 403);
    const put = await h.req("/projects/some-other-teams-project/type", { cookie: memberCookie(), method: "PUT", body: { projectType: "internal" } });
    assert.equal(put.status, 403);
  });
});

test("export: the ?projectId=<other> issues branch is scope-checked (no cross-tenant issue export)", async () => {
  await withRealRbac(async () => {
    const r = await h.req("/export.json?dataset=issues&projectId=some-other-teams-project", { cookie: memberCookie() });
    assert.equal(r.status, 403);
  });
});

// (The comments room scope-guard — projectIdOfRoom → guardProjectScope — uses the same shared guard
//  exercised by the export/projects tests above. It can't be driven end-to-end here because the
//  comments feature module is lazy-mounted and off at boot in this harness, so the route isn't mounted.)

test("PATCH /settings refuses capabilityStates (step-up + validation bypass) but allows normal keys", async () => {
  // The bulk settings patch must not be a backdoor around PUT /governance/:id (step-up + sanitize).
  const bad = await h.req("/settings", { cookie: adminCookie(), method: "PATCH", body: { capabilityStates: { "provider:ollama": { state: "public", endpoint: "http://169.254.169.254/" } } } });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /governance/i);
  // A normal (choice, non-security) settings key still applies immediately through the same route.
  const ok = await h.req("/settings", { cookie: adminCookie(), method: "PATCH", body: { reportingCurrency: "USD" } });
  assert.equal(ok.status, 200);
});

// ── Step-up minter: a real-auth session can't self-grant step-up (must complete a provider re-auth) ──
test("POST /auth/step-up self-stamps ONLY in demo; a real-auth session gets a re-auth directive, not a stamp", async () => {
  // Demo has no real identity to phish → confirming in place is legitimate.
  const demo = await h.req("/auth/step-up", { cookie: adminCookie(), method: "POST", body: {} });
  assert.equal(demo.status, 200);
  assert.equal(((await demo.json()) as { ok: boolean }).ok, true);
  // Under real auth the same call must NOT stamp — it directs the SPA through a genuine provider re-auth.
  // This is the bypass being closed: a stolen/idle session can no longer self-grant step-up.
  await withRealRbac(async () => {
    const r = await h.req("/auth/step-up", { cookie: adminCookie(), method: "POST", body: {} });
    assert.equal(r.status, 409);
    assert.equal(((await r.json()) as { code: string }).code, "step_up_redirect");
  });
});

// ── Step-up parity: secret-bearing settings keys can't be written through the un-stepped bulk PATCH ──
test("PATCH /settings refuses webhooks + federatedPeers (secret writes have step-up'd dedicated routes)", async () => {
  for (const key of ["webhooks", "federatedPeers"]) {
    const r = await h.req("/settings", { cookie: adminCookie(), method: "PATCH", body: { [key]: [] } });
    assert.equal(r.status, 400, `PATCH ${key}`);
    assert.match(((await r.json()) as { error: string }).error, /step-up required/i);
  }
});

test("POST /webhooks (mints a signing secret) requires a fresh step-up — 403 without one", async () => {
  // step-up runs before the entitlement gate, so this is 403 (step_up_required) regardless of licence.
  const r = await h.req("/webhooks", { cookie: adminCookie(), method: "POST", body: { url: "https://hook.example/x", events: ["issue.updated"] } });
  assert.equal(r.status, 403);
  assert.equal(((await r.json()) as { code: string }).code, "step_up_required");
});
