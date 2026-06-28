import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listCapabilities, getCapability, offeredStates, resolveState, resolveCapability,
  sanitizeCapabilitySetting, setCapabilityState, effectiveState,
  listSurfaces, decideCapability, enforceCapability, CapabilityBlockedError, recentCapabilityLog, noteCapabilityConfigured,
  validEndpoint, screenIdForRoute, checkEndpointReachable,
} from "./tools";
import { SCREENS } from "@workspace/backend-catalogue";
import { updateSettings } from "./settings";
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

test("checkEndpointReachable blocks cloud-metadata/link-local targets (SSRF guard)", async () => {
  // Returns early (no fetch) for a metadata address, so it can't be used as an SSRF probe.
  for (const url of ["http://169.254.169.254/latest/meta-data/", "http://[fe80::1]/", "http://169.254.0.1"]) {
    const r = await checkEndpointReachable(url);
    assert.equal(r.reachable, false, url);
    assert.match(r.error ?? "", /blocked|metadata|link-local/i);
  }
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

test("listSurfaces comes from the screen registry (id + label)", () => {
  const surfaces = listSurfaces();
  assert.ok(surfaces.length > 0);
  for (const s of surfaces) { assert.equal(typeof s.id, "string"); assert.equal(typeof s.label, "string"); }
});

test("default is NO AI — everything off until an admin turns it on", () => {
  updateSettings({ aiProvider: "openai", capabilityStates: {} });
  // Even with an AI provider configured, nothing is on until governance enables it.
  assert.equal(effectiveState("provider:openai"), "off");
  assert.equal(effectiveState("dictation"), "off");
  assert.equal(effectiveState("broker:n8n"), "off");
});

test("brokers are governed by the same tri-state", () => {
  const broker = getCapability("broker:n8n");
  assert.ok(broker, "n8n broker should be registered");
  assert.equal(broker!.kind, "broker");
  setCapabilityState("broker:n8n", { state: "user-defined", endpoint: "http://n8n:5678" });
  assert.equal(effectiveState("broker:n8n"), "user-defined");
});

test("enforceCapability allows an on capability and throws when it's off", () => {
  updateSettings({ capabilityStates: {} });
  setCapabilityState("provider:openai", { state: "public" });
  const ok = enforceCapability("provider:openai", { actor: { sub: "u1" } });
  assert.equal(ok.allowed, true);
  assert.equal(ok.state, "public");
  // anthropic is off ⇒ blocked.
  assert.throws(() => enforceCapability("provider:anthropic"), CapabilityBlockedError);
});

test("activity log captures uses, blocks and config changes for the dashboard", () => {
  setCapabilityState("provider:openai", { state: "public" });
  noteCapabilityConfigured("provider:openai", { state: "public" }, { sub: "admin-1" });
  decideCapability("provider:openai", { actor: { sub: "u2" } }); // a "use"
  decideCapability("provider:anthropic"); // a "blocked" (off)
  const log = recentCapabilityLog();
  const actions = log.slice(0, 3).map((e) => e.action);
  assert.ok(actions.includes("blocked"));
  assert.ok(actions.includes("use"));
  assert.ok(log.some((e) => e.action === "configured"));
});

test("enforcement is per-surface: on globally, blocked on a restricted screen", () => {
  setCapabilityState("provider:openai", { state: "public", surfaces: { finance: "off" } });
  updateSettings({ aiProvider: "openai" });
  assert.equal(enforceCapability("provider:openai").allowed, true); // global
  assert.throws(() => enforceCapability("provider:openai", { surface: "finance" }), CapabilityBlockedError);
});

test("decideCapability reports the endpoint for a user-defined capability", () => {
  setCapabilityState("provider:ollama", { state: "user-defined", endpoint: "http://localhost:11434" });
  const d = decideCapability("provider:ollama", { actor: { sub: "u1" } });
  assert.equal(d.allowed, true);
  assert.equal(d.state, "user-defined");
  assert.equal(d.endpoint, "http://localhost:11434");
  // An unknown capability is denied (and logged).
  assert.equal(decideCapability("nope").allowed, false);
});

test("validEndpoint accepts http(s) URLs and rejects the rest", () => {
  assert.equal(validEndpoint("http://localhost:11434"), "http://localhost:11434");
  assert.equal(validEndpoint("https://n8n.example.com/x"), "https://n8n.example.com/x");
  assert.equal(validEndpoint("  "), null);
  assert.equal(validEndpoint("not a url"), null);
  assert.equal(validEndpoint("ftp://host/x"), null);
});

test("screenIdForRoute normalises a route path to a registry screen id", () => {
  const screen = SCREENS[0]!;
  assert.equal(screenIdForRoute(screen.id), screen.id); // already an id
  assert.equal(screenIdForRoute(screen.route), screen.id); // by route
  assert.equal(screenIdForRoute(`${screen.route}?x=1`), screen.id); // query stripped
  assert.equal(screenIdForRoute("/no-such-route"), undefined); // unknown ⇒ global state
  assert.equal(screenIdForRoute(undefined), undefined);
});

test("checkEndpointReachable: HTTP response ⇒ reachable, network error ⇒ not", async () => {
  assert.deepEqual(await checkEndpointReachable("nonsense"), { reachable: false, error: "not a valid http(s) URL" });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({ status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await checkEndpointReachable("http://up.local"), { reachable: true, status: 200 });
  globalThis.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  const down = await checkEndpointReachable("http://down.local");
  assert.equal(down.reachable, false);
  globalThis.fetch = original;
});

test("resolveCapability exposes options + current state for the admin UI", () => {
  setCapabilityState("provider:ollama", { state: "user-defined", endpoint: "http://localhost:11434" });
  const r = resolveCapability(getCapability("provider:ollama")!, { "provider:ollama": { state: "user-defined", endpoint: "http://localhost:11434" } });
  assert.deepEqual(r.options, ["off", "user-defined"]);
  assert.equal(r.state, "user-defined");
  assert.equal(r.endpoint, "http://localhost:11434");
});
