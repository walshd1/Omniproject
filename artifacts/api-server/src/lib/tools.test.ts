import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TOOLS, DEFAULT_TOOL_POLICY, lowestEgress, resolveTool, listResolvedTools,
  sanitizeToolPolicy, getConsentedTools, addToolConsent, revokeToolConsent, isKnownTool,
} from "./tools";
import type { ToolPolicy } from "./settings";

/**
 * Tool Registry governance: locked-down-by-default egress policy + per-user consent,
 * and the hard rule that every tool offers a local path.
 */

test("HARD RULE: every tool offers at least one local egress mode (no cloud-only tools)", () => {
  for (const t of TOOLS) {
    const local = t.egressModes.some((m) => m === "none" || m === "self-hosted");
    assert.ok(local, `tool "${t.id}" must offer a local (none/self-hosted) mode`);
  }
});

test("lowestEgress prefers the most local mode", () => {
  assert.equal(lowestEgress(["third-party", "self-hosted", "none"]), "none");
  assert.equal(lowestEgress(["third-party", "self-hosted"]), "self-hosted");
  assert.equal(lowestEgress([]), null);
});

test("default policy (locked) allows only on-device tools, blocks the rest", () => {
  const resolved = listResolvedTools(DEFAULT_TOOL_POLICY, []);
  const whisper = resolved.find((t) => t.id === "whisper-dictation")!;
  const copilot = resolved.find((t) => t.id === "portfolio-copilot")!;
  // Whisper can run on-device → available with no consent needed.
  assert.equal(whisper.available, true);
  assert.equal(whisper.effectiveEgress, "none");
  assert.equal(whisper.requiresConsent, false);
  // Copilot has no local-only mode → blocked until the admin relaxes egress.
  assert.equal(copilot.available, false);
  assert.equal(copilot.reason, "blocked by the data-egress policy");
});

test("relaxing to self-hosted unlocks LLM tools but demands consent first", () => {
  const policy: ToolPolicy = { allowedEgress: ["none", "self-hosted"], disabled: [] };
  const copilot = resolveTool(TOOLS.find((t) => t.id === "portfolio-copilot")!, policy, []);
  assert.equal(copilot.available, true);
  assert.equal(copilot.effectiveEgress, "self-hosted");
  assert.equal(copilot.requiresConsent, true);
  // Once consented, no further prompt.
  const after = resolveTool(TOOLS.find((t) => t.id === "portfolio-copilot")!, policy, ["portfolio-copilot"]);
  assert.equal(after.requiresConsent, false);
});

test("an admin can switch a tool off entirely", () => {
  const policy: ToolPolicy = { allowedEgress: ["none"], disabled: ["whisper-dictation"] };
  const whisper = resolveTool(TOOLS.find((t) => t.id === "whisper-dictation")!, policy, []);
  assert.equal(whisper.available, false);
  assert.match(whisper.reason ?? "", /administrator/);
});

test("sanitizeToolPolicy always keeps 'none', filters junk, validates ids", () => {
  assert.deepEqual(sanitizeToolPolicy({}).allowedEgress, ["none"]);
  assert.deepEqual(sanitizeToolPolicy({ allowedEgress: ["third-party"] }).allowedEgress, ["none", "third-party"]);
  assert.deepEqual(sanitizeToolPolicy({ allowedEgress: ["bogus", "self-hosted"] }).allowedEgress, ["none", "self-hosted"]);
  assert.deepEqual(sanitizeToolPolicy({ disabled: ["whisper-dictation", "nope"] }).disabled, ["whisper-dictation"]);
});

test("consent round-trips per user and is idempotent", () => {
  const sub = `u-${Math.round(performance.now())}`;
  assert.deepEqual(getConsentedTools(sub), []);
  assert.deepEqual(addToolConsent(sub, "portfolio-copilot"), ["portfolio-copilot"]);
  assert.deepEqual(addToolConsent(sub, "portfolio-copilot"), ["portfolio-copilot"]); // idempotent
  assert.equal(getConsentedTools(sub).includes("portfolio-copilot"), true);
  assert.deepEqual(revokeToolConsent(sub, "portfolio-copilot"), []);
});

test("isKnownTool guards unknown ids", () => {
  assert.equal(isKnownTool("whisper-dictation"), true);
  assert.equal(isKnownTool("made-up"), false);
});
