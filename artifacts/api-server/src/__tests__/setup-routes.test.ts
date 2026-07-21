import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
// A production build (harness sets NODE_ENV=production) refuses to build redirect URLs from a
// client Host header, so /setup/idp needs an explicit PUBLIC_URL. Set before the app imports.
process.env["PUBLIC_URL"] = "https://setup-test.omni.example";
// self-host adoption (Phase C) is a config def — enable the sealed store so the setup route can persist it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
process.env["OMNI_CONFIG_DIR"] = fs.mkdtempSync(path.join(os.tmpdir(), "setup-routes-"));
import { startHarness, adminCookie, stepUpAdminCookie, type Harness } from "./_harness";

/**
 * Setup-wizard + operations plane over the REAL app. Mostly admin/PMO reads of live wiring, plus
 * the config-dir / environments / rollback / snapshot writes. The demo session holds every grant,
 * so the reachable branches here are: the step-up gate on config-dir/refresh, body/param validation
 * (400), unknown ids (404), the enterprise-licence gate (402), the dev-mode-only debug bundle (409),
 * and the read/export success paths. Settings mutated by a test are restored in afterEach.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ screenLayouts: {}, deploymentProfile: null });
  const { writeOrgConfigCollection } = await import("../lib/scoped-config");
  writeOrgConfigCollection("self-host", "Self-host", { mode: "off", adopted: [], acknowledgedDataResponsibility: false });
});

const admin = () => adminCookie();

test("GET /setup/status and /setup/status/public return 200", async () => {
  assert.equal((await h.req("/setup/status", { cookie: admin() })).status, 200);
  assert.equal((await h.req("/setup/status/public", { cookie: admin() })).status, 200);
});

test("GET /setup/profile and /setup/idp return config (no secrets)", async () => {
  const p = await h.req("/setup/profile", { cookie: admin() });
  assert.equal(p.status, 200);
  assert.ok("hardening" in (await p.json() as object));
  assert.equal((await h.req("/setup/idp", { cookie: admin() })).status, 200);
});

test("POST /setup/profile validates the profile id", async () => {
  const bad = await h.req("/setup/profile", { method: "POST", cookie: admin(), body: { profile: "not-a-profile" } });
  assert.equal(bad.status, 400);
  const ok = await h.req("/setup/profile", { method: "POST", cookie: admin(), body: { profile: "nonprofit" } });
  assert.equal(ok.status, 200);
});

test("GET /setup/self-host returns the adoption config + resolved domain gating", async () => {
  const r = await h.req("/setup/self-host", { cookie: admin() });
  assert.equal(r.status, 200);
  const body = await r.json() as { config: { mode: string }; domains: unknown[]; holdsOnlyCopy: boolean };
  assert.equal(body.config.mode, "off");
  assert.equal(body.holdsOnlyCopy, false);
  assert.equal(body.domains.length, 9);
});

test("POST /setup/self-host refuses a non-off adoption without the data-responsibility ack (400)", async () => {
  const bad = await h.req("/setup/self-host", {
    method: "POST", cookie: admin(),
    body: { mode: "system-of-record", adopted: ["financials"], acknowledgedDataResponsibility: false },
  });
  assert.equal(bad.status, 400);
});

test("POST /setup/self-host persists an acknowledged adoption and enables its domains", async () => {
  const ok = await h.req("/setup/self-host", {
    method: "POST", cookie: admin(),
    body: { mode: "system-of-record", adopted: ["financials"], acknowledgedDataResponsibility: true },
  });
  assert.equal(ok.status, 200);
  const body = await ok.json() as { enabledDomains: string[]; holdsOnlyCopy: boolean };
  assert.ok(body.enabledDomains.includes("issues"), "core domain always on");
  assert.ok(body.enabledDomains.includes("financials"), "adopted domain on");
  assert.equal(body.holdsOnlyCopy, true);
});

test("POST /setup/charity-onboarding applies the nonprofit preset", async () => {
  const r = await h.req("/setup/charity-onboarding", { method: "POST", cookie: admin() });
  assert.equal(r.status, 200);
});

test("POST /setup/test-broker validates the URL and blocks SSRF targets", async () => {
  const bad = await h.req("/setup/test-broker", { method: "POST", cookie: admin(), body: { webhookUrl: "not-a-url" } });
  assert.equal(bad.status, 400);
  // A syntactically valid but link-local/metadata target is refused by the egress guard.
  const blocked = await h.req("/setup/test-broker", { method: "POST", cookie: admin(), body: { webhookUrl: "http://169.254.169.254/latest/meta-data/" } });
  assert.equal(blocked.status, 200);
  assert.equal((await blocked.json() as { reachable: boolean }).reachable, false);
});

test("GET /setup/export emits durable config for each format", async () => {
  for (const fmt of ["env", "compose", "k8s", "bogus"]) {
    const r = await h.req(`/setup/export?format=${fmt}`, { cookie: admin() });
    assert.equal(r.status, 200);
    assert.ok((await r.text()).length > 0);
  }
});

test("config-dir: summary, step-up-gated refresh, and clear-backup", async () => {
  assert.equal((await h.req("/setup/config-dir", { cookie: admin() })).status, 200);
  // refresh needs step-up
  assert.equal((await h.req("/setup/config-dir/refresh", { method: "POST", cookie: admin() })).status, 403);
  const refreshed = await h.req("/setup/config-dir/refresh", { method: "POST", cookie: stepUpAdminCookie() });
  assert.equal(refreshed.status, 200);
  assert.equal((await h.req("/setup/config-dir/clear-backup", { method: "POST", cookie: admin() })).status, 200);
});

test("GET /setup/config-bundle returns a zip", async () => {
  const r = await h.req("/setup/config-bundle", { cookie: admin() });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /zip/);
});

test("wiring catalogues return arrays", async () => {
  for (const p of ["/setup/backends", "/setup/backends/ids", "/setup/brokers", "/setup/brokers?connected=1", "/setup/outputs", "/setup/notifications", "/setup/notification-routes", "/setup/notification-kinds", "/setup/methodologies", "/setup/planes"]) {
    const r = await h.req(p, { cookie: admin() });
    assert.equal(r.status, 200, `${p} -> ${r.status}`);
  }
});

test("methodology pack: 404 for unknown, download for a known id", async () => {
  const missing = await h.req("/setup/methodology-pack/not-a-methodology", { cookie: admin() });
  assert.equal(missing.status, 404);
  const list = await h.req("/setup/methodologies", { cookie: admin() }).then((r) => r.json()) as { id: string }[];
  if (list.length) {
    const ok = await h.req(`/setup/methodology-pack/${list[0]!.id}`, { cookie: admin() });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-disposition") ?? "", /attachment/);
  }
});

test("views + methodology preset resolve", async () => {
  assert.equal((await h.req("/setup/views", { cookie: admin() })).status, 200);
  assert.equal((await h.req("/setup/views?methodology=agile", { cookie: admin() })).status, 200);
  assert.equal((await h.req("/setup/methodology-preset/agile", { cookie: admin() })).status, 200);
});

test("reports + screens honour the ?available=1 backend filter", async () => {
  for (const p of ["/setup/reports", "/setup/reports?available=1", "/setup/screens", "/setup/screens?available=1"]) {
    assert.equal((await h.req(p, { cookie: admin() })).status, 200, p);
  }
});

test("screen layout: open GET, manager PUT round-trips", async () => {
  assert.equal((await h.req("/setup/screens/board/layout", { cookie: admin() })).status, 200);
  const put = await h.req("/setup/screens/board/layout", { method: "PUT", cookie: admin(), body: { order: ["a", "b"], spans: { a: 6, bad: 99 }, hidden: ["c"] } });
  assert.equal(put.status, 200);
  const body = await put.json() as { layout: { order: string[]; spans: Record<string, number> } };
  assert.deepEqual(body.layout.order, ["a", "b"]);
  assert.equal(body.layout.spans.a, 6);
  assert.ok(!("bad" in body.layout.spans)); // out-of-range span dropped
});

test("GET /setup/connections returns credential names + templates", async () => {
  const r = await h.req("/setup/connections?backends=jira,asana", { cookie: admin() });
  assert.equal(r.status, 200);
  const body = await r.json() as { backends: string[]; templates: { env: string } };
  assert.deepEqual(body.backends, ["jira", "asana"]);
  assert.equal(typeof body.templates.env, "string");
});

test("connections/test + connections/vault validate their bodies", async () => {
  assert.equal((await h.req("/setup/connections/test", { method: "POST", cookie: admin(), body: {} })).status, 400);
  const test = await h.req("/setup/connections/test", { method: "POST", cookie: admin(), body: { backend: "jira" } });
  assert.equal(test.status, 200); // demo broker: returns an ok:false result, not an error status
  // Storing a vendor credential in the broker vault is a secret write → step-up required (parity with
  // PUT /ai/providers/:id/key). Without a fresh step-up it's 403 before the body is even inspected.
  assert.equal((await h.req("/setup/connections/vault", { method: "POST", cookie: admin(), body: { backend: "jira", name: "API_TOKEN", value: "secret" } })).status, 403);
  assert.equal((await h.req("/setup/connections/vault", { method: "POST", cookie: stepUpAdminCookie(), body: { backend: "jira" } })).status, 400);
  const vault = await h.req("/setup/connections/vault", { method: "POST", cookie: stepUpAdminCookie(), body: { backend: "jira", name: "API_TOKEN", value: "secret" } });
  assert.equal(vault.status, 200);
  assert.ok("stored" in (await vault.json() as object)); // the vault relay result (stored + ref)
});

test("GET /setup/entity-resolution/preview runs the reconciliation helpers", async () => {
  const r = await h.req("/setup/entity-resolution/preview", { cookie: admin() });
  assert.equal(r.status, 200);
  assert.ok("deduped" in (await r.json() as object));
});

test("POST /setup/generate-workflow: 404 unknown, licence-gate for enterprise, 200 for a standard backend", async () => {
  assert.equal((await h.req("/setup/generate-workflow", { method: "POST", cookie: admin(), body: { backendId: "no-such-backend" } })).status, 404);
  // Enterprise workflow is licence-gated: 402 when not entitled, 200 (download) when the
  // deployment carries the enterprise_workflows feature. Either way it must not error.
  const ent = await h.req("/setup/generate-workflow", { method: "POST", cookie: admin(), body: { backendId: "sap" } });
  assert.ok(ent.status === 402 || ent.status === 200, `enterprise workflow status ${ent.status}`);
  const ok = await h.req("/setup/generate-workflow", { method: "POST", cookie: admin(), body: { backendId: "jira", readOnly: true } });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-disposition") ?? "", /jira-readonly/);
});

test("POST /setup/verify-workflow requires a broker URL and blocks SSRF targets", async () => {
  const none = await h.req("/setup/verify-workflow", { method: "POST", cookie: admin(), body: {} });
  assert.equal(none.status, 400); // no broker configured + no webhookUrl
  const blocked = await h.req("/setup/verify-workflow", { method: "POST", cookie: admin(), body: { webhookUrl: "http://169.254.169.254/" } });
  assert.equal(blocked.status, 400); // egress guard refuses link-local
  // A syntactically valid, public (egress-allowed) webhook drives the probe + summary success path;
  // the actions can't actually conform against a non-broker host, but the endpoint returns 200.
  const probed = await h.req("/setup/verify-workflow", { method: "POST", cookie: admin(), body: { webhookUrl: "https://example.com/webhook", projectId: "sample" } });
  assert.equal(probed.status, 200);
  assert.ok("summary" in (await probed.json() as object));
});

test("GET /setup/snapshot downloads a JSON backup; POST /setup/restore validates it", async () => {
  const snap = await h.req("/setup/snapshot", { cookie: admin() });
  assert.equal(snap.status, 200);
  const bundle = await snap.json();
  const bad = await h.req("/setup/restore", { method: "POST", cookie: admin(), body: 12345 });
  assert.equal(bad.status, 400);
  const ok = await h.req("/setup/restore", { method: "POST", cookie: admin(), body: bundle });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json() as { restored: boolean }).restored, true);
});

test("environments + versioned rollback: reads succeed, bad inputs are 400", async () => {
  assert.equal((await h.req("/setup/environments", { cookie: admin() })).status, 200);
  assert.equal((await h.req("/setup/environments", { method: "POST", cookie: admin(), body: { name: "" } })).status, 400);
  assert.equal((await h.req("/setup/environments/activate", { method: "POST", cookie: admin(), body: { name: "no-such-env" } })).status, 400);
  assert.equal((await h.req("/setup/promote", { method: "POST", cookie: admin(), body: { from: "no-a", to: "no-b" } })).status, 400);
  assert.equal((await h.req("/setup/versions/no-such-version/known-good", { method: "POST", cookie: admin() })).status, 400);
  assert.equal((await h.req("/setup/rollback", { method: "POST", cookie: admin(), body: { versionId: "no-such-version" } })).status, 400);
  // A known-good version exists by default, so this drives the success path (rolledBack:true).
  const knownGood = await h.req("/setup/rollback", { method: "POST", cookie: admin(), body: { toKnownGood: true } });
  assert.equal(knownGood.status, 200);
  assert.equal((await knownGood.json() as { rolledBack: boolean }).rolledBack, true);
});

test("GET /setup/debug-bundle is 409 outside developer mode", async () => {
  const r = await h.req("/setup/debug-bundle", { cookie: admin() });
  assert.equal(r.status, 409);
});
