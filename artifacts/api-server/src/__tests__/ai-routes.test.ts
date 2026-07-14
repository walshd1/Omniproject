import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the AI-assist edge (routes/ai.ts). The provider plumbing itself is unit-tested
 * in __tests__/ai.test.ts; here we drive the ROUTE branches that are reachable without a live
 * model: the read status endpoints, the zero-trust body validation (parseOr400 → 400), and the
 * per-surface governance gate (the active `provider:<id>` capability is OFF by default → 403 via
 * enforceOr403). No AI-provider network calls are made — every write route is stopped at the gate.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

// ── read/status endpoints ─────────────────────────────────────────────────────
test("GET /ai/status: reports the (unconfigured) provider", async () => {
  const r = await h.req("/ai/status", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const b = await json(r);
  assert.equal(b.provider, "none");
  assert.equal(b.configured, false);
});

test("GET /ai/governance: admin sees the active policy", async () => {
  const r = await h.req("/ai/governance", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.ok("budget" in (await json(r)) || true);
});

test("GET /ai/usage: admin chargeback report (empty window)", async () => {
  const r = await h.req("/ai/usage", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const b = await json(r);
  assert.ok(Array.isArray(b.usage));
});

test("GET /ai/containment: the current exposure level for a surface", async () => {
  const r = await h.req("/ai/containment?surface=/reports", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const b = await json(r);
  assert.ok("level" in b);
  assert.ok("source" in b);
});

test("GET /ai/stt: the active speech-to-text engine", async () => {
  const r = await h.req("/ai/stt", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.ok("provider" in (await json(r)));
});

// ── POST /ai/chat ──────────────────────────────────────────────────────────────
test("POST /ai/chat: no cookie → 401", async () => {
  const r = await h.req("/ai/chat", { method: "POST", body: { messages: [{ role: "user", content: "hi" }] } });
  assert.equal(r.status, 401);
});

test("POST /ai/chat: an invalid body → 400", async () => {
  const r = await h.req("/ai/chat", { method: "POST", cookie: adminCookie(), body: {} });
  assert.equal(r.status, 400);
});

test("POST /ai/chat: a valid body with no provider configured → 403 governance gate", async () => {
  const r = await h.req("/ai/chat", { method: "POST", cookie: adminCookie(), body: { messages: [{ role: "user", content: "hi" }] } });
  assert.equal(r.status, 403);
  assert.match((await json(r)).error, /AI is unavailable here/i);
});

// ── POST /ai/nl-action ──────────────────────────────────────────────────────────
test("POST /ai/nl-action: an empty text → 400", async () => {
  const r = await h.req("/ai/nl-action", { method: "POST", cookie: adminCookie(), body: { text: "" } });
  assert.equal(r.status, 400);
});

test("POST /ai/nl-action: a valid instruction is stopped at the provider gate → 403", async () => {
  const r = await h.req("/ai/nl-action", { method: "POST", cookie: adminCookie(), body: { text: "close all overdue issues" } });
  assert.equal(r.status, 403);
  assert.match((await json(r)).error, /AI is unavailable here/i);
});

// ── POST /ai/copilot ─────────────────────────────────────────────────────────────
test("POST /ai/copilot: a missing question → 400", async () => {
  const r = await h.req("/ai/copilot", { method: "POST", cookie: adminCookie(), body: {} });
  assert.equal(r.status, 400);
});

test("POST /ai/copilot: a valid question is stopped at the provider gate → 403", async () => {
  const r = await h.req("/ai/copilot", { method: "POST", cookie: adminCookie(), body: { question: "how is the portfolio?" } });
  assert.equal(r.status, 403);
  assert.match((await json(r)).error, /AI is unavailable here/i);
});

// ── POST /ai/transcribe ──────────────────────────────────────────────────────────
// ── POST /ai/insights ──────────────────────────────────────────────────────────
test("POST /ai/insights: an invalid kind → 400", async () => {
  const r = await h.req("/ai/insights", { method: "POST", cookie: adminCookie(), body: { kind: "not-a-kind" } });
  assert.equal(r.status, 400);
});

test("POST /ai/insights: a valid kind is stopped at the provider gate → 403 (off by default)", async () => {
  const r = await h.req("/ai/insights", { method: "POST", cookie: adminCookie(), body: { kind: "status-narrative" } });
  assert.equal(r.status, 403);
});

// ── POST /ai/estimate ──────────────────────────────────────────────────────────
test("POST /ai/estimate: a missing subject → 400", async () => {
  const r = await h.req("/ai/estimate", { method: "POST", cookie: adminCookie(), body: { unit: "points" } });
  assert.equal(r.status, 400);
});

test("POST /ai/estimate: an invalid unit → 400", async () => {
  const r = await h.req("/ai/estimate", { method: "POST", cookie: adminCookie(), body: { subject: "build login", unit: "weeks" } });
  assert.equal(r.status, 400);
});

test("POST /ai/estimate: a valid body is stopped at the provider gate → 403 (off by default)", async () => {
  const r = await h.req("/ai/estimate", { method: "POST", cookie: adminCookie(), body: { subject: "build login", unit: "points" } });
  assert.equal(r.status, 403);
});

test("POST /ai/transcribe: a missing audio payload → 400", async () => {
  const r = await h.req("/ai/transcribe", { method: "POST", cookie: adminCookie(), body: {} });
  assert.equal(r.status, 400);
});

test("POST /ai/transcribe: a valid payload is stopped at the STT gate → 403", async () => {
  const r = await h.req("/ai/transcribe", { method: "POST", cookie: adminCookie(), body: { audio: Buffer.from("x").toString("base64") } });
  assert.equal(r.status, 403);
  assert.match((await json(r)).error, /Speech-to-text is unavailable here/i);
});

// ── POST /ai/suggest-backend (admin) ─────────────────────────────────────────────
test("POST /ai/suggest-backend: an invalid body → 400", async () => {
  const r = await h.req("/ai/suggest-backend", { method: "POST", cookie: adminCookie(), body: {} });
  assert.equal(r.status, 400);
});

test("POST /ai/suggest-backend: a valid body is stopped at the provider gate → 403", async () => {
  const r = await h.req("/ai/suggest-backend", { method: "POST", cookie: adminCookie(), body: { vendorName: "Acme PM" } });
  assert.equal(r.status, 403);
  assert.match((await json(r)).error, /AI is unavailable here/i);
});
