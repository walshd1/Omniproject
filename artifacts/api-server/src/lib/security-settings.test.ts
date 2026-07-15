import { test } from "node:test";
import assert from "node:assert/strict";
import { SECURITY_SETTINGS, CHOICE_SETTINGS, CLASSIFIED_KEYS, relaxingKeys } from "./security-settings";
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

test("historyRetention has a real scale: shortening relaxes, lengthening strengthens (free)", () => {
  const current = { historyRetention: { retentionDays: 365 } };
  assert.deepEqual(relaxingKeys(current, { historyRetention: { retentionDays: 30 } }), ["historyRetention"]); // shorten → relax
  assert.deepEqual(relaxingKeys(current, { historyRetention: { retentionDays: 730 } }), []); // lengthen → strengthen, immediate
  assert.deepEqual(relaxingKeys(current, { historyRetention: { retentionDays: 365 } }), []); // no change
});
