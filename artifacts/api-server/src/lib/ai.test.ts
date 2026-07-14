import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_PROVIDER_IDS, aiStatus } from "./ai";

test("the AI provider registry covers every real provider (no none)", () => {
  assert.deepEqual([...AI_PROVIDER_IDS].sort(), ["anthropic", "ollama", "openai", "openai-compatible", "openrouter"]);
});

test("aiStatus is total — defaults to not-configured when no provider is selected", () => {
  // Tests run with default settings (provider "none"); aiStatus must not throw and
  // must report not configured rather than returning undefined.
  const s = aiStatus();
  assert.equal(typeof s.configured, "boolean");
  assert.equal(typeof s.detail, "string");
  if (s.provider === "none") {
    assert.equal(s.configured, false);
    assert.equal(s.model, null);
  }
});
