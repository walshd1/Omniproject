import { test, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Direct unit tests for the AI provider client.
 *
 * NOTE: ai.ts reads provider API keys into module-level constants at import time,
 * so the env below MUST be set BEFORE the dynamic import that follows. We give
 * Anthropic a key (a configured key-gated provider) and leave OpenAI keyless (an
 * unconfigured key-gated provider). OLLAMA_URL is pinned so we can assert the
 * request URL precisely. No real network calls are made: aiChat's happy/error
 * paths are exercised against a mocked globalThis.fetch.
 */
process.env["ANTHROPIC_API_KEY"] = "test-anthropic-key";
process.env["OLLAMA_URL"] = "http://ollama.test:11434";
delete process.env["OPENAI_API_KEY"];
delete process.env["OPENROUTER_API_KEY"];

const { aiStatus, aiChat, AiError } = await import("../lib/ai");
const { updateSettings, getSettings } = await import("../lib/settings");

// Snapshot settings so each test restores provider/model and other tests see the
// original (env-seeded) configuration afterwards.
const ORIGINAL = getSettings();
function restoreSettings(): void {
  updateSettings({ aiProvider: ORIGINAL.aiProvider, aiModel: ORIGINAL.aiModel });
}

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
  restoreSettings();
});

test("aiStatus reports ollama as configured without a key", () => {
  updateSettings({ aiProvider: "ollama", aiModel: null });
  const s = aiStatus();
  assert.equal(s.provider, "ollama");
  assert.equal(s.configured, true);
  assert.equal(s.model, "llama3.2"); // per-provider default
  assert.match(s.detail, /ollama\.test:11434/);
  restoreSettings();
});

test("aiStatus reflects key presence for key-gated providers", () => {
  // Anthropic has a key (set above) -> configured.
  updateSettings({ aiProvider: "anthropic", aiModel: null });
  const anthropic = aiStatus();
  assert.equal(anthropic.provider, "anthropic");
  assert.equal(anthropic.configured, true);
  assert.equal(anthropic.model, "claude-3-5-haiku-latest");
  assert.match(anthropic.detail, /Anthropic configured/);

  // OpenAI has no key -> not configured.
  updateSettings({ aiProvider: "openai" });
  const openai = aiStatus();
  assert.equal(openai.provider, "openai");
  assert.equal(openai.configured, false);
  assert.match(openai.detail, /Set OPENAI_API_KEY/);

  restoreSettings();
});

test("aiStatus honours a custom aiModel override", () => {
  updateSettings({ aiProvider: "ollama", aiModel: "custom-model" });
  assert.equal(aiStatus().model, "custom-model");
  restoreSettings();
});

test("aiChat throws AiError 400 when provider is 'none'", async () => {
  updateSettings({ aiProvider: "none" });
  await assert.rejects(
    () => aiChat([{ role: "user", content: "hi" }]),
    (err: unknown) => {
      assert.ok(err instanceof AiError);
      assert.equal(err.status, 400);
      assert.match(err.message, /No AI provider/i);
      return true;
    },
  );
  restoreSettings();
});

test("aiChat throws AiError 400 when a key-gated provider is unconfigured", async () => {
  updateSettings({ aiProvider: "openai" }); // no OPENAI_API_KEY set
  await assert.rejects(
    () => aiChat([{ role: "user", content: "hi" }]),
    (err: unknown) => {
      assert.ok(err instanceof AiError);
      assert.equal(err.status, 400);
      assert.match(err.message, /OPENAI_API_KEY/);
      return true;
    },
  );
  restoreSettings();
});

// --- fetch-mocked happy/error paths (ollama: no key required) ---------------

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit | undefined }>;

before(() => {
  calls = [];
});

after(() => {
  globalThis.fetch = realFetch;
  restoreSettings();
});

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
  restoreSettings();
});

test("aiChat (ollama) wraps a non-ok provider response in AiError", async () => {
  updateSettings({ aiProvider: "ollama", aiModel: "llama3.2" });
  globalThis.fetch = (async () =>
    new Response("upstream exploded", { status: 503 })) as typeof fetch;

  await assert.rejects(
    () => aiChat([{ role: "user", content: "ping" }]),
    (err: unknown) => {
      assert.ok(err instanceof AiError);
      assert.equal(err.status, 502); // default AiError status for upstream failures
      assert.match(err.message, /503/);
      assert.match(err.message, /upstream exploded/);
      return true;
    },
  );

  globalThis.fetch = realFetch;
  restoreSettings();
});
