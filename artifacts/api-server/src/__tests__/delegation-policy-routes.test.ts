import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/delegation-policy.ts over the REAL app — the admin governance dial for how far down local variation
 * is allowed per area. GET is any-authed (a scope-owner UI reads it); PUT is admin-only. Persistence rides the
 * sealed store, so enable it.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delegation-policy-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET returns the centralized default policy + the picker vocabulary", async () => {
  const r = await h.req("/admin/delegation-policy", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const out = await json(r);
  assert.deepEqual(out.policy, { ruleset: "org", settings: "org", methodologyComposition: "org" });
  assert.deepEqual(out.levels, ["org", "programme", "project", "user"]);
  assert.ok(out.areas.includes("methodologyComposition"));
});

test("GET requires auth", async () => {
  const r = await h.req("/admin/delegation-policy");
  assert.equal(r.status, 401);
});

test("PUT (admin) sets the policy; unknown levels are sanitised to the default", async () => {
  const r = await h.req("/admin/delegation-policy", {
    method: "PUT", cookie: adminCookie(),
    body: { policy: { ruleset: "programme", settings: "galaxy", methodologyComposition: "project" } },
  });
  assert.equal(r.status, 200);
  const out = await json(r);
  assert.deepEqual(out.policy, { ruleset: "programme", settings: "org", methodologyComposition: "project" });
  // It persisted — a follow-up GET sees it.
  const got = await json(await h.req("/admin/delegation-policy", { cookie: adminCookie() }));
  assert.equal(got.policy.ruleset, "programme");
});

test("PUT requires auth (unauthenticated is refused)", async () => {
  const r = await h.req("/admin/delegation-policy", { method: "PUT", body: { policy: { ruleset: "project" } } });
  assert.equal(r.status, 401);
});
