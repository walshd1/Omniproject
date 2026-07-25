import { test } from "node:test";
import assert from "node:assert/strict";
import { SECURITY_SETTINGS, CHOICE_SETTINGS, CLASSIFIED_KEYS, relaxingKeys } from "./security-settings";
import { relaxingConfig } from "./security-config";
import { getSettings } from "./settings";

test("DRIFT GUARD: every SettingsState key is classified (choice or security)", () => {
  const live = Object.keys(getSettings());
  const unclassified = live.filter((k) => !CLASSIFIED_KEYS.has(k));
  assert.deepEqual(unclassified, [], `unclassified settings keys — add each to CHOICE_SETTINGS or SECURITY_SETTINGS: ${unclassified.join(", ")}`);
  // And no phantom keys in the classification that don't exist on SettingsState.
  const liveSet = new Set(live);
  const phantom = [...CLASSIFIED_KEYS].filter((k) => !liveSet.has(k));
  assert.deepEqual(phantom, [], `classified keys that aren't on SettingsState: ${phantom.join(", ")}`);
});

test("a key is never in both buckets", () => {
  const choice = new Set(CHOICE_SETTINGS);
  const both = Object.keys(SECURITY_SETTINGS).filter((k) => choice.has(k));
  assert.deepEqual(both, []);
});

test("relaxingKeys flags a change to a fail-closed security setting, ignores choices", () => {
  const current = { webhooks: [], reportingCurrency: "GBP", brokerUrl: "https://a" };
  // changing a choice → not flagged
  assert.deepEqual(relaxingKeys(current, { reportingCurrency: "USD" }), []);
  // changing a fail-closed security setting → flagged
  assert.deepEqual(relaxingKeys(current, { webhooks: [{ id: "w", url: "https://x", secret: "s", events: ["*"], active: true }] }), ["webhooks"]);
  assert.deepEqual(relaxingKeys(current, { brokerUrl: "https://evil" }), ["brokerUrl"]);
});

test("history-retention (config def) has a real scale: shortening relaxes, lengthening strengthens (free)", () => {
  // historyRetention left SettingsState for the `history-retention` config def (Phase C); its shortening-is-a-
  // relaxation predicate now lives in SECURITY_CONFIGS, evaluated on the config path via relaxingConfig.
  const cur = { retentionDays: 365 };
  assert.equal(relaxingConfig("history-retention", cur, { retentionDays: 30 }), true); // shorten → relax
  assert.equal(relaxingConfig("history-retention", cur, { retentionDays: 730 }), false); // lengthen → immediate
  assert.equal(relaxingConfig("history-retention", cur, { retentionDays: 365 }), false); // no change
  assert.equal(relaxingConfig("history-retention", cur, { retentionDays: null }), false); // → infinite → strengthen
});

test("egress keys are DIRECTIONAL: opening/redirecting relaxes, removing/deactivating is immediate", () => {
  // webhooks: adding an active target relaxes; removing one strengthens; a same-url secret rotation is neutral.
  const wh = (url: string, secret = "s", active = true) => ({ id: url, url, secret, events: ["*"], active });
  assert.deepEqual(relaxingKeys({ webhooks: [] }, { webhooks: [wh("https://a")] }), ["webhooks"]);
  assert.deepEqual(relaxingKeys({ webhooks: [wh("https://a")] }, { webhooks: [] }), []);            // remove → immediate
  assert.deepEqual(relaxingKeys({ webhooks: [wh("https://a")] }, { webhooks: [wh("https://a", "s2")] }), []); // rotate secret → neutral
  assert.deepEqual(relaxingKeys({ webhooks: [wh("https://a")] }, { webhooks: [wh("https://a"), wh("https://b")] }), ["webhooks"]); // add another → relax
  assert.deepEqual(relaxingKeys({ webhooks: [wh("https://a", "s", true)] }, { webhooks: [wh("https://a", "s", false)] }), []); // deactivate → immediate

  // federatedPeers: a new active baseUrl relaxes; removal is immediate.
  const peer = (baseUrl: string, active = true) => ({ id: baseUrl, label: "L", baseUrl, token: "t", region: "eu", active });
  assert.deepEqual(relaxingKeys({ federatedPeers: [] }, { federatedPeers: [peer("https://eu")] }), ["federatedPeers"]);
  assert.deepEqual(relaxingKeys({ federatedPeers: [peer("https://eu")] }, { federatedPeers: [] }), []);
});

test("error-telemetry + logging-sync are SECURITY configs (floor gate): enabling relaxes, disabling is immediate", () => {
  // errorTelemetry + loggingSync left SettingsState for the `error-telemetry` / `logging-sync` config defs
  // (Phase C 7b); their relaxation predicates now live in SECURITY_CONFIGS, evaluated via relaxingConfig.
  assert.equal(relaxingConfig("error-telemetry", false, true), true);
  assert.equal(relaxingConfig("error-telemetry", true, false), false);
  assert.equal(relaxingConfig("error-telemetry", null, true), true); // unset → on ⇒ relax
  assert.equal(relaxingConfig("__a-choice-config", false, true), false); // unregistered ⇒ never a relaxation

  // logging-sync: turning egress ON relaxes; OFF is immediate; a redirect while on relaxes.
  assert.equal(relaxingConfig("logging-sync", { enabled: false }, { enabled: true, url: "https://logs" }), true);
  assert.equal(relaxingConfig("logging-sync", { enabled: true, url: "https://logs" }, { enabled: false, url: null }), false);
  assert.equal(relaxingConfig("logging-sync", { enabled: true, url: "https://a" }, { enabled: true, url: "https://b" }), true);
});

test("capabilityStates is DIRECTIONAL on the exposure ladder (off < user-defined < public) + egress endpoint", () => {
  const cs = (state: string, endpoint = "", surfaces?: Record<string, string>) => ({ vault: { state, endpoint, ...(surfaces ? { surfaces } : {}) } });
  // Raising exposure relaxes; lowering it is immediate.
  assert.deepEqual(relaxingKeys({ capabilityStates: cs("off") }, { capabilityStates: cs("public") }), ["capabilityStates"]);
  assert.deepEqual(relaxingKeys({ capabilityStates: cs("off") }, { capabilityStates: cs("user-defined") }), ["capabilityStates"]);
  assert.deepEqual(relaxingKeys({ capabilityStates: cs("public") }, { capabilityStates: cs("off") }), []);           // lower → immediate
  assert.deepEqual(relaxingKeys({ capabilityStates: cs("user-defined") }, { capabilityStates: cs("user-defined") }), []); // no change
  // A new/changed egress endpoint relaxes even at the same state; a surface getting more exposed relaxes.
  assert.deepEqual(relaxingKeys({ capabilityStates: cs("user-defined") }, { capabilityStates: cs("user-defined", "https://sink") }), ["capabilityStates"]);
  assert.deepEqual(relaxingKeys({ capabilityStates: cs("off", "", { web: "off" }) }, { capabilityStates: cs("off", "", { web: "public" }) }), ["capabilityStates"]);
  // Removing a capability entry (or an endpoint) is not a relaxation.
  assert.deepEqual(relaxingKeys({ capabilityStates: cs("public") }, { capabilityStates: {} }), []);
});
