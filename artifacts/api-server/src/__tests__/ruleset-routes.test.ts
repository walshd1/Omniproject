import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the PMO governance ruleset edge (routes/ruleset.ts): the mode catalogue,
 * the field-rule set, the reference-ruleset catalogue, and apply-reference (validated body →
 * 400, unknown methodology → 404, a real methodology → 200 + applied bundle). All gated at the
 * `pmo` authority, which demo auth grants every session. The composition gate reads the
 * `methodology-composition` config def, so enable the sealed store.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ruleset-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

async function setComposition(value: string[] | null): Promise<void> {
  const { writeOrgConfigCollection } = await import("../lib/scoped-config");
  writeOrgConfigCollection("methodology-composition", "Methodology composition", value);
}

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

afterEach(async () => {
  // Restore the default ruleset state (modes/field-rules are process-global in lib/ruleset).
  const { setRuleModes, setFieldRules } = await import("../lib/ruleset");
  setRuleModes({});
  setFieldRules([]);
  await setComposition(null);
  // Reset the delegation policy + any scoped ruleset override so tests stay isolated.
  const { writeOrgConfigCollection, writeScopedConfigCollection, DELEGATION_POLICY_ID } = await import("../lib/scoped-config");
  const { DEFAULT_DELEGATION_POLICY } = await import("@workspace/backend-catalogue");
  writeOrgConfigCollection(DELEGATION_POLICY_ID, "Delegation policy", DEFAULT_DELEGATION_POLICY);
  writeScopedConfigCollection("ruleset-override", "Ruleset override", { modes: {}, fieldRules: [] }, { kind: "project", projectId: "pr-1" });
});

/** Open the delegation policy so `ruleset` may vary down to `level`. */
async function openRulesetDelegation(level: "programme" | "project"): Promise<void> {
  const { writeOrgConfigCollection, DELEGATION_POLICY_ID } = await import("../lib/scoped-config");
  writeOrgConfigCollection(DELEGATION_POLICY_ID, "Delegation policy", { ruleset: level, settings: "org", methodologyComposition: "org" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /admin/ruleset: no cookie → 401", async () => {
  const r = await h.req("/admin/ruleset");
  assert.equal(r.status, 401);
});

test("GET /admin/ruleset: returns the rule catalogue", async () => {
  const r = await h.req("/admin/ruleset", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(await json(r)));
});

test("PUT /admin/ruleset: sets modes and echoes the catalogue", async () => {
  const catalogue = await json(await h.req("/admin/ruleset", { cookie: adminCookie() }));
  const first = catalogue[0];
  assert.ok(first?.id, "expected at least one rule in the catalogue");
  const r = await h.req("/admin/ruleset", { method: "PUT", cookie: adminCookie(), body: { [first.id]: "warn" } });
  assert.equal(r.status, 200);
  const updated = await json(r);
  const changed = updated.find((x: { id: string }) => x.id === first.id);
  assert.equal(changed.mode, "warn");
});

test("GET + PUT /admin/ruleset/fields round-trips a field-rule set", async () => {
  const empty = await h.req("/admin/ruleset/fields", { cookie: adminCookie() });
  assert.equal(empty.status, 200);
  assert.ok(Array.isArray(await json(empty)));

  const rules = [{ id: "r1", action: "create_issue", field: "owner", mode: "warn" }];
  const put = await h.req("/admin/ruleset/fields", { method: "PUT", cookie: adminCookie(), body: rules });
  assert.equal(put.status, 200);
  assert.ok(Array.isArray(await json(put)));
});

test("GET /admin/ruleset/reference: lists the reference bundles", async () => {
  const r = await h.req("/admin/ruleset/reference", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(await json(r)));
});

test("POST /admin/ruleset/apply-reference: a missing methodology → 400", async () => {
  const r = await h.req("/admin/ruleset/apply-reference", { method: "POST", cookie: adminCookie(), body: {} });
  assert.equal(r.status, 400);
});

test("POST /admin/ruleset/apply-reference: an unknown methodology → 404", async () => {
  const r = await h.req("/admin/ruleset/apply-reference", { method: "POST", cookie: adminCookie(), body: { methodology: "no-such-methodology-xyz" } });
  assert.equal(r.status, 404);
  assert.match((await json(r)).error, /No reference ruleset/i);
});

test("POST /admin/ruleset/apply-reference: a real methodology applies its bundle → 200", async () => {
  const { referenceRulesetCatalogue } = await import("@workspace/backend-catalogue");
  const bundles = referenceRulesetCatalogue();
  assert.ok(bundles.length > 0, "expected at least one reference ruleset");
  const methodology = bundles[0]!.methodology;
  const r = await h.req("/admin/ruleset/apply-reference", { method: "POST", cookie: adminCookie(), body: { methodology } });
  assert.equal(r.status, 200);
  const body = await json(r);
  assert.equal(body.methodology, methodology);
  assert.ok(Array.isArray(body.rules));
  assert.ok(Array.isArray(body.fieldRules));
});

test("methodology composition gates the reference rulesets (list filtered + apply 403 when disabled)", async () => {
  const { referenceRulesetCatalogue } = await import("@workspace/backend-catalogue");
  const bundles = referenceRulesetCatalogue();
  assert.ok(bundles.length >= 2, "need at least two reference rulesets for this test");
  const kept = bundles[0]!.methodology;
  const disabled = bundles[1]!.methodology;

  // Curate the composition to enable only the first ruleset.
  await setComposition([`ruleset:${kept}`]);
  try {
    const list = await json(await h.req("/admin/ruleset/reference", { cookie: adminCookie() }));
    const ids = (list as { methodology: string }[]).map((b) => b.methodology);
    assert.ok(ids.includes(kept), "the enabled ruleset is listed");
    assert.ok(!ids.includes(disabled), "the disabled ruleset is filtered out");

    // Applying the enabled one still works…
    assert.equal((await h.req("/admin/ruleset/apply-reference", { method: "POST", cookie: adminCookie(), body: { methodology: kept } })).status, 200);
    // …applying the curated-out one is refused.
    const blocked = await h.req("/admin/ruleset/apply-reference", { method: "POST", cookie: adminCookie(), body: { methodology: disabled } });
    assert.equal(blocked.status, 403);
    assert.match((await json(blocked)).error, /disabled by the methodology composition/i);
  } finally {
    await setComposition(null);
  }
});

test("PUT /admin/ruleset/scope is DENIED by the default (centralized) delegation policy", async () => {
  const r = await h.req("/admin/ruleset/scope", { method: "PUT", cookie: adminCookie(), body: { projectId: "pr-1", override: { modes: { "some-rule": "hard" } } } });
  assert.equal(r.status, 403);
  const out = await json(r);
  assert.equal(out.code, "delegation_denied");
  assert.equal(out.allowed, "org");
  assert.equal(out.attempted, "project");
});

test("once delegation opens ruleset to project, a scope override persists (tighten-only, restrict shape)", async () => {
  await openRulesetDelegation("project");
  const r = await h.req("/admin/ruleset/scope", {
    method: "PUT", cookie: adminCookie(),
    body: { projectId: "pr-1", override: { modes: { "due-before-start": "hard" }, fieldRules: [{ id: "own", action: "any-write", field: "owner", mode: "hard" }] } },
  });
  assert.equal(r.status, 200);
  const out = await json(r);
  assert.equal(out.scope, "project");
  assert.equal(out.override.modes["due-before-start"], "hard");
  assert.equal(out.override.fieldRules.length, 1);
  // It reads back at that scope.
  const got = await json(await h.req("/admin/ruleset/scope?projectId=pr-1", { cookie: adminCookie() }));
  assert.equal(got.override.modes["due-before-start"], "hard");
  // A PROGRAMME override is still denied — the policy only reached project via project (programme is deeper-or-equal? no: programme is shallower). Programme depth (1) <= project depth (2) ⇒ allowed too.
  const prog = await h.req("/admin/ruleset/scope", { method: "PUT", cookie: adminCookie(), body: { programmeId: "prog-1", override: { modes: {} } } });
  assert.equal(prog.status, 200); // programme is shallower than the allowed project depth
});

test("a garbage mode in a scope override is dropped (only valid modes stored)", async () => {
  await openRulesetDelegation("project");
  const r = await h.req("/admin/ruleset/scope", {
    method: "PUT", cookie: adminCookie(),
    body: { projectId: "pr-1", override: { modes: { good: "warn", bad: "galaxy" } } },
  });
  const out = await json(r);
  assert.equal(out.override.modes.good, "warn");
  assert.equal("bad" in out.override.modes, false);
});
