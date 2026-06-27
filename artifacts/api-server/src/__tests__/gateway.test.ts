import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Request } from "express";

import { versionConflict } from "../lib/concurrency";
import { roleFromClaims } from "../lib/rbac";
import { idempotencyKey } from "../broker/n8n";
import { resolveCapabilities } from "../lib/capabilities";
import { buildConfigExport, configEntries } from "../lib/config-export";
import { BACKENDS, getBackend, isEnterpriseBackend, backendCatalogue, generateWorkflow } from "@workspace/backend-catalogue";
import { buildSnapshot, applySnapshot, SNAPSHOT_SCHEMA } from "../lib/config-snapshot";
import { convertAmount, supportedCurrencies } from "../lib/currency";
import { shouldAudit, createHttpSink } from "../lib/audit";
import { saveState, loadState } from "../lib/dev-persist";
import { toMarkdown } from "../lib/md";
import { buildPdf } from "../lib/pdf";
import { buildZip } from "../lib/zip";
import { formatPrometheus } from "../lib/metrics";
import { groupProgrammes, programmeDetail, standaloneCount, aggregateFinancials } from "../lib/programmes";
import { applyODataQuery, buildEdmx, type EntityModel } from "../lib/odata";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
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
import { signLicense, verifyLicense, resolveLicense, isEntitled, type LicensePayload } from "../lib/license";
import { sanitizeBranding, effectiveBranding, DEFAULT_BRANDING } from "../lib/branding";
import { sanitizeLabels } from "../lib/labels";
import { signBody, createWebhook, redact, deliverWebhooks } from "../lib/webhooks";

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

test("roleFromClaims: maps the configured PMO role (between manager and admin)", () => {
  process.env["OIDC_PMO_ROLES"] = "programme-managers";
  assert.equal(roleFromClaims(["Programme-Managers"], { isDemo: false }), "pmo");
  delete process.env["OIDC_PMO_ROLES"];
});

test("roleFromClaims: admin outranks pmo; pmo outranks manager", () => {
  process.env["OIDC_ADMIN_ROLES"] = "platform-admins";
  process.env["OIDC_PMO_ROLES"] = "programme-managers";
  process.env["OIDC_MANAGER_ROLES"] = "delivery-leads";
  // Holding both PMO and admin → admin (the superset; one person can hold both).
  assert.equal(roleFromClaims(["programme-managers", "platform-admins"], { isDemo: false }), "admin");
  // Holding both PMO and manager → pmo (the higher of the two).
  assert.equal(roleFromClaims(["programme-managers", "delivery-leads"], { isDemo: false }), "pmo");
  delete process.env["OIDC_ADMIN_ROLES"];
  delete process.env["OIDC_PMO_ROLES"];
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

// ── Action audit logging ───────────────────────────────────────────────────────
test("shouldAudit: off records nothing, all records everything", () => {
  assert.equal(shouldAudit("off", { category: "request", method: "POST" }), false);
  assert.equal(shouldAudit("all", { category: "request", method: "GET" }), true);
  assert.equal(shouldAudit("all", { category: "broker" }), true);
});

test("shouldAudit: writes records mutations + auth/admin, not reads", () => {
  assert.equal(shouldAudit("writes", { category: "request", method: "GET" }), false);
  assert.equal(shouldAudit("writes", { category: "request", method: "DELETE" }), true);
  assert.equal(shouldAudit("writes", { category: "request", method: "GET", write: true }), true);
  assert.equal(shouldAudit("writes", { category: "auth", method: "GET" }), true);
  assert.equal(shouldAudit("writes", { category: "admin" }), true);
  assert.equal(shouldAudit("writes", { category: "broker", write: false }), false);
});

test("audit HTTP sink: batches NDJSON to the logging server", async () => {
  const calls: Array<{ url: string; body: string; auth?: string }> = [];
  const fetchStub = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body), auth: (init.headers as Record<string, string>)?.["Authorization"] });
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;

  const sink = createHttpSink({ url: "https://logs.acme.io/ingest", token: "secret", batch: 100, fetchImpl: fetchStub });
  sink.enqueue({ ts: "t", category: "request", action: "GET /api/projects" });
  sink.enqueue({ ts: "t", category: "broker", action: "create_issue", write: true });
  assert.equal(sink.size(), 2);

  const delivered = await sink.flush();
  assert.equal(delivered, 2);
  assert.equal(sink.size(), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].auth, "Bearer secret");
  // NDJSON: one JSON object per line.
  assert.equal(calls[0].body.split("\n").length, 2);
  assert.match(calls[0].body, /create_issue/);
});

test("audit HTTP sink: a failed flush re-buffers and never throws", async () => {
  const fetchStub = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  const sink = createHttpSink({ url: "https://logs.acme.io", batch: 100, fetchImpl: fetchStub });
  sink.enqueue({ ts: "t", category: "request", action: "GET /x" });
  const delivered = await sink.flush();
  assert.equal(delivered, 0);
  assert.equal(sink.size(), 1); // re-buffered for the next attempt
});

// ── Report export writers (md / pdf) ───────────────────────────────────────────
test("toMarkdown: emits a GFM table with a header separator and escapes pipes", () => {
  const md = toMarkdown("Report", ["id", "title"], [["i1", "a | b"], ["i2", null]]);
  assert.match(md, /# Report/);
  assert.match(md, /\| id \| title \|/);
  assert.match(md, /\| --- \| --- \|/);
  assert.match(md, /a \\\| b/); // pipe escaped
  assert.match(md, /\| i2 \|  \|/); // null → empty cell
});

test("buildPdf: produces a valid, paginated PDF", () => {
  const rows = Array.from({ length: 150 }, (_, i) => [`id-${i}`, `Item ${i}`, "open"]);
  const pdf = buildPdf({ title: "Issues", headers: ["id", "title", "status"], rows });
  const text = pdf.toString("binary");
  assert.ok(pdf.subarray(0, 5).toString() === "%PDF-", "starts with the PDF magic");
  assert.match(text, /%%EOF$/);
  assert.match(text, /\/Type \/Catalog/);
  assert.match(text, /startxref/);
  // 150 rows + header/sep + title → more than one page.
  assert.ok((text.match(/\/Type \/Page\b/g) ?? []).length >= 2, "paginates large tables");
});

test("buildZip: produces a valid STORED zip containing the entries", () => {
  const zip = buildZip([
    { name: "config.json", data: Buffer.from('{"a":1}') },
    { name: "demo-state.json", data: Buffer.from("[]") },
  ]);
  assert.equal(zip.subarray(0, 2).toString(), "PK"); // local file header magic
  assert.ok(zip.includes(Buffer.from("config.json")));
  assert.ok(zip.includes(Buffer.from("demo-state.json")));
  assert.ok(zip.includes(Buffer.from('{"a":1}')));
  // End-of-central-directory record present.
  assert.ok(zip.subarray(-22).readUInt32LE(0) === 0x06054b50);
});

// ── Programmes (derived grouping of projects) ──────────────────────────────────
const PROG_PROJECTS = [
  { id: "p1", programmeId: "prog-a", programmeName: "Alpha", issueCount: 10, completedCount: 8, updatedAt: "2026-06-01" },
  { id: "p2", programmeId: "prog-a", programmeName: "Alpha", issueCount: 10, completedCount: 4, updatedAt: "2026-06-03" },
  { id: "p3", programmeId: "prog-b", programmeName: "Beta", issueCount: 4, completedCount: 0, updatedAt: "2026-06-02" },
  { id: "p4", programmeId: null, issueCount: 5, completedCount: 5, updatedAt: "2026-06-04" }, // standalone
];

test("groupProgrammes: groups by programmeId and rolls up stats", () => {
  const progs = groupProgrammes(PROG_PROJECTS);
  assert.equal(progs.length, 2); // standalone p4 excluded
  const a = progs.find((p) => p.id === "prog-a")!;
  assert.equal(a.name, "Alpha");
  assert.equal(a.projectCount, 2);
  assert.equal(a.issueCount, 20);
  assert.equal(a.completedCount, 12);
  assert.equal(a.completionRate, 60);
  assert.equal(a.ragStatus, "GREEN");
  assert.equal(a.updatedAt, "2026-06-03"); // latest of the members
});

test("groupProgrammes: a programme is RED when little is complete", () => {
  const b = groupProgrammes(PROG_PROJECTS).find((p) => p.id === "prog-b")!;
  assert.equal(b.completionRate, 0);
  assert.equal(b.ragStatus, "RED");
});

test("invariant: a derived programme always has >= 1 project; standalone are separate", () => {
  for (const p of groupProgrammes(PROG_PROJECTS)) assert.ok(p.projectCount >= 1);
  assert.equal(standaloneCount(PROG_PROJECTS), 1);
});

test("programmeDetail: returns the member projects, or null for an unknown id", () => {
  const d = programmeDetail(PROG_PROJECTS, "prog-a");
  assert.ok(d);
  assert.equal(d!.projects.length, 2);
  assert.equal(programmeDetail(PROG_PROJECTS, "nope"), null);
});

test("programme rollup: financials are null when no member carries them", () => {
  // PROG_PROJECTS has no budget/actualCost → financials stays hidden.
  for (const p of groupProgrammes(PROG_PROJECTS)) assert.equal(p.financials, null);
});

test("aggregateFinancials: sums budgets/actuals, derives CPI, variance and health", () => {
  const fin = aggregateFinancials([
    { id: "a", currency: "GBP", budget: 100000, actualCost: 80000, earnedValue: 90000, committed: 5000 },
    { id: "b", currency: "GBP", budget: 60000, actualCost: 50000, earnedValue: 48000, committed: 3000 },
    { id: "c", title: "no financials here" }, // contributes nothing
  ])!;
  assert.ok(fin);
  assert.equal(fin.currency, "GBP");
  assert.equal(fin.budget, 160000);
  assert.equal(fin.actualCost, 130000);
  assert.equal(fin.earnedValue, 138000);
  assert.equal(fin.committed, 8000);
  assert.equal(fin.cpi, Math.round((138000 / 130000) * 100) / 100); // 1.06
  assert.equal(fin.variance, 30000);
  assert.equal(fin.variancePct, 19);
  assert.equal(fin.projectsCounted, 2);
  assert.equal(fin.health, "GREEN"); // CPI ≥ 1
});

test("aggregateFinancials: earnedValue/committed roll up only when EVERY project reports them", () => {
  const fin = aggregateFinancials([
    { id: "a", currency: "GBP", budget: 100000, actualCost: 95000, earnedValue: 80000 },
    { id: "b", currency: "GBP", budget: 50000, actualCost: 40000 }, // no earnedValue/committed
  ])!;
  assert.equal(fin.earnedValue, null, "partial EV is not presented as complete");
  assert.equal(fin.committed, null);
  assert.equal(fin.cpi, null); // can't compute CPI without complete EV
  assert.equal(fin.health, "AMBER"); // spend ratio 135k/150k = 0.9 → AMBER
  // …but the per-metric coverage is reported so the UI can show "1 of 2".
  assert.deepEqual(fin.reporting, { total: 2, costed: 2, earnedValue: 1, committed: 0 });
});

test("aggregateFinancials: reporting.total counts ALL members incl. non-costed", () => {
  const fin = aggregateFinancials([
    { id: "a", budget: 100000, actualCost: 80000, earnedValue: 90000, committed: 5000 },
    { id: "b" }, // no financials at all → not costed, but still a member
  ])!;
  assert.equal(fin.reporting.total, 2);
  assert.equal(fin.reporting.costed, 1);
  assert.equal(fin.reporting.earnedValue, 1);
});

test("aggregateFinancials: null when no project carries any financial figure", () => {
  assert.equal(aggregateFinancials([{ id: "a" }, { id: "b", title: "x" }]), null);
});

test("aggregateFinancials: over-budget burn is RED", () => {
  const fin = aggregateFinancials([{ id: "a", budget: 100000, actualCost: 130000 }])!;
  assert.equal(fin.health, "RED");
  assert.equal(fin.variance, -30000);
});

// ── OData service (SAP / Dynamics / Power BI feed) ─────────────────────────────
const ODATA_ROWS = [
  { id: "1", name: "Alpha", source: "plane", issueCount: 10 },
  { id: "2", name: "Beta", source: "openproject", issueCount: 5 },
  { id: "3", name: "Gamma", source: "plane", issueCount: 20 },
];

test("applyODataQuery: $filter eq, $orderby, $top/$skip, $select, $count", () => {
  const filtered = applyODataQuery(ODATA_ROWS, { $filter: "source eq 'plane'" });
  assert.equal(filtered.rows.length, 2);

  const ordered = applyODataQuery(ODATA_ROWS, { $orderby: "issueCount desc" });
  assert.deepEqual(ordered.rows.map((r) => r.id), ["3", "1", "2"]);

  const paged = applyODataQuery(ODATA_ROWS, { $skip: "1", $top: "1" });
  assert.deepEqual(paged.rows.map((r) => r.id), ["2"]);

  const selected = applyODataQuery(ODATA_ROWS, { $select: "id,name" });
  assert.deepEqual(Object.keys(selected.rows[0]), ["id", "name"]);

  const counted = applyODataQuery(ODATA_ROWS, { $filter: "source eq 'plane'", $count: "true" });
  assert.equal(counted.count, 2);
});

test("applyODataQuery: contains() filter matches substrings (case-insensitive)", () => {
  const r = applyODataQuery(ODATA_ROWS, { $filter: "contains(name,'ET')" });
  assert.deepEqual(r.rows.map((x) => x.id), ["2"]); // Beta
});

test("buildEdmx: emits EDMX with entity types and sets", () => {
  const entities: EntityModel[] = [{ name: "Project", set: "Projects", key: "id", props: { id: "Edm.String", issueCount: "Edm.Int32" } }];
  const xml = buildEdmx(entities);
  assert.match(xml, /<edmx:Edmx Version="4.0"/);
  assert.match(xml, /<EntityType Name="Project">/);
  assert.match(xml, /<EntitySet Name="Projects" EntityType="OmniProject.Project"\/>/);
  assert.match(xml, /<Property Name="issueCount" Type="Edm.Int32"\/>/);
});

// ── Prometheus metrics (Grafana) ────────────────────────────────────────────────
test("formatPrometheus: emits HELP/TYPE and labelled samples", () => {
  const out = formatPrometheus([
    { name: "omniproject_projects_total", help: "Number of projects", type: "gauge", samples: [{ value: 4 }] },
    { name: "omniproject_portfolio_rag", help: "Projects by RAG", type: "gauge", samples: [{ value: 2, labels: { status: "GREEN" } }] },
  ]);
  assert.match(out, /# HELP omniproject_projects_total Number of projects/);
  assert.match(out, /# TYPE omniproject_projects_total gauge/);
  assert.match(out, /omniproject_projects_total 4/);
  assert.match(out, /omniproject_portfolio_rag\{status="GREEN"\} 2/);
});

test("formatPrometheus: escapes quotes/backslashes in label values", () => {
  const out = formatPrometheus([{ name: "m", help: "h", type: "gauge", samples: [{ value: 1, labels: { name: 'a "b" \\c' } }] }]);
  assert.match(out, /name="a \\"b\\" \\\\c"/);
});

// ── Stateful dev mode (persist/load) ───────────────────────────────────────────
test("dev-persist: save then load round-trips the demo dataset", () => {
  const file = path.join(os.tmpdir(), `omni-dev-${process.pid}.json`);
  const state = { projects: [{ id: "p1" }], issues: { p1: [{ id: "i1" }] }, raid: { p1: [{ id: "r1" }] } };
  saveState(file, state);
  const loaded = loadState(file);
  fs.rmSync(file, { force: true });
  assert.deepEqual(loaded, state);
});

test("dev-persist: load returns null for a missing or malformed file", () => {
  assert.equal(loadState(path.join(os.tmpdir(), "omni-does-not-exist.json")), null);
  const bad = path.join(os.tmpdir(), `omni-bad-${process.pid}.json`);
  fs.writeFileSync(bad, "{ not json");
  assert.equal(loadState(bad), null);
  fs.rmSync(bad, { force: true });
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
test("configEntries: emits the configured broker URL, not the placeholder", () => {
  const entries = configEntries({ brokerUrl: "https://n8n.acme.io/webhook/omni" });
  const broker = entries.find((e) => e.key === "BROKER_URL");
  assert.equal(broker?.value, "https://n8n.acme.io/webhook/omni");
  assert.notEqual(broker?.placeholder, true);
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
  const out = buildConfigExport({ brokerUrl: "https://n8n/x", oidcIssuerUrl: "https://auth" }, "env");
  assert.match(out, /BROKER_URL=https:\/\/n8n\/x/);
  assert.match(out, /OIDC_CLIENT_SECRET=<OIDC_CLIENT_SECRET>/);
  assert.match(out, /SESSION_SECRET=<SESSION_SECRET>/);
});

test("buildConfigExport: compose and k8s render their own shapes", () => {
  assert.match(buildConfigExport({ brokerUrl: "https://n8n/x" }, "compose"), /services:\n {2}omniproject:/);
  assert.match(buildConfigExport({ brokerUrl: "https://n8n/x" }, "k8s"), /kind: ConfigMap/);
});

// ── Backend manifests + workflow generator ────────────────────────────────────
test("BACKENDS: every manifest is well-formed", () => {
  assert.ok(BACKENDS.length >= 5);
  for (const b of BACKENDS) {
    assert.ok(b.id && b.label, `manifest ${b.id} missing fields`);
    assert.ok(b.via, `manifest ${b.id} missing via`);
    assert.ok(Array.isArray(b.requiredEnv));
    // An "import" source (Excel/CSV) feeds /api/import, not a live broker — it
    // carries no auth + no contract read actions. Live/database backends must.
    if (b.kind === "import") continue;
    assert.ok(b.authHeader || b.credentialType, `manifest ${b.id} missing auth`);
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
  brokerUrl: "https://n8n/x",
  aiProvider: "ollama" as const,
  aiModel: "llama3.2",
  backendSource: "sap",
  oidcIssuerUrl: "https://idp",
  branding: null,
  labelOverrides: {},
  webhooks: [],
  loggingSync: { enabled: false, url: null, acknowledgedWarranty: false },
  fieldOverrides: { fields: {}, entities: {} },
};

test("redactSettingsForRead: masks webhook signing secrets (never leaked over GET)", async () => {
  const { redactSettingsForRead } = await import("../lib/settings");
  const redacted = redactSettingsForRead({
    ...SAMPLE_SETTINGS,
    webhooks: [{ id: "w1", url: "https://hook.example/x", secret: "super-secret", events: ["*"], active: true }],
  });
  assert.equal(redacted.webhooks[0]!.secret, "********");
  assert.equal(redacted.webhooks[0]!.url, "https://hook.example/x"); // non-secret fields preserved
});

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
  assert.equal(patch["brokerUrl"], "https://n8n/x");
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
  assert.ok(warnings.some((w) => /brokerUrl/.test(w)));
});

test("resolveCapabilities: demo mode (no broker, no env) turns everything on", async () => {
  const savedWebhook = process.env["BROKER_URL"];
  delete process.env["BROKER_URL"];
  delete process.env["CAPABILITIES"];
  // The broker is selected at import time; this asserts the demo default only
  // when the module was loaded without a broker configured.
  const caps = await resolveCapabilities({} as Request);
  assert.ok(["demo", "env"].includes(caps.mode));
  if (savedWebhook) process.env["BROKER_URL"] = savedWebhook;
});

test("resolveCapabilities: admin fieldOverrides replace the derived map", async () => {
  const { updateSettings } = await import("../lib/settings");
  delete process.env["CAPABILITIES"];
  try {
    // Demo turns storyPoints on; an admin override forces it off, and forces a
    // normally-opt-in entity (account) on.
    updateSettings({ fieldOverrides: {
      fields: { storyPoints: { surface: false, store: false } },
      entities: { account: { surface: true, store: true } },
    } });
    const caps = await resolveCapabilities({} as Request);
    assert.equal(caps.fields["storyPoints"]?.surface, false, "override hides storyPoints");
    assert.equal(caps.entities["account"]?.surface, true, "override surfaces account");
    // A field NOT overridden is untouched.
    assert.equal(caps.fields["title"]?.surface, true);
  } finally {
    updateSettings({ fieldOverrides: { fields: {}, entities: {} } });
  }
});

test("settings: fieldOverrides must be {surface, store} booleans", async () => {
  const { updateSettings, SettingsValidationError } = await import("../lib/settings");
  assert.throws(
    () => updateSettings({ fieldOverrides: { fields: { x: { surface: "yes" } } } }),
    (e: unknown) => e instanceof SettingsValidationError,
  );
});

// ── Licensing / entitlements ────────────────────────────────────────────────────
const LIC_KP = crypto.generateKeyPairSync("ed25519");
const LIC_PRIV = LIC_KP.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const LIC_PUB = LIC_KP.publicKey.export({ type: "spki", format: "pem" }).toString();

function licensePayload(over: Partial<LicensePayload> = {}): LicensePayload {
  return { customer: "Acme", tier: "enterprise", features: ["branding", "labels", "webhooks"], iat: 1_700_000_000, ...over };
}

test("license: sign + verify round-trips a valid licence", () => {
  const token = signLicense(licensePayload({ exp: 4_102_444_800 }), LIC_PRIV); // exp ~2100
  const r = verifyLicense(token, LIC_PUB, 1_700_000_000_000);
  assert.equal(r.valid, true);
  assert.equal(r.payload?.customer, "Acme");
  assert.deepEqual(r.payload?.features, ["branding", "labels", "webhooks"]);
});

test("license: expired licence is rejected", () => {
  const token = signLicense(licensePayload({ exp: 1_600_000_000 }), LIC_PRIV);
  const r = verifyLicense(token, LIC_PUB, 1_700_000_000_000);
  assert.equal(r.valid, false);
  assert.match(r.reason ?? "", /expired/);
});

test("license: tampered payload fails signature check", () => {
  const token = signLicense(licensePayload(), LIC_PRIV);
  const parts = token.split(".");
  const forged = JSON.stringify(licensePayload({ tier: "stolen" }));
  parts[2] = Buffer.from(forged, "utf8").toString("base64url");
  const r = verifyLicense(parts.join("."), LIC_PUB, 1_700_000_000_000);
  assert.equal(r.valid, false);
  assert.match(r.reason ?? "", /signature/);
});

test("license: malformed token is rejected, not thrown", () => {
  assert.equal(verifyLicense("not-a-token", LIC_PUB).valid, false);
});

test("license: pre-community default grants every premium feature (enforcement dormant)", () => {
  const saved = process.env["PREMIUM_ENFORCEMENT"];
  try {
    delete process.env["PREMIUM_ENFORCEMENT"]; // default = free
    const status = resolveLicense();
    assert.equal(status.valid, true);
    assert.equal(status.source, "pre-community");
    assert.equal(isEntitled("branding"), true);
    assert.equal(isEntitled("webhooks"), true);
    assert.equal(isEntitled("enterprise_workflows"), true);
  } finally {
    if (saved === undefined) delete process.env["PREMIUM_ENFORCEMENT"]; else process.env["PREMIUM_ENFORCEMENT"] = saved;
  }
});

test("license: resolveLicense reads LICENSE_KEY against LICENSE_PUBLIC_KEY env (enforced)", () => {
  const saved = { k: process.env["LICENSE_KEY"], p: process.env["LICENSE_PUBLIC_KEY"], e: process.env["PREMIUM_ENFORCEMENT"] };
  try {
    process.env["PREMIUM_ENFORCEMENT"] = "on"; // exercise the dormant paywall
    process.env["LICENSE_KEY"] = signLicense(licensePayload({ features: ["branding"], exp: 4_102_444_800 }), LIC_PRIV);
    process.env["LICENSE_PUBLIC_KEY"] = LIC_PUB;
    const status = resolveLicense();
    assert.equal(status.valid, true);
    assert.equal(status.source, "license");
    assert.deepEqual(status.features, ["branding"]);
    assert.equal(isEntitled("branding"), true);
    assert.equal(isEntitled("webhooks"), false);
  } finally {
    if (saved.k === undefined) delete process.env["LICENSE_KEY"]; else process.env["LICENSE_KEY"] = saved.k;
    if (saved.p === undefined) delete process.env["LICENSE_PUBLIC_KEY"]; else process.env["LICENSE_PUBLIC_KEY"] = saved.p;
    if (saved.e === undefined) delete process.env["PREMIUM_ENFORCEMENT"]; else process.env["PREMIUM_ENFORCEMENT"] = saved.e;
  }
});

test("license: no licence → community tier with no features (enforced)", () => {
  const saved = { k: process.env["LICENSE_KEY"], d: process.env["LICENSE_DEV_FEATURES"], n: process.env["NODE_ENV"], e: process.env["PREMIUM_ENFORCEMENT"] };
  try {
    process.env["PREMIUM_ENFORCEMENT"] = "on";
    delete process.env["LICENSE_KEY"];
    delete process.env["LICENSE_DEV_FEATURES"];
    process.env["NODE_ENV"] = "production";
    const status = resolveLicense();
    assert.equal(status.valid, false);
    assert.equal(status.tier, "community");
    assert.equal(status.features.length, 0);
  } finally {
    if (saved.k !== undefined) process.env["LICENSE_KEY"] = saved.k;
    if (saved.d !== undefined) process.env["LICENSE_DEV_FEATURES"] = saved.d;
    if (saved.n === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = saved.n;
    if (saved.e === undefined) delete process.env["PREMIUM_ENFORCEMENT"]; else process.env["PREMIUM_ENFORCEMENT"] = saved.e;
  }
});

// ── Branding (white-label) ──────────────────────────────────────────────────────
test("branding: sanitize accepts valid overrides and trims", () => {
  const b = sanitizeBranding({ appName: " Acme PM ", shortName: "AC", primaryColor: "#2563eb", logoUrl: "https://x/logo.png" });
  assert.equal(b.appName, "Acme PM");
  assert.equal(b.primaryColor, "#2563eb");
});

test("branding: sanitize rejects a non-hex colour", () => {
  assert.throws(() => sanitizeBranding({ primaryColor: "blue" }), /hex/);
});

test("branding: sanitize rejects a non-http logo url", () => {
  assert.throws(() => sanitizeBranding({ logoUrl: "javascript:alert(1)" }), /URL/);
});

test("branding: effective falls back to product defaults when unlicensed (enforced)", () => {
  const saved = process.env["LICENSE_DEV_FEATURES"];
  const savedNode = process.env["NODE_ENV"];
  const savedEnf = process.env["PREMIUM_ENFORCEMENT"];
  try {
    process.env["PREMIUM_ENFORCEMENT"] = "on"; // exercise the dormant paywall
    process.env["NODE_ENV"] = "production";
    delete process.env["LICENSE_DEV_FEATURES"];
    const eff = effectiveBranding();
    assert.equal(eff.entitled, false);
    assert.equal(eff.appName, DEFAULT_BRANDING.appName);
  } finally {
    if (saved !== undefined) process.env["LICENSE_DEV_FEATURES"] = saved;
    if (savedNode === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = savedNode;
    if (savedEnf === undefined) delete process.env["PREMIUM_ENFORCEMENT"]; else process.env["PREMIUM_ENFORCEMENT"] = savedEnf;
  }
});

// ── Labels (nomenclature) ───────────────────────────────────────────────────────
test("labels: sanitize keeps catalogue keys and drops unknowns", () => {
  const out = sanitizeLabels({ "nav.projects": "Engagements", "evil.key": "x", "term.programme": "Portfolio" });
  assert.equal(out["nav.projects"], "Engagements");
  assert.equal(out["term.programme"], "Portfolio");
  assert.equal("evil.key" in out, false);
});

test("labels: sanitize rejects an over-long value", () => {
  assert.throws(() => sanitizeLabels({ "nav.projects": "x".repeat(61) }), /too long/);
});

// ── Outbound webhooks ───────────────────────────────────────────────────────────
test("webhooks: signBody is a stable HMAC-SHA256", () => {
  const sig = signBody("{\"a\":1}", "secret");
  assert.equal(sig, "sha256=" + crypto.createHmac("sha256", "secret").update("{\"a\":1}").digest("hex"));
});

test("webhooks: create validates the URL and redact hides the secret", () => {
  updateSettings({ webhooks: [] });
  assert.throws(() => createWebhook({ url: "ftp://nope" }), /URL/);
  const created = createWebhook({ url: "https://example.com/hook", events: ["notification"] });
  assert.ok(created.secret.length > 0);
  const r = redact(created);
  assert.equal("secret" in r, false);
  assert.equal(r.secretSet, true);
  updateSettings({ webhooks: [] });
});

test("webhooks: deliver is a no-op without the entitlement (enforced)", async () => {
  const saved = process.env["LICENSE_DEV_FEATURES"];
  const savedNode = process.env["NODE_ENV"];
  const savedEnf = process.env["PREMIUM_ENFORCEMENT"];
  try {
    process.env["PREMIUM_ENFORCEMENT"] = "on"; // exercise the dormant paywall
    process.env["NODE_ENV"] = "production";
    delete process.env["LICENSE_DEV_FEATURES"];
    updateSettings({ webhooks: [{ id: "x", url: "https://127.0.0.1:1/none", secret: "s", events: ["*"], active: true }] });
    const results = await deliverWebhooks("notification", { hello: "world" });
    assert.deepEqual(results, []);
  } finally {
    updateSettings({ webhooks: [] });
    if (saved !== undefined) process.env["LICENSE_DEV_FEATURES"] = saved;
    if (savedNode === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = savedNode;
    if (savedEnf === undefined) delete process.env["PREMIUM_ENFORCEMENT"]; else process.env["PREMIUM_ENFORCEMENT"] = savedEnf;
  }
});

// ── Enterprise backend gating ───────────────────────────────────────────────────
test("backends: enterprise tier flags SAP/Primavera/Dynamics, not Jira", () => {
  assert.equal(isEnterpriseBackend("sap"), true);
  assert.equal(isEnterpriseBackend("primavera"), true);
  assert.equal(isEnterpriseBackend("dynamics365"), true);
  assert.equal(isEnterpriseBackend("jira"), false);
  assert.equal(isEnterpriseBackend("openproject"), false);
});

test("backends: catalogue exposes a tier per backend", () => {
  const cat = backendCatalogue();
  const sap = cat.find((b) => b.id === "sap");
  const jira = cat.find((b) => b.id === "jira");
  assert.equal(sap?.tier, "enterprise");
  assert.equal(jira?.tier, "standard");
});

test("backends: catalogue reports transport + which brokers reach each backend", () => {
  const cat = backendCatalogue();
  // An HTTP backend is broker-portable across every synchronous HTTP broker
  // (n8n, Make, Pipedream, Power Automate, serverless, a custom sidecar) — but
  // NOT async Airflow.
  const netsuite = cat.find((b) => b.id === "netsuite");
  assert.equal(netsuite?.transport, "http");
  assert.ok(netsuite?.brokers.includes("n8n") && netsuite.brokers.includes("make") && netsuite.brokers.includes("serverless"));
  assert.ok(!netsuite?.brokers.includes("airflow"), "async Airflow can't be the live data hop");
  // A native-node backend is n8n-tied.
  const linear = cat.find((b) => b.id === "linear");
  assert.equal(linear?.transport, "native-node");
  assert.deepEqual(linear?.brokers, ["n8n"]);
});

// ── Broker seam: DemoBroker runs the app with no n8n ────────────────────────────
import { DemoBroker } from "../broker/demo";
import type { ActorContext, Broker } from "../broker/types";

test("DemoBroker: serves projects/capabilities/writes with no backend configured", async () => {
  const b: Broker = new DemoBroker();
  const ctx = {} as ActorContext;
  assert.equal(b.kind, "demo");
  assert.equal(b.live, false);

  const projects = await b.listProjects(ctx);
  assert.ok(projects.some((p) => p.id === "proj-001"));

  const caps = await b.capabilities(ctx);
  assert.equal(caps["issues"], true);

  const created = await b.writeIssue(ctx, "create", { projectId: "tbp", title: "Broker seam test" });
  assert.ok(created && typeof created.id === "string");

  // Optimistic concurrency surfaces as a normalised `conflict`, no n8n in sight.
  await assert.rejects(
    () => b.writeIssue(ctx, "update", { projectId: "tbp", issueId: created!.id, expectedVersion: 999, title: "Stale" }),
    (e: unknown) => e instanceof Error && (e as { code?: string }).code === "conflict",
  );
});
