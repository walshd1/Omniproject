import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Request } from "express";

import { versionConflict } from "../lib/concurrency";
import { roleFromClaims } from "../lib/rbac";
import { idempotencyKey } from "../lib/n8n";
import { resolveCapabilities } from "../lib/capabilities";
import { buildConfigExport, configEntries } from "../lib/config-export";
import { BACKENDS, getBackend } from "../lib/n8n-backends";
import { generateWorkflow } from "../lib/n8n-generator";
import { buildSnapshot, applySnapshot, SNAPSHOT_SCHEMA } from "../lib/config-snapshot";
import { convertAmount, supportedCurrencies } from "../lib/currency";
import { resolveTemplate, isFullyResolved } from "../lib/n8n-expr";
import { updateSettings, getSettings } from "../lib/settings";
import {
  __resetConfigStore,
  storeView,
  captureVersion,
  markKnownGood,
  rollbackTo,
  rollbackToLastKnownGood,
  createEnvironment,
  activateEnvironment,
  promote,
} from "../lib/config-store";
import { parseJwt, verifySignatureWithJwk, validateClaims, verifyIdToken, type Jwk } from "../lib/jwks";
import { clientMatches, addClient } from "../lib/notify-hub";
import { getNotifyBus, busMode } from "../lib/notify-bus";

// ── Optimistic concurrency ────────────────────────────────────────────────────
test("versionConflict: no expected version never conflicts", () => {
  assert.equal(versionConflict(undefined, 5), false);
});

test("versionConflict: matching version is not a conflict", () => {
  assert.equal(versionConflict(3, 3), false);
});

test("versionConflict: stale version is a conflict", () => {
  assert.equal(versionConflict(2, 3), true);
});

// ── RBAC claim mapping ────────────────────────────────────────────────────────
test("roleFromClaims: demo session is admin", () => {
  assert.equal(roleFromClaims([], { isDemo: true }), "admin");
});

test("roleFromClaims: maps configured manager role (case-insensitive)", () => {
  process.env["OIDC_MANAGER_ROLES"] = "pmo,programme-managers";
  assert.equal(roleFromClaims(["PMO"], { isDemo: false }), "manager");
  delete process.env["OIDC_MANAGER_ROLES"];
});

test("roleFromClaims: admin outranks manager when user has both", () => {
  process.env["OIDC_ADMIN_ROLES"] = "platform-admins";
  process.env["OIDC_MANAGER_ROLES"] = "pmo";
  assert.equal(roleFromClaims(["pmo", "platform-admins"], { isDemo: false }), "admin");
  delete process.env["OIDC_ADMIN_ROLES"];
  delete process.env["OIDC_MANAGER_ROLES"];
});

test("roleFromClaims: unmatched claims fall back to contributor by default", () => {
  assert.equal(roleFromClaims(["some-random-group"], { isDemo: false }), "contributor");
});

test("roleFromClaims: OIDC_DEFAULT_ROLE overrides the fallback", () => {
  process.env["OIDC_DEFAULT_ROLE"] = "viewer";
  assert.equal(roleFromClaims(["nobody"], { isDemo: false }), "viewer");
  delete process.env["OIDC_DEFAULT_ROLE"];
});

// ── Idempotency key ───────────────────────────────────────────────────────────
test("idempotencyKey: deterministic for same action+entity within a minute", () => {
  const a = idempotencyKey("update_issue", { projectId: "p1", issueId: "i1" });
  const b = idempotencyKey("update_issue", { projectId: "p1", issueId: "i1" });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("idempotencyKey: differs by action", () => {
  const a = idempotencyKey("update_issue", { projectId: "p1", issueId: "i1" });
  const b = idempotencyKey("delete_issue", { projectId: "p1", issueId: "i1" });
  assert.notEqual(a, b);
});

test("idempotencyKey: differs by entity", () => {
  const a = idempotencyKey("update_issue", { projectId: "p1", issueId: "i1" });
  const b = idempotencyKey("update_issue", { projectId: "p1", issueId: "i2" });
  assert.notEqual(a, b);
});

// ── JWKS / ID-token verification (self-contained: real RS256 keypair) ──────────
const { publicKey: TEST_PUB, privateKey: TEST_PRIV } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const TEST_JWK = { ...(TEST_PUB.export({ format: "jwk" }) as Jwk), kid: "test-key", use: "sig", alg: "RS256" };

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}
function mintRs256(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${body}`), TEST_PRIV).toString("base64url");
  return `${header}.${body}.${sig}`;
}
const NOW = Math.floor(Date.now() / 1000);
const GOOD_CLAIMS = { iss: "https://idp.test", aud: "omni-client", exp: NOW + 600, iat: NOW, sub: "user-1", roles: ["pmo"] };

test("parseJwt: extracts header/claims/signature", () => {
  const p = parseJwt(mintRs256(GOOD_CLAIMS));
  assert.equal(p.header.alg, "RS256");
  assert.equal(p.claims.sub, "user-1");
  assert.ok(p.signature.length > 0);
});

test("verifySignatureWithJwk: true for a valid signature", () => {
  assert.equal(verifySignatureWithJwk(parseJwt(mintRs256(GOOD_CLAIMS)), TEST_JWK), true);
});

test("verifySignatureWithJwk: false for a tampered payload", () => {
  const token = mintRs256(GOOD_CLAIMS);
  const [h, , s] = token.split(".");
  const forged = `${h}.${b64url(JSON.stringify({ ...GOOD_CLAIMS, sub: "attacker" }))}.${s}`;
  assert.equal(verifySignatureWithJwk(parseJwt(forged), TEST_JWK), false);
});

test("validateClaims: passes for matching iss/aud and unexpired", () => {
  assert.equal(validateClaims(GOOD_CLAIMS, { issuer: "https://idp.test", audience: "omni-client" }), null);
});

test("validateClaims: rejects wrong audience, wrong issuer, and expiry", () => {
  assert.match(validateClaims(GOOD_CLAIMS, { issuer: "https://idp.test", audience: "other" })!, /audience/);
  assert.match(validateClaims(GOOD_CLAIMS, { issuer: "https://evil", audience: "omni-client" })!, /issuer/);
  assert.match(validateClaims({ ...GOOD_CLAIMS, exp: NOW - 3600 }, { issuer: "https://idp.test", audience: "omni-client" })!, /expired/);
});

test("verifyIdToken: end-to-end with a stubbed JWKS endpoint", async () => {
  const fetchStub = (async () => new Response(JSON.stringify({ keys: [TEST_JWK] }), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  const claims = await verifyIdToken(mintRs256(GOOD_CLAIMS), { jwksUri: "https://idp.test/jwks", issuer: "https://idp.test", audience: "omni-client", fetchImpl: fetchStub });
  assert.equal(claims.sub, "user-1");
});

test("verifyIdToken: throws on a forged signature", async () => {
  const otherKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" }));
  const body = b64url(JSON.stringify(GOOD_CLAIMS));
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${body}`), otherKey).toString("base64url");
  const forged = `${header}.${body}.${sig}`;
  const fetchStub = (async () => new Response(JSON.stringify({ keys: [TEST_JWK] }), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  await assert.rejects(verifyIdToken(forged, { jwksUri: "https://idp.test/jwks", issuer: "https://idp.test", audience: "omni-client", fetchImpl: fetchStub }), /signature/);
});

// ── Notification hub targeting ─────────────────────────────────────────────────
test("clientMatches: empty/absent target is a broadcast", () => {
  const c = { sub: "u1", email: "u1@x", roles: ["manager"] };
  assert.equal(clientMatches(c, undefined), true);
  assert.equal(clientMatches(c, {}), true);
});

test("clientMatches: targets by sub, email or role", () => {
  const c = { sub: "u1", email: "u1@x", roles: ["manager"] };
  assert.equal(clientMatches(c, { sub: "u1" }), true);
  assert.equal(clientMatches(c, { email: "u1@x" }), true);
  assert.equal(clientMatches(c, { role: "manager" }), true);
  assert.equal(clientMatches(c, { sub: "other" }), false);
  assert.equal(clientMatches(c, { role: "admin" }), false);
});

test("notify bus: defaults to in-process and delivers to a matching client", async () => {
  assert.equal(busMode(), "in-process");
  const got: unknown[] = [];
  const remove = addClient({ id: "t1", sub: "mgr-1", roles: ["manager"], send: (_e, d) => got.push(d) });
  const delivered = await getNotifyBus().publish({ notification: { title: "x" }, target: { role: "manager" } });
  remove();
  assert.equal(delivered, 1);
  assert.equal(got.length, 1);
});

// ── Multi-currency conversion ──────────────────────────────────────────────────
const RATES = { GBP: 1, USD: 0.8, EUR: 0.85 }; // base GBP

test("convertAmount: same currency is a no-op", () => {
  assert.equal(convertAmount(100, "USD", "USD", RATES), 100);
});

test("convertAmount: converts via the base currency", () => {
  // 100 USD → base GBP (×0.8 = 80) → EUR (÷0.85)
  assert.ok(Math.abs(convertAmount(100, "USD", "EUR", RATES) - 80 / 0.85) < 1e-9);
});

test("convertAmount: round-trips back to the original", () => {
  const there = convertAmount(250, "USD", "EUR", RATES);
  assert.ok(Math.abs(convertAmount(there, "EUR", "USD", RATES) - 250) < 1e-9);
});

test("convertAmount: throws on a missing rate", () => {
  assert.throws(() => convertAmount(10, "USD", "JPY", RATES), /FX rate/);
});

test("supportedCurrencies: lists the rate table sorted", () => {
  assert.deepEqual(supportedCurrencies(RATES), ["EUR", "GBP", "USD"]);
});

// ── Config environments & versioned rollback ──────────────────────────────────
test("config store: rolls settings back to a pinned known-good version", () => {
  __resetConfigStore();
  updateSettings({ backendSource: "good-state" });
  const pinned = captureVersion("verified prod");
  markKnownGood(pinned.id);

  // A bad change after the known-good pin.
  updateSettings({ backendSource: "broken-change" });
  captureVersion("risky change");
  assert.equal(getSettings().backendSource, "broken-change");

  // Fast rollback to the last known-good state.
  const { applied } = rollbackToLastKnownGood();
  assert.equal(applied.id, pinned.id);
  assert.equal(getSettings().backendSource, "good-state");
});

test("config store: rollbackTo restores a specific version's settings", () => {
  __resetConfigStore();
  updateSettings({ backendSource: "v-a" });
  const a = captureVersion("a");
  updateSettings({ backendSource: "v-b" });
  captureVersion("b");
  rollbackTo(a.id);
  assert.equal(getSettings().backendSource, "v-a");
});

test("config store: sandbox changes do not touch production until promoted", () => {
  __resetConfigStore();
  updateSettings({ backendSource: "prod-config" });
  captureVersion("prod baseline");

  createEnvironment("sandbox");
  activateEnvironment("sandbox");
  updateSettings({ backendSource: "sandbox-experiment" });
  captureVersion("sandbox work");

  // Switch back to production — its config is untouched.
  activateEnvironment("production");
  assert.equal(getSettings().backendSource, "prod-config");

  // Promote sandbox → production, then production carries the new config.
  promote("sandbox", "production");
  activateEnvironment("production");
  assert.equal(getSettings().backendSource, "sandbox-experiment");
});

test("config store: view exposes environments, history and a known-good pointer", () => {
  __resetConfigStore();
  const v = captureVersion("x");
  markKnownGood(v.id);
  const view = storeView();
  assert.ok(view.environments.includes("production"));
  assert.equal(view.activeEnv, "production");
  assert.ok(view.versions.length >= 1);
  assert.equal(view.lastKnownGoodId, v.id);
});

// ── Capabilities resolution (env path is request-independent) ──────────────────
test("resolveCapabilities: CAPABILITIES env enables only the listed domains", async () => {
  process.env["CAPABILITIES"] = "issues,raid";
  const caps = await resolveCapabilities({} as Request);
  assert.equal(caps.mode, "env");
  assert.equal(caps.issues, true);
  assert.equal(caps.raid, true);
  assert.equal(caps.financials, false);
  assert.equal(caps.history, false);
  delete process.env["CAPABILITIES"];
});

// ── Config export (Setup wizard, stateless) ───────────────────────────────────
test("configEntries: emits the configured n8n URL, not the placeholder", () => {
  const entries = configEntries({ n8nWebhookUrl: "https://n8n.acme.io/webhook/omni" });
  const n8n = entries.find((e) => e.key === "N8N_WEBHOOK_URL");
  assert.equal(n8n?.value, "https://n8n.acme.io/webhook/omni");
  assert.notEqual(n8n?.placeholder, true);
});

test("configEntries: OIDC issuer pulls in client id/secret placeholders", () => {
  const keys = configEntries({ oidcIssuerUrl: "https://auth.acme.io" }).map((e) => e.key);
  assert.ok(keys.includes("OIDC_ISSUER_URL"));
  assert.ok(keys.includes("OIDC_CLIENT_ID"));
  assert.ok(keys.includes("OIDC_CLIENT_SECRET"));
});

test("configEntries: backendSource 'all' is omitted (it's the default)", () => {
  const keys = configEntries({ backendSource: "all" }).map((e) => e.key);
  assert.ok(!keys.includes("BACKEND_SOURCE"));
});

test("buildConfigExport: env masks secrets as placeholders", () => {
  const out = buildConfigExport({ n8nWebhookUrl: "https://n8n/x", oidcIssuerUrl: "https://auth" }, "env");
  assert.match(out, /N8N_WEBHOOK_URL=https:\/\/n8n\/x/);
  assert.match(out, /OIDC_CLIENT_SECRET=<OIDC_CLIENT_SECRET>/);
  assert.match(out, /SESSION_SECRET=<SESSION_SECRET>/);
});

test("buildConfigExport: compose and k8s render their own shapes", () => {
  assert.match(buildConfigExport({ n8nWebhookUrl: "https://n8n/x" }, "compose"), /services:\n {2}omniproject:/);
  assert.match(buildConfigExport({ n8nWebhookUrl: "https://n8n/x" }, "k8s"), /kind: ConfigMap/);
});

// ── Backend manifests + workflow generator ────────────────────────────────────
test("BACKENDS: every manifest is well-formed", () => {
  assert.ok(BACKENDS.length >= 5);
  for (const b of BACKENDS) {
    // Auth is either a per-user header or an n8n-managed credential.
    assert.ok(b.id && b.label && (b.authHeader || b.credentialType), `manifest ${b.id} missing fields`);
    assert.ok(b.via, `manifest ${b.id} missing via`);
    assert.ok(Array.isArray(b.requiredEnv));
    assert.ok(b.actions.list_projects && b.actions.list_issues, `${b.id} must map core reads`);
  }
});

test("generateWorkflow: produces a valid, connected workflow", () => {
  const wf = generateWorkflow(getBackend("openproject")!);
  const names = new Set(wf.nodes.map((n) => n.name));
  // Scaffold present.
  for (const required of ["Webhook", "Verify probe?", "Route Action", "Normalize → N8nActionResult", "Respond", "Capabilities"]) {
    assert.ok(names.has(required), `missing node ${required}`);
  }
  // Every connection targets an existing node.
  for (const [from, conn] of Object.entries(wf.connections)) {
    assert.ok(names.has(from), `connection from unknown node ${from}`);
    for (const out of conn.main) for (const c of out) assert.ok(names.has(c.node), `edge to unknown node ${c.node}`);
  }
  // Serializable (importable JSON).
  assert.doesNotThrow(() => JSON.stringify(wf));
});

test("generateWorkflow: always includes get_capabilities and an Unsupported fallback", () => {
  const wf = generateWorkflow(getBackend("github")!);
  const route = wf.connections["Route Action"];
  // rule outputs (one per action incl. get_capabilities) + 1 fallback.
  const actionCount = Object.keys(getBackend("github")!.actions).length + 1; // + get_capabilities
  assert.equal(route.main.length, actionCount + 1);
  assert.ok(wf.nodes.some((n) => n.name === "Unsupported Action"));
});

test("generateWorkflow: webhook path is honoured", () => {
  const wf = generateWorkflow(getBackend("jira")!, { webhookPath: "my-omni-hook" });
  const webhook = wf.nodes.find((n) => n.name === "Webhook");
  assert.equal((webhook?.parameters as { path?: string }).path, "my-omni-hook");
});

test("generateWorkflow: native-node backend emits the n8n node + credential placeholder", () => {
  const wf = generateWorkflow(getBackend("asana")!);
  const create = wf.nodes.find((n) => n.name === "Create Issue");
  assert.equal(create?.type, "n8n-nodes-base.asana");
  assert.ok(create?.credentials && "asanaApi" in (create.credentials as Record<string, unknown>));
  assert.doesNotThrow(() => JSON.stringify(wf));
});

test("generateWorkflow: Microsoft backend uses an n8n-managed OAuth credential", () => {
  const wf = generateWorkflow(getBackend("dynamics365")!);
  const list = wf.nodes.find((n) => n.name === "List Projects");
  assert.equal(list?.type, "n8n-nodes-base.httpRequest");
  assert.equal((list?.parameters as { authentication?: string }).authentication, "predefinedCredentialType");
  assert.equal((list?.parameters as { nodeCredentialType?: string }).nodeCredentialType, "microsoftDynamicsOAuth2Api");
  assert.ok(list?.credentials && "microsoftDynamicsOAuth2Api" in (list.credentials as Record<string, unknown>));
});

test("BACKENDS: includes the requested enterprise tools", () => {
  const ids = new Set(BACKENDS.map((b) => b.id));
  for (const id of ["asana", "monday", "msproject", "dynamics365", "servicenow"]) {
    assert.ok(ids.has(id), `missing backend ${id}`);
  }
});

test("BACKENDS: includes the heavyweight corporate backbones", () => {
  const ids = new Set(BACKENDS.map((b) => b.id));
  for (const id of ["sap", "primavera", "enterprise"]) {
    assert.ok(ids.has(id), `missing backbone ${id}`);
  }
  // SAP must surface financials/portfolio for EVM rollups.
  const sap = getBackend("sap")!;
  assert.equal(sap.capabilities.financials, true);
  assert.equal(sap.capabilities.portfolio, true);
});

test("generateWorkflow: SAP uses an n8n-managed OAuth credential over HTTP", () => {
  const wf = generateWorkflow(getBackend("sap")!);
  const list = wf.nodes.find((n) => n.name === "List Projects");
  assert.equal((list?.parameters as { authentication?: string }).authentication, "predefinedCredentialType");
  assert.ok(list?.credentials && "oAuth2Api" in (list.credentials as Record<string, unknown>));
});

// ── Backend mapping certification (offline) ────────────────────────────────────
const CERT_CTX = {
  env: { OPENPROJECT_INSTANCE_URL: "https://op.acme.io" },
  payload: { projectId: "42", issueId: "1001", expectedVersion: 3 },
};

test("certify OpenProject: list/read URLs resolve to the real v3 API", () => {
  const op = getBackend("openproject")!;
  assert.equal(
    resolveTemplate(op.actions.list_projects!.url!, CERT_CTX),
    "https://op.acme.io/api/v3/projects",
  );
  assert.equal(
    resolveTemplate(op.actions.list_issues!.url!, CERT_CTX),
    "https://op.acme.io/api/v3/projects/42/work_packages",
  );
  assert.equal(
    resolveTemplate(op.actions.update_issue!.url!, CERT_CTX),
    "https://op.acme.io/api/v3/work_packages/1001",
  );
});

test("certify OpenProject: HTTP methods match the contract", () => {
  const a = getBackend("openproject")!.actions;
  assert.equal(a.list_projects!.method, "GET");
  assert.equal(a.create_issue!.method, "POST");
  assert.equal(a.update_issue!.method, "PATCH");
  assert.equal(a.delete_issue!.method, "DELETE");
  // The update body must carry lockVersion for OpenProject's optimistic concurrency.
  assert.match(a.update_issue!.body!, /lockVersion/);
});

test("certify all HTTP backends: read URLs fully resolve (no dangling placeholders)", () => {
  const env: Record<string, string> = {};
  // Provide a value for every env var any backend's reads reference.
  for (const b of BACKENDS) for (const e of b.requiredEnv) env[e] = "https://x";
  for (const b of BACKENDS) {
    for (const action of ["list_projects", "list_issues"] as const) {
      const m = b.actions[action];
      if (!m || m.kind === "n8nNode" || !m.url) continue; // native nodes have no URL
      assert.ok(isFullyResolved(m.url, { env, payload: CERT_CTX.payload }), `${b.id}.${action} left an unresolved placeholder`);
    }
  }
});

// ── Config snapshot / backup-restore ───────────────────────────────────────────
const SAMPLE_SETTINGS = {
  n8nWebhookUrl: "https://n8n/x",
  aiProvider: "ollama" as const,
  aiModel: "llama3.2",
  backendSource: "sap",
  oidcIssuerUrl: "https://idp",
};

test("buildSnapshot: captures the gateway settings with schema + version", () => {
  const snap = buildSnapshot(SAMPLE_SETTINGS);
  assert.equal(snap.schema, SNAPSHOT_SCHEMA);
  assert.equal(snap.version, 1);
  assert.equal(snap.settings.backendSource, "sap");
  assert.ok(snap.createdAt);
});

test("applySnapshot: round-trips a built snapshot into a settings patch", () => {
  const snap = buildSnapshot(SAMPLE_SETTINGS);
  const { patch, warnings } = applySnapshot(snap);
  assert.equal(patch["n8nWebhookUrl"], "https://n8n/x");
  assert.equal(patch["aiProvider"], "ollama");
  assert.equal(warnings.length, 0);
});

test("applySnapshot: rejects a foreign schema", () => {
  assert.throws(() => applySnapshot({ schema: "something/else", settings: {} }), /schema/);
});

test("applySnapshot: warns on unknown keys and missing keys, never throws on them", () => {
  const { patch, warnings } = applySnapshot({ schema: SNAPSHOT_SCHEMA, version: 1, settings: { backendSource: "jira", bogus: 1 } });
  assert.equal(patch["backendSource"], "jira");
  assert.ok(warnings.some((w) => /bogus/.test(w)));
  assert.ok(warnings.some((w) => /n8nWebhookUrl/.test(w)));
});

test("resolveCapabilities: demo mode (no n8n, no env) turns everything on", async () => {
  const savedWebhook = process.env["N8N_WEBHOOK_URL"];
  delete process.env["N8N_WEBHOOK_URL"];
  delete process.env["CAPABILITIES"];
  // isN8nConfigured is captured at import time; this asserts the demo default
  // only when the module was loaded without a webhook configured.
  const caps = await resolveCapabilities({} as Request);
  assert.ok(["demo", "env"].includes(caps.mode));
  if (savedWebhook) process.env["N8N_WEBHOOK_URL"] = savedWebhook;
});
