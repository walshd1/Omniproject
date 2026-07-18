import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot, applySnapshot, SNAPSHOT_KEYS, EXCLUDED_KEYS } from "./config-snapshot";
import { CLASSIFIED_KEYS } from "./security-settings";
import { getSettings, updateSettings } from "./settings";

/**
 * Snapshot capture/restore for a user's bespoke artifact definitions. These are the customisations a
 * user authors (custom reports, report overrides, content pages) — they belong in the backup alongside
 * saved views, so "keep your bespoke config backed up" actually captures them. The shipped baseline defs
 * live in code, never in settings, so they are structurally absent from the snapshot.
 */
test("snapshot captures + restores bespoke reports, overrides and content pages", () => {
  updateSettings({
    customReports: [{ id: "r1", label: "By status", scope: "tasks", viz: "bar", groupBy: "status", metrics: [{ id: "m", field: "id", agg: "count" }] }],
    reportOverrides: [{ id: "evm", label: "Earned Value", hidden: false }],
    contentPages: [{ id: "p1", name: "Exec", componentIds: ["report:evm"] }],
  });

  const snap = buildSnapshot(getSettings());
  assert.equal(snap.settings.customReports!.length, 1);
  assert.equal(snap.settings.customReports![0]!.id, "r1");
  assert.equal(snap.settings.reportOverrides!.length, 1);
  assert.equal(snap.settings.contentPages![0]!.name, "Exec");

  // Wipe, then restore from the snapshot — the bespoke defs come back.
  updateSettings({ customReports: [], reportOverrides: [], contentPages: [] });
  assert.equal(getSettings().customReports.length, 0);

  const { patch, warnings } = applySnapshot(snap);
  updateSettings(patch);
  assert.equal(getSettings().customReports[0]!.id, "r1");
  assert.equal(getSettings().contentPages[0]!.componentIds[0], "report:evm");
  assert.equal(warnings.filter((w) => /customReports|reportOverrides|contentPages/.test(w)).length, 0);

  updateSettings({ customReports: [], reportOverrides: [], contentPages: [] });
});

test("drift guard: the backup captures EVERY settings key except the secret-bearing deny-list", () => {
  // "Keep your JSON safe — that's your total config": a new settings knob must either travel in the backup
  // or be a deliberately-excluded secret. It can never be silently dropped. captured ∪ excluded == all keys.
  const captured = new Set(SNAPSHOT_KEYS);
  const union = new Set([...captured, ...EXCLUDED_KEYS]);
  assert.deepEqual([...union].sort(), [...CLASSIFIED_KEYS].sort(), "every settings key is either captured or explicitly excluded");
  // The two sets are disjoint — a key is captured XOR excluded, never both.
  for (const k of EXCLUDED_KEYS) assert.equal(captured.has(k), false, `secret-bearing "${k}" must not be captured`);
  // The deny-list is exactly the secret/credential/signed-grant keys (guards against an accidental widening).
  assert.deepEqual([...EXCLUDED_KEYS].sort(),
    ["capabilityStates", "federatedPeers", "selfHost", "webhooks", "workflowAcceptances"]);
});

test("restore never writes back a secret-bearing key, even if an old snapshot carries one", () => {
  const tainted = {
    schema: "omniproject/config-snapshot", version: 1, createdAt: "2026-07-17T00:00:00.000Z",
    settings: { branding: null, webhooks: [{ id: "w", url: "https://evil.example", secret: "leaked", active: true }] },
  };
  const { patch, warnings } = applySnapshot(tainted);
  assert.equal("webhooks" in patch, false, "a secret-bearing key is never restored");
  assert.ok(warnings.some((w) => /secret-bearing setting "webhooks"/.test(w)));
});
