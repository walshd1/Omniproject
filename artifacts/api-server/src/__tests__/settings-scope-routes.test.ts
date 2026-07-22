import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * Scoped SETTINGS overrides (routes/settings.ts) — a programme/project may override only the SCOPE-VARIABLE
 * allow-list (reporting currency, fx policy, priority weights), governed by the delegation policy. GET /settings
 * folds those keys to the requested scope; everything else stays org-global. Admin-gated; the sealed store holds
 * the override config def.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "settings-scope-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

afterEach(async () => {
  const { writeOrgConfigCollection, writeScopedConfigCollection, DELEGATION_POLICY_ID } = await import("../lib/scoped-config");
  const { DEFAULT_DELEGATION_POLICY } = await import("@workspace/backend-catalogue");
  writeOrgConfigCollection(DELEGATION_POLICY_ID, "Delegation policy", DEFAULT_DELEGATION_POLICY);
  writeScopedConfigCollection("settings-override", "Settings override", {}, { kind: "project", projectId: "pr-1" });
});

async function openSettingsDelegation(level: "programme" | "project"): Promise<void> {
  const { writeOrgConfigCollection, DELEGATION_POLICY_ID } = await import("../lib/scoped-config");
  writeOrgConfigCollection(DELEGATION_POLICY_ID, "Delegation policy", { ruleset: "org", settings: level, methodologyComposition: "org" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("PUT /settings/scope is DENIED by the default (centralized) delegation policy", async () => {
  const r = await h.req("/settings/scope", { method: "PUT", cookie: adminCookie(), body: { projectId: "pr-1", patch: { reportingCurrency: "EUR" } } });
  assert.equal(r.status, 403);
  const out = await json(r);
  assert.equal(out.code, "delegation_denied");
  assert.equal(out.attempted, "project");
});

test("once delegation opens settings to project, a scope override persists and GET folds it", async () => {
  await openSettingsDelegation("project");
  const put = await h.req("/settings/scope", { method: "PUT", cookie: adminCookie(), body: { projectId: "pr-1", patch: { reportingCurrency: "EUR" } } });
  assert.equal(put.status, 200);
  assert.equal((await json(put)).override.reportingCurrency, "EUR");

  // GET /settings scoped to that project folds the override in …
  const scoped = await json(await h.req("/settings?projectId=pr-1", { cookie: adminCookie() }));
  assert.equal(scoped.reportingCurrency, "EUR");
  // … while the org (no scope) view is unchanged.
  const org = await json(await h.req("/settings", { cookie: adminCookie() }));
  assert.notEqual(org.reportingCurrency, "EUR");
});

test("a non-scope-variable key is REJECTED, never stored (allow-list defence)", async () => {
  await openSettingsDelegation("project");
  const r = await h.req("/settings/scope", { method: "PUT", cookie: adminCookie(), body: { projectId: "pr-1", patch: { reportingCurrency: "GBP", deploymentProfile: "enterprise" } } });
  assert.equal(r.status, 200);
  const out = await json(r);
  assert.ok(out.rejected.includes("deploymentProfile")); // refused as non-scope-variable
  assert.equal("deploymentProfile" in out.override, false);
  assert.equal(out.override.reportingCurrency, "GBP");
});
