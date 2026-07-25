import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/methodology-composition.ts over the REAL app — the nullable composition config def
 * (composition model, not a settings key). GET is any-authed; PUT is admin/PMO and validated
 * (null | string[]; anything else → 400). Persistence rides the sealed store, so enable it.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "methodology-composition-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });
afterEach(async () => {
  const { writeOrgConfigCollection, DELEGATION_POLICY_ID } = await import("../lib/scoped-config");
  const { DEFAULT_DELEGATION_POLICY } = await import("@workspace/backend-catalogue");
  writeOrgConfigCollection("methodology-composition", "Methodology composition", null);
  // Reset the delegation policy to the centralized default so tests stay isolated.
  writeOrgConfigCollection(DELEGATION_POLICY_ID, "Delegation policy", DEFAULT_DELEGATION_POLICY);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET without a cookie → 401", async () => {
  const r = await h.req("/methodology-composition");
  assert.equal(r.status, 401);
});

test("GET defaults to null (uncurated) when nothing is stored", async () => {
  const r = await h.req("/methodology-composition", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.equal((await json(r)).methodologyComposition, null);
});

test("PUT an array persists and round-trips", async () => {
  const put = await h.req("/methodology-composition", {
    method: "PUT", cookie: adminCookie(), body: { methodologyComposition: ["report:evm", "output:ical"] },
  });
  assert.equal(put.status, 200);
  assert.deepEqual((await json(put)).methodologyComposition, ["report:evm", "output:ical"]);

  const got = await json(await h.req("/methodology-composition", { cookie: adminCookie() }));
  assert.deepEqual(got.methodologyComposition, ["report:evm", "output:ical"]);
});

test("PUT null clears back to uncurated", async () => {
  await h.req("/methodology-composition", { method: "PUT", cookie: adminCookie(), body: { methodologyComposition: ["report:evm"] } });
  const put = await h.req("/methodology-composition", { method: "PUT", cookie: adminCookie(), body: { methodologyComposition: null } });
  assert.equal(put.status, 200);
  assert.equal((await json(put)).methodologyComposition, null);
});

test("PUT a malformed value (not null / not a string array) → 400", async () => {
  const bad = await h.req("/methodology-composition", { method: "PUT", cookie: adminCookie(), body: { methodologyComposition: [1, 2, 3] } });
  assert.equal(bad.status, 400);
  assert.match((await json(bad)).error, /null or an array of strings/i);

  const bad2 = await h.req("/methodology-composition", { method: "PUT", cookie: adminCookie(), body: { methodologyComposition: "nope" } });
  assert.equal(bad2.status, 400);
});

test("GET deployment/:id previews the one-click plan; unknown → 404", async () => {
  const r = await h.req("/methodology-composition/deployment/gtd", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const plan = await json(r);
  assert.ok(plan.compositionItemIds.includes("screen:gtd-overview"));
  assert.equal(plan.ruleset.id, "gtd");
  assert.equal(plan.invariants.length, 1);

  const miss = await h.req("/methodology-composition/deployment/no-such", { cookie: adminCookie() });
  assert.equal(miss.status, 404);
});

test("POST deploy/:id sets the composition + applies the ruleset in one click", async () => {
  const r = await h.req("/methodology-composition/deploy/gtd", { method: "POST", cookie: adminCookie() });
  assert.equal(r.status, 200);
  const out = await json(r);
  assert.equal(out.appliedRuleset, "gtd");
  assert.ok(out.methodologyComposition.includes("screen:gtd-overview"));
  // The composition persisted — a follow-up GET sees the deployed set.
  const got = await json(await h.req("/methodology-composition", { cookie: adminCookie() }));
  assert.ok(got.methodologyComposition.includes("ruleset:gtd"));
});

test("POST deploy/:id lands the methodology's preset SETTINGS block (scrum → WSJF weights)", async () => {
  const r = await h.req("/methodology-composition/deploy/scrum", { method: "POST", cookie: adminCookie() });
  assert.equal(r.status, 200);
  const out = await json(r);
  // The posture half of the bundle applied: the settings keys are echoed back.
  assert.ok(Array.isArray(out.appliedSettings) && out.appliedSettings.includes("priorityWeights"));
  assert.equal(out.settingsError, undefined);
  // It persisted to the settings store — a follow-up read reflects the WSJF-weighted prioritisation.
  const settings = await json(await h.req("/settings", { cookie: adminCookie() }));
  assert.equal(settings.priorityWeights.wsjf, 40);
});

test("POST deploy/:id requires admin/PMO", async () => {
  const r = await h.req("/methodology-composition/deploy/gtd", { method: "POST" });
  assert.equal(r.status, 401);
});

test("a PROGRAMME-scope deploy is DENIED by the default (centralized) delegation policy", async () => {
  const r = await h.req("/methodology-composition/deploy/gtd", { method: "POST", cookie: adminCookie(), body: { programmeId: "prog-9" } });
  assert.equal(r.status, 403);
  const out = await json(r);
  assert.equal(out.code, "delegation_denied");
  assert.equal(out.allowed, "org");
  assert.equal(out.attempted, "programme");
});

test("POST deploy/:id at a PROGRAMME scope writes there once the admin opens delegation to programme", async () => {
  // Admin opens local variation of methodology down to programme scope …
  const set = await h.req("/admin/delegation-policy", { method: "PUT", cookie: adminCookie(), body: { policy: { methodologyComposition: "programme" } } });
  assert.equal(set.status, 200);
  // … now the programme deploy is permitted and lands at that scope.
  const r = await h.req("/methodology-composition/deploy/gtd", { method: "POST", cookie: adminCookie(), body: { programmeId: "prog-9" } });
  assert.equal(r.status, 200);
  const out = await json(r);
  assert.equal(out.scope, "programme");
  assert.ok(out.methodologyComposition.includes("screen:gtd-overview"));
  // Honest caveat: GTD ships a ruleset, which the org-global engine applied ORG-WIDE — surfaced in scopeNote.
  assert.match(out.scopeNote, /org-wide/i);
  assert.match(out.scopeNote, /ruleset/i);
  // A PROJECT deploy is still denied — the policy only reached programme depth.
  const proj = await h.req("/methodology-composition/deploy/gtd", { method: "POST", cookie: adminCookie(), body: { projectId: "pr-1" } });
  assert.equal(proj.status, 403);
});

test("POST deploy/:id at the ORG scope carries no scopeNote (nothing is 'elsewhere')", async () => {
  const r = await h.req("/methodology-composition/deploy/gtd", { method: "POST", cookie: adminCookie() });
  const out = await json(r);
  assert.equal(out.scopeNote, undefined);
});

test("POST deploy/:id rejects naming both a programme AND a project → 400", async () => {
  const r = await h.req("/methodology-composition/deploy/gtd", { method: "POST", cookie: adminCookie(), body: { programmeId: "p1", projectId: "pr1" } });
  assert.equal(r.status, 400);
});
