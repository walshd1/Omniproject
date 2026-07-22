import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// The def store must be configured + the importer module on BEFORE the app is imported by the harness.
process.env["OMNI_CONFIG_DIR"] = fs.mkdtempSync(path.join(os.tmpdir(), "forms-conv-"));
process.env["ENABLED_FEATURES"] = "defImporter";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * routes/forms.ts over the REAL app after the def-store convergence (roadmap X.10 forms). Form DEFINITIONS are
 * now artifacts authored through the importer (`POST /api/defs`, kind `form`); the submission route reads them
 * from the def store (`findFormDef`), the capability gate rides the importer write path, and the legacy
 * `PUT /forms` survives only to DRAIN to `[]`. A legacy `settings.forms` entry still submits (the migration
 * bridge) until it's drained.
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(process.env["OMNI_CONFIG_DIR"]!, { recursive: true, force: true }); });
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ forms: [] });
  const { replaceArtifacts } = await import("../lib/artifact-store");
  const { DEF_ARTIFACT } = await import("../lib/def-import");
  replaceArtifacts(DEF_ARTIFACT, { kind: "org" }, []); // clear org-authored form defs between tests
  const { setRuleModes } = await import("../lib/ruleset");
  setRuleModes({ "read-only": "off", "no-deletes": "off", "require-assignee": "off", "require-description": "off", "due-after-start": "off" });
  const { resetDemoBrokerState } = await import("../broker/demo");
  resetDemoBrokerState();
});
const req = (p: string, o: Parameters<Harness["req"]>[1] = {}) => h.req(p, { cookie: ADMIN, ...o });

const FORM = {
  id: "intake", label: "Work request",
  fields: [
    { key: "summary", label: "Summary", type: "text", mapTo: "title", required: true },
    { key: "priority", label: "Priority", type: "select", mapTo: "priority", options: ["Low", "High"], required: true },
  ],
  target: { kind: "issue", projectId: "proj-001", status: "triage", labels: ["intake"] },
};

/** Author a form THROUGH the importer (the one write path) into the org def store. */
const authorForm = (form: object, cookie = ADMIN) =>
  req("/defs", { method: "POST", cookie, body: { kind: "form", storage: "org", name: (form as { label?: string }).label ?? "Form", payload: form } });

test("forms: authored via the importer, then submittable + resolvable", async () => {
  assert.equal((await authorForm(FORM)).status, 201);
  const r = await req("/forms/intake/submit", { method: "POST", body: { values: { summary: "Fix login", priority: "High" } } });
  assert.equal(r.status, 201);
  assert.equal(((await r.json()) as { issue: { title: string } }).issue.title, "Fix login");
});

test("forms: the legacy PUT /forms is retired — a non-empty write is 410, draining to [] is allowed", async () => {
  assert.equal((await req("/forms", { method: "PUT", body: { forms: [FORM] } })).status, 410);
  assert.equal((await req("/forms", { method: "PUT", body: { forms: [] } })).status, 200);
});

test("forms: a legacy settings.forms entry still submits (migration bridge)", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ forms: [FORM] }); // pre-convergence data, not yet migrated
  const r = await req("/forms/intake/submit", { method: "POST", body: { values: { summary: "x", priority: "Low" } } });
  assert.equal(r.status, 201);
});

test("forms: an invalid submission is a typed 400 (missing required)", async () => {
  await authorForm(FORM);
  const r = await req("/forms/intake/submit", { method: "POST", body: { values: { priority: "High" } } });
  assert.equal(r.status, 400);
});

test("forms: submitting an unknown or disabled form is 404", async () => {
  await authorForm({ ...FORM, enabled: false });
  assert.equal((await req("/forms/intake/submit", { method: "POST", body: { values: { summary: "x", priority: "Low" } } })).status, 404);
  assert.equal((await req("/forms/ghost/submit", { method: "POST", body: { values: {} } })).status, 404);
});

test("forms: submission obeys the business ruleset (read-only mode blocks it 422)", async () => {
  const { setRuleModes } = await import("../lib/ruleset");
  await authorForm(FORM);
  setRuleModes({ "read-only": "hard" });
  const r = await req("/forms/intake/submit", { method: "POST", body: { values: { summary: "x", priority: "Low" } } });
  assert.equal(r.status, 422);
});

test("forms: the importer gate rejects a form mapping onto a non-storable field", async () => {
  const prev = process.env["CAPABILITIES"];
  process.env["CAPABILITIES"] = "issues"; // financials/scheduling OFF → budget/dueDate not storable
  try {
    const mapsBudget = { ...FORM, fields: [...FORM.fields, { key: "cost", label: "Cost", type: "number", mapTo: "budget" }] };
    assert.equal((await authorForm(mapsBudget)).status, 400); // budget isn't advertised writable → rejected at authoring
    assert.equal((await authorForm(FORM)).status, 201);       // issues-domain fields only → fine
  } finally { if (prev === undefined) delete process.env["CAPABILITIES"]; else process.env["CAPABILITIES"] = prev; }
});

test("forms: submit defensively drops a field the backend no longer advertises", async () => {
  const { updateSettings } = await import("../lib/settings");
  // Seed (bridge) with a budget mapping authored under full caps, then submit under a restricted backend.
  updateSettings({ forms: [{ ...FORM, fields: [...FORM.fields, { key: "cost", label: "Cost", type: "number", mapTo: "budget" }] }] });
  const prev = process.env["CAPABILITIES"];
  process.env["CAPABILITIES"] = "issues"; // financials now OFF
  try {
    const r = await req("/forms/intake/submit", { method: "POST", body: { values: { summary: "x", priority: "Low", cost: 500 } } });
    assert.equal(r.status, 201);
    assert.equal(((await r.json()) as { issue: Record<string, unknown> }).issue["budget"], undefined); // dropped
  } finally { if (prev === undefined) delete process.env["CAPABILITIES"]; else process.env["CAPABILITIES"] = prev; }
});

test("forms: an untargeted template refuses submission (400)", async () => {
  await authorForm({ ...FORM, target: { kind: "issue", titleFrom: "summary" } });
  const r = await req("/forms/intake/submit", { method: "POST", body: { values: { summary: "x", priority: "Low" } } });
  assert.equal(r.status, 400);
});

test("forms: authoring a form is gated (a plain member can't write the org def store)", async () => {
  const prev = process.env["OIDC_ISSUER_URL"]; process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  try {
    assert.equal((await authorForm(FORM, memberCookie())).status, 403);
  } finally { if (prev === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prev; }
});
