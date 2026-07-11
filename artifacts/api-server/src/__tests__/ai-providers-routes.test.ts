import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, stepUpAdminCookie, type Harness } from "./_harness";

/**
 * AI Providers admin plane over the REAL app. Admin + step-up + audited writes. Providers
 * are seeded (openai/anthropic/…); tests create/mutate a throwaway provider and clean it up
 * so global state doesn't leak. Reachable branches: the step-up gate, body validation (400),
 * unsafe-id (400), unknown provider/capability (404) and the write success paths.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());
afterEach(async () => {
  // Drop the throwaway provider if a test left it behind.
  const { removeProvider, listProviders } = await import("../lib/ai-providers");
  if (listProviders().some((p) => p.id === "int-test-prov")) await removeProvider("int-test-prov");
});

test("GET /ai/providers without a cookie is 401", async () => {
  assert.equal((await h.req("/ai/providers")).status, 401);
});

test("GET /ai/providers returns the registry, kinds, capabilities and vault info", async () => {
  const r = await h.req("/ai/providers", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const body = await r.json() as { providers: unknown[]; kinds: string[]; capabilities: unknown[]; vault: { backend: string } };
  assert.ok(Array.isArray(body.providers));
  assert.ok(body.kinds.includes("openai"));
  assert.ok(Array.isArray(body.capabilities));
  assert.ok(body.vault && typeof body.vault.backend === "string");
});

test("GET /ai/providers/rollback reports availability", async () => {
  const r = await h.req("/ai/providers/rollback", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.equal(typeof (await r.json() as { available: boolean }).available, "boolean");
});

test("POST /ai/providers without a fresh step-up is 403", async () => {
  const r = await h.req("/ai/providers", { method: "POST", cookie: adminCookie(), body: { id: "x", kind: "openai", label: "X" } });
  assert.equal(r.status, 403);
  assert.equal((await r.json() as { code: string }).code, "step_up_required");
});

test("POST /ai/providers with an invalid body is 400", async () => {
  const r = await h.req("/ai/providers", { method: "POST", cookie: stepUpAdminCookie(), body: { id: "x", kind: "not-a-kind", label: "X" } });
  assert.equal(r.status, 400);
});

test("POST /ai/providers with an unsafe id is rejected", async () => {
  const r = await h.req("/ai/providers", { method: "POST", cookie: stepUpAdminCookie(), body: { id: "bad id!", kind: "openai", label: "Bad" } });
  assert.equal(r.status, 400);
  assert.match((await r.json() as { error: string }).error, /unsafe/i);
});

test("POST /ai/providers with a metadata/link-local endpoint is rejected (SSRF guard)", async () => {
  const r = await h.req("/ai/providers", {
    method: "POST",
    cookie: stepUpAdminCookie(),
    body: { id: "int-test-prov", kind: "openai", label: "Evil", endpoint: "http://169.254.169.254/latest/meta-data/" },
  });
  assert.equal(r.status, 400);
  assert.match((await r.json() as { error: string }).error, /safe|url/i);
});

test("full provider lifecycle: create → set key → clear key → set capability → delete", async () => {
  // Create
  const created = await h.req("/ai/providers", { method: "POST", cookie: stepUpAdminCookie(), body: { id: "int-test-prov", kind: "openai", label: "Integration Test", endpoint: "https://api.example.com", model: "gpt-x" } });
  assert.equal(created.status, 200);
  assert.ok((await created.json() as { providers: { id: string }[] }).providers.some((p) => p.id === "int-test-prov"));

  // Key on an unknown provider -> 404
  const missing = await h.req("/ai/providers/no-such/key", { method: "PUT", cookie: stepUpAdminCookie(), body: { key: "sk-123" } });
  assert.equal(missing.status, 404);

  // Key with an invalid body -> 400
  const badKey = await h.req("/ai/providers/int-test-prov/key", { method: "PUT", cookie: stepUpAdminCookie(), body: {} });
  assert.equal(badKey.status, 400);

  // Store a key (write-only; response is presence + fingerprint, never the key)
  const setKey = await h.req("/ai/providers/int-test-prov/key", { method: "PUT", cookie: stepUpAdminCookie(), body: { key: "sk-secret-value" } });
  assert.equal(setKey.status, 200);
  const keyState = await setKey.json() as { hasKey?: boolean };
  assert.equal(keyState.hasKey, true);

  // Clear the key
  const clearKey = await h.req("/ai/providers/int-test-prov/key", { method: "DELETE", cookie: stepUpAdminCookie() });
  assert.equal(clearKey.status, 200);

  // Capability mapping: unknown capability -> 404
  const badCap = await h.req("/ai/capabilities/not-a-cap", { method: "PUT", cookie: stepUpAdminCookie(), body: { providers: ["int-test-prov"] } });
  assert.equal(badCap.status, 404);

  // Capability mapping: valid
  const setCap = await h.req("/ai/capabilities/chat", { method: "PUT", cookie: stepUpAdminCookie(), body: { providers: ["int-test-prov", "openai"] } });
  assert.equal(setCap.status, 200);

  // Delete the provider
  const del = await h.req("/ai/providers/int-test-prov", { method: "DELETE", cookie: stepUpAdminCookie() });
  assert.equal(del.status, 200);
  assert.ok(!(await del.json() as { providers: { id: string }[] }).providers.some((p) => p.id === "int-test-prov"));
});

test("POST /ai/providers/rollback with a fresh step-up succeeds", async () => {
  const r = await h.req("/ai/providers/rollback", { method: "POST", cookie: stepUpAdminCookie() });
  assert.equal(r.status, 200);
  assert.equal(typeof (await r.json() as { rolledBack: boolean }).rolledBack, "boolean");
});
