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
process.env["OLLAMA_URL"] = "http://ollama.test:11434";

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
  assert.match(s.detail, /ollama\.test:11434/);
});

test("aiStatus reflects vault key presence for key-gated providers", () => {
  // Anthropic with a vault key -> configured.
  updateSettings({ aiProvider: "anthropic", aiModel: null });
  setProviderKey("anthropic", "test-anthropic-key");
  const anthropic = aiStatus();
  assert.equal(anthropic.provider, "anthropic");
  assert.equal(anthropic.configured, true);
  assert.equal(anthropic.model, "claude-3-5-haiku-latest");
  assert.match(anthropic.detail, /ready/i);

  // OpenAI with no key in the vault -> not configured, pointed at the AI Providers screen.
  updateSettings({ aiProvider: "openai" });
  clearProviderKey("openai");
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
  clearProviderKey("openai");
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
  assert.equal(calls[0]!.url, "http://ollama.test:11434/api/chat");
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
