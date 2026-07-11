import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Direct unit tests for the AI provider client.
 *
 * Provider API KEYS now live in the encrypted vault (lib/vault), NOT the environment — so we
 * seed/clear keys with vault.setSecret/clearProviderKey rather than env vars. OLLAMA_URL is
 * pinned (an endpoint, not a secret) so we can assert the request URL precisely. No real
 * network calls are made: aiChat's happy/error paths run against a mocked globalThis.fetch.
 */
// An IP literal (not a name) so the egress guard in safeFetch performs no DNS lookup —
// keeps this unit test hermetic/offline while still exercising the guarded call path.
process.env["OLLAMA_URL"] = "http://127.0.0.1:11434";

const { aiStatus, aiChat, AiError } = await import("../lib/ai");
const { updateSettings, getSettings } = await import("../lib/settings");
const { setProviderKey, clearProviderKey, __resetProviders } = await import("../lib/ai-providers");
const { __resetVault } = await import("../lib/vault");

const ORIGINAL = getSettings();
function restore(): void {
  updateSettings({ aiProvider: ORIGINAL.aiProvider, aiModel: ORIGINAL.aiModel });
  __resetProviders();
  __resetVault();
}
afterEach(restore);

test("AiError sets name and status", () => {
  const def = new AiError("boom");
  assert.equal(def.name, "AiError");
  assert.equal(def.status, 502);
  assert.ok(def instanceof Error);
  const explicit = new AiError("bad request", 400);
  assert.equal(explicit.status, 400);
  assert.equal(explicit.message, "bad request");
});

test("aiStatus reports provider 'none' as not configured", () => {
  updateSettings({ aiProvider: "none" });
  const s = aiStatus();
  assert.equal(s.provider, "none");
  assert.equal(s.configured, false);
  assert.equal(s.model, null);
  assert.match(s.detail, /No AI provider/i);
});

test("aiStatus reports ollama as configured without a key", () => {
  updateSettings({ aiProvider: "ollama", aiModel: null });
  const s = aiStatus();
  assert.equal(s.provider, "ollama");
  assert.equal(s.configured, true);
  assert.equal(s.model, "llama3.2"); // per-provider default
  assert.match(s.detail, /127\.0\.0\.1:11434/);
});

test("aiStatus reflects vault key presence for key-gated providers", async () => {
  // Anthropic with a vault key -> configured.
  updateSettings({ aiProvider: "anthropic", aiModel: null });
  await setProviderKey("anthropic", "test-anthropic-key");
  const anthropic = aiStatus();
  assert.equal(anthropic.provider, "anthropic");
  assert.equal(anthropic.configured, true);
  assert.equal(anthropic.model, "claude-3-5-haiku-latest");
  assert.match(anthropic.detail, /ready/i);

  // OpenAI with no key in the vault -> not configured, pointed at the AI Providers screen.
  updateSettings({ aiProvider: "openai" });
  await clearProviderKey("openai");
  const openai = aiStatus();
  assert.equal(openai.provider, "openai");
  assert.equal(openai.configured, false);
  assert.match(openai.detail, /AI Providers/i);
});

test("aiStatus honours a custom aiModel override", () => {
  updateSettings({ aiProvider: "ollama", aiModel: "custom-model" });
  assert.equal(aiStatus().model, "custom-model");
});

test("aiChat throws AiError 400 when provider is 'none'", async () => {
  updateSettings({ aiProvider: "none" });
  await assert.rejects(
    () => aiChat([{ role: "user", content: "hi" }]),
    (err: unknown) => err instanceof AiError && err.status === 400 && /No AI provider/i.test(err.message),
  );
});

test("aiChat throws AiError 400 when a key-gated provider has no vault key", async () => {
  updateSettings({ aiProvider: "openai" });
  await clearProviderKey("openai");
  await assert.rejects(
    () => aiChat([{ role: "user", content: "hi" }]),
    (err: unknown) => err instanceof AiError && err.status === 400 && /AI Providers/i.test(err.message),
  );
});

// --- fetch-mocked happy/error paths (ollama: no key required) ---------------
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit | undefined }>;

before(() => { calls = []; });
after(() => { globalThis.fetch = realFetch; });

test("aiChat (ollama) shapes the request and returns content on success", async () => {
  updateSettings({ aiProvider: "ollama", aiModel: "llama3.2" });
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ message: { content: "hello from ollama" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const result = await aiChat([
    { role: "system", content: "be brief" },
    { role: "user", content: "ping" },
  ]);

  assert.equal(result.content, "hello from ollama");
  assert.equal(result.provider, "ollama");
  assert.equal(result.model, "llama3.2");

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "http://127.0.0.1:11434/api/chat");
  assert.equal(calls[0]!.init?.method, "POST");
  const body = JSON.parse(String(calls[0]!.init?.body));
  assert.equal(body.model, "llama3.2");
  assert.equal(body.stream, false);
  assert.equal(body.messages.length, 2);

  globalThis.fetch = realFetch;
});

test("aiChat (ollama) wraps a non-ok provider response in AiError", async () => {
  updateSettings({ aiProvider: "ollama", aiModel: "llama3.2" });
  globalThis.fetch = (async () => new Response("upstream exploded", { status: 503 })) as typeof fetch;

  await assert.rejects(
    () => aiChat([{ role: "user", content: "ping" }]),
    (err: unknown) => err instanceof AiError && err.status === 502 && /503/.test(err.message) && /upstream exploded/.test(err.message),
  );

  globalThis.fetch = realFetch;
});

// --- governance gate (opt-in role allowlist + token budget) and DLP ------------
const GOV_ENV = ["AI_MODEL_ALLOWLIST", "AI_TOKEN_BUDGET", "AI_DLP_REDACT", "AI_BUDGET_WINDOW_HOURS"];
afterEach(() => { for (const k of GOV_ENV) delete process.env[k]; });

test("aiChat (ollama) errors when the provider returns no message content", async () => {
  updateSettings({ aiProvider: "ollama", aiModel: "llama3.2" });
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: {} }), { status: 200 })) as typeof fetch;
  await assert.rejects(
    () => aiChat([{ role: "user", content: "ping" }]),
    (err: unknown) => err instanceof AiError && /no message content/i.test(err.message),
  );
  globalThis.fetch = realFetch;
});

test("aiChat enforces the per-role model allowlist with a 403", async () => {
  updateSettings({ aiProvider: "ollama", aiModel: "llama3.2" });
  process.env["AI_MODEL_ALLOWLIST"] = "analyst=only-this-model"; // llama3.2 not allowed for analyst
  await assert.rejects(
    () => aiChat([{ role: "user", content: "hi" }], { role: "analyst" }),
    (err: unknown) => err instanceof AiError && err.status === 403 && /not permitted for your role/i.test(err.message),
  );
});

test("aiChat enforces the per-scope token budget with a 429", async () => {
  updateSettings({ aiProvider: "ollama", aiModel: "llama3.2" });
  process.env["AI_TOKEN_BUDGET"] = "1"; // any real prompt exceeds a 1-token budget
  await assert.rejects(
    () => aiChat([{ role: "user", content: "a fairly long prompt that exceeds one token" }], { scope: "user-1" }),
    (err: unknown) => err instanceof AiError && err.status === 429 && /budget exceeded/i.test(err.message),
  );
});

test("aiChat redacts PII before egress (DLP) and records usage when governance passes", async () => {
  updateSettings({ aiProvider: "ollama", aiModel: "llama3.2" });
  process.env["AI_DLP_REDACT"] = "true";
  process.env["AI_TOKEN_BUDGET"] = "1000000"; // generous, so the call goes through
  process.env["AI_MODEL_ALLOWLIST"] = "admin=*"; // admin may use any model
  let sentBody = "";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sentBody = String(init?.body);
    return new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 });
  }) as typeof fetch;

  const result = await aiChat([{ role: "user", content: "email me at alice@example.com" }], { role: "admin", scope: "user-1" });
  assert.equal(result.content, "ok");
  assert.ok(sentBody.includes("[redacted-email]"), "the outbound prompt was DLP-masked");
  assert.ok(!sentBody.includes("alice@example.com"));
  globalThis.fetch = realFetch;
});
