import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * routes/automations.ts — the automation-recipe store + preview, over the REAL app (demo broker). The
 * authoring guard enforces the hard rule (a user may only automate what they may edit); preview dry-runs the
 * compile. Recipes are a config def now, so enable the sealed store.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "automations-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });
afterEach(async () => { const { writeOrgConfigCollection } = await import("../lib/scoped-config"); writeOrgConfigCollection("automations", "Automations", []); });
const req = (p: string, o: Parameters<Harness["req"]>[1] = {}) => h.req(p, { cookie: ADMIN, ...o });

const INFORM = {
  id: "r1", label: "Notify PM", scope: { kind: "org" },
  trigger: { kind: "issue.created" },
  conditions: [{ field: "priority", op: "eq", value: "high" }],
  actions: [{ kind: "notify", params: { to: "pm@x.io", message: "hi" } }],
};
const MUTATING = {
  id: "r2", label: "Auto-triage", scope: { kind: "project", projectId: "proj-001" },
  trigger: { kind: "issue.created" },
  actions: [{ kind: "set-field", params: { status: "triage" } }],
};

test("automations: save inform-only recipe + read back", async () => {
  assert.equal((await req("/automations", { method: "PUT", body: { automations: [INFORM] } })).status, 200);
  const got = (await (await req("/automations")).json()) as { automations: Array<{ id: string }> };
  assert.equal(got.automations[0]!.id, "r1");
});

test("automations: an author may automate a mutating action in a project they can write", async () => {
  // The admin session holds every grant and proj-001 is in scope → allowed.
  assert.equal((await req("/automations", { method: "PUT", body: { automations: [MUTATING] } })).status, 200);
});

test("automations: a viewer may automate an inform action but NOT a work-item write (403)", async () => {
  const prevIssuer = process.env["OIDC_ISSUER_URL"]; const prevDefault = process.env["OIDC_DEFAULT_ROLE"];
  process.env["OIDC_ISSUER_URL"] = "https://idp.example"; process.env["OIDC_DEFAULT_ROLE"] = "viewer";
  try {
    // Inform-only is fine — no edit right needed.
    assert.equal((await h.req("/automations", { cookie: memberCookie(), method: "PUT", body: { automations: [INFORM] } })).status, 200);
    // A mutating recipe requires writing work items → a viewer can't automate what they can't do by hand.
    assert.equal((await h.req("/automations", { cookie: memberCookie(), method: "PUT", body: { automations: [MUTATING] } })).status, 403);
  } finally {
    if (prevIssuer === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prevIssuer;
    if (prevDefault === undefined) delete process.env["OIDC_DEFAULT_ROLE"]; else process.env["OIDC_DEFAULT_ROLE"] = prevDefault;
  }
});

test("automations: malformed recipe → 400", async () => {
  const r = await req("/automations", { method: "PUT", body: { automations: [{ ...INFORM, actions: [] }] } });
  assert.equal(r.status, 400);
});

test("automations: preview compiles a draft + reports requirements and mutation", async () => {
  const inform = (await (await req("/automations/preview", { method: "POST", body: { recipe: INFORM } })).json()) as { workflow: { steps: unknown[] }; mutates: boolean; canAuthor: boolean; requirements: unknown[] };
  assert.equal(inform.mutates, false);
  assert.equal(inform.canAuthor, true);
  assert.deepEqual(inform.requirements, [{ kind: "inform" }]);
  assert.ok(inform.workflow.steps.length > 0);

  const mut = (await (await req("/automations/preview", { method: "POST", body: { recipe: MUTATING } })).json()) as { mutates: boolean; canAuthor: boolean };
  assert.equal(mut.mutates, true); // ⇒ needs an autonomous grant to actually run
  assert.equal(mut.canAuthor, true);
});

test("automations: preview of a bad recipe → 400", async () => {
  const r = await req("/automations/preview", { method: "POST", body: { recipe: { id: "x", label: "", scope: { kind: "org" }, trigger: { kind: "issue.created" }, actions: [] } } });
  assert.equal(r.status, 400);
});

test("automations: run an inform recipe — conditions gate it, then it fires", async () => {
  const { writeOrgConfigCollection } = await import("../lib/scoped-config");
  writeOrgConfigCollection("automations", "Automations", [INFORM]);
  // Subject doesn't match the condition (priority eq high) → not run.
  const miss = (await (await req("/automations/r1/run", { method: "POST", body: { subject: { priority: "low" } } })).json()) as { matched: boolean; ran: boolean };
  assert.deepEqual(miss, { matched: false, ran: false });
  // Matching subject → the notify action runs.
  const hit = (await (await req("/automations/r1/run", { method: "POST", body: { subject: { priority: "high" } } })).json()) as { matched: boolean; ran: boolean; results: Record<string, unknown> };
  assert.equal(hit.matched, true);
  assert.equal(hit.ran, true);
  assert.deepEqual(hit.results["action-0"], { sent: true });
});

test("automations: running a mutating recipe is held for a grant (202)", async () => {
  const { writeOrgConfigCollection } = await import("../lib/scoped-config");
  writeOrgConfigCollection("automations", "Automations", [MUTATING]);
  const r = await req("/automations/r2/run", { method: "POST", body: { subject: {} } });
  assert.equal(r.status, 202); // mutating ⇒ needs an autonomous grant; not silently run
});

test("automations: running an unknown recipe → 404", async () => {
  assert.equal((await req("/automations/ghost/run", { method: "POST", body: { subject: {} } })).status, 404);
});
