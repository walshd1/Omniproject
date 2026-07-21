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
  const { writeOrgConfigCollection } = await import("../lib/scoped-config");
  writeOrgConfigCollection("methodology-composition", "Methodology composition", null);
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

test("POST deploy/:id requires admin/PMO", async () => {
  const r = await h.req("/methodology-composition/deploy/gtd", { method: "POST" });
  assert.equal(r.status, 401);
});

test("POST deploy/:id at a PROGRAMME scope writes there (nearer scope), leaving org untouched", async () => {
  const r = await h.req("/methodology-composition/deploy/gtd", { method: "POST", cookie: adminCookie(), body: { programmeId: "prog-9" } });
  assert.equal(r.status, 200);
  const out = await json(r);
  assert.equal(out.scope, "programme");
  assert.ok(out.methodologyComposition.includes("screen:gtd-overview"));
  // Org (no scope) is still uncurated — the deploy landed on the programme, not the org.
  const org = await json(await h.req("/methodology-composition", { cookie: adminCookie() }));
  assert.equal(org.methodologyComposition, null);
});

test("POST deploy/:id rejects naming both a programme AND a project → 400", async () => {
  const r = await h.req("/methodology-composition/deploy/gtd", { method: "POST", cookie: adminCookie(), body: { programmeId: "p1", projectId: "pr1" } });
  assert.equal(r.status, 400);
});
