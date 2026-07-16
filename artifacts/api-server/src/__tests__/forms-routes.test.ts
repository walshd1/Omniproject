import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * routes/forms.ts over the REAL app (demo broker). The form DEFINITIONS store (GET open, PUT admin/PMO) plus
 * the submission endpoint that turns a filled-in form into a brokered issue — scope-guarded, typed-400 on a
 * bad def/submission, and refusing an untargeted template.
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ forms: [] });
  const { resetDemoBrokerState } = await import("../broker/demo");
  resetDemoBrokerState();
});
const req = (p: string, o: Parameters<Harness["req"]>[1] = {}) => h.req(p, { cookie: ADMIN, ...o });

const FORM = {
  id: "intake", label: "Work request",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "priority", label: "Priority", type: "select", options: ["Low", "High"], required: true },
  ],
  target: { kind: "issue", projectId: "proj-001", titleFrom: "summary", status: "triage", labels: ["intake"], map: { priority: "priority" } },
};

test("forms: save definitions (admin) + read them back", async () => {
  assert.equal((await req("/forms", { method: "PUT", body: { forms: [FORM] } })).status, 200);
  const got = (await (await req("/forms")).json()) as { forms: Array<{ id: string }> };
  assert.equal(got.forms[0]!.id, "intake");
});

test("forms: authoring is gated to admin/PMO", async () => {
  const prev = process.env["OIDC_ISSUER_URL"]; process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  try {
    const r = await h.req("/forms", { cookie: memberCookie(), method: "PUT", body: { forms: [FORM] } });
    assert.equal(r.status, 403);
  } finally { if (prev === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prev; }
});

test("forms: a valid submission creates a brokered issue", async () => {
  await req("/forms", { method: "PUT", body: { forms: [FORM] } });
  const r = await req("/forms/intake/submit", { method: "POST", body: { values: { summary: "Fix login", priority: "High" } } });
  assert.equal(r.status, 201);
  const body = (await r.json()) as { ok: boolean; issue: { title: string } };
  assert.equal(body.ok, true);
  assert.equal(body.issue.title, "Fix login");
});

test("forms: an invalid submission is a typed 400 (missing required)", async () => {
  await req("/forms", { method: "PUT", body: { forms: [FORM] } });
  const r = await req("/forms/intake/submit", { method: "POST", body: { values: { priority: "High" } } });
  assert.equal(r.status, 400);
});

test("forms: submitting an unknown or disabled form is 404", async () => {
  await req("/forms", { method: "PUT", body: { forms: [{ ...FORM, enabled: false }] } });
  assert.equal((await req("/forms/intake/submit", { method: "POST", body: { values: { summary: "x", priority: "Low" } } })).status, 404);
  assert.equal((await req("/forms/ghost/submit", { method: "POST", body: { values: {} } })).status, 404);
});

test("forms: an untargeted template refuses submission (400)", async () => {
  await req("/forms", { method: "PUT", body: { forms: [{ ...FORM, target: { kind: "issue", titleFrom: "summary" } }] } });
  const r = await req("/forms/intake/submit", { method: "POST", body: { values: { summary: "x", priority: "Low" } } });
  assert.equal(r.status, 400);
});
