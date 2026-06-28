import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listCapabilities, getCapability, offeredStates, resolveState, resolveCapability,
  sanitizeCapabilitySetting, setCapabilityState, effectiveState,
} from "./tools";
import type { CapabilitySetting } from "./settings";

/**
 * Capability governance: tri-state (off/user-defined/public), only-offer-what's-
 * supported, and per-surface overrides for AI tools.
 */

test("the registry covers AI tools, the MCP, AI providers and vendors", () => {
  const kinds = new Set(listCapabilities().map((c) => c.kind));
  for (const k of ["ai-tool", "mcp", "ai-provider", "vendor"]) assert.ok(kinds.has(k as never), `missing kind ${k}`);
});

test("a provider offers only the states it actually supports", () => {
  const ollama = getCapability("provider:ollama")!;
  const openai = getCapability("provider:openai")!;
  assert.deepEqual(ollama.supportedStates, ["user-defined"]); // local-only
  assert.deepEqual(openai.supportedStates, ["public"]); // cloud-only
  // "off" is always an option on top of what's supported.
  assert.deepEqual(offeredStates(ollama), ["off", "user-defined"]);
  assert.deepEqual(offeredStates(openai), ["off", "public"]);
});

test("resolveState clamps an unsupported choice down to off", () => {
  const openai = getCapability("provider:openai")!;
  // openai can't be "user-defined" → treated as off.
  assert.equal(resolveState(openai, { state: "user-defined" }), "off");
  assert.equal(resolveState(openai, { state: "public" }), "public");
  assert.equal(resolveState(openai, undefined), "off"); // unset ⇒ off
});

test("every capability honours per-surface overrides (capability × surface matrix)", () => {
  const tts = getCapability("tts")!;
  const setting: CapabilitySetting = { state: "public", surfaces: { finance: "user-defined" } };
  assert.equal(resolveState(tts, setting), "public"); // global default
  assert.equal(resolveState(tts, setting, "finance"), "user-defined"); // overridden on finance
  assert.equal(resolveState(tts, setting, "home"), "public"); // other screens keep the default

  // Not just AI tools — a provider or vendor can be forced off on a sensitive screen.
  const openai = getCapability("provider:openai")!;
  assert.equal(resolveState(openai, { state: "public", surfaces: { finance: "off" } }, "finance"), "off");
  const vendor = getCapability("vendor:openproject");
  if (vendor) {
    assert.equal(resolveState(vendor, { state: "public", surfaces: { finance: "off" } }, "finance"), "off");
  }
});

test("sanitize keeps only supportable states + surface overrides", () => {
  const openai = getCapability("provider:openai")!;
  assert.equal(sanitizeCapabilitySetting(openai, { state: "user-defined" }).state, "off"); // unsupported
  assert.equal(sanitizeCapabilitySetting(openai, { state: "public" }).state, "public");

  const tts = getCapability("tts")!;
  const clean = sanitizeCapabilitySetting(tts, { state: "public", surfaces: { finance: "off", bad: "nonsense" } });
  assert.equal(clean.surfaces?.finance, "off");
  assert.equal("bad" in (clean.surfaces ?? {}), false); // invalid value dropped
});

test("setCapabilityState persists and effectiveState reads it back per surface", () => {
  setCapabilityState("tts", { state: "public", surfaces: { finance: "off" } });
  assert.equal(effectiveState("tts"), "public");
  assert.equal(effectiveState("tts", "finance"), "off");
  assert.equal(effectiveState("unknown-cap"), "off"); // unknown ⇒ off
});

test("resolveCapability exposes options + current state for the admin UI", () => {
  setCapabilityState("provider:ollama", { state: "user-defined", endpoint: "http://localhost:11434" });
  const r = resolveCapability(getCapability("provider:ollama")!, { "provider:ollama": { state: "user-defined", endpoint: "http://localhost:11434" } });
  assert.deepEqual(r.options, ["off", "user-defined"]);
  assert.equal(r.state, "user-defined");
  assert.equal(r.endpoint, "http://localhost:11434");
});
