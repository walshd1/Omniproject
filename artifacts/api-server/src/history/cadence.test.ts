import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RETENTION_CONFIG,
  dueForSnapshot,
  isValidCadence,
  resolveCadence,
  type HistoryRetentionConfig,
} from "./cadence";

test("resolveCadence: project override ▸ programme override ▸ org default (most-specific wins)", () => {
  const config: HistoryRetentionConfig = {
    orgDefault: { kind: "interval", everyHours: 24 },
    programme: { P1: { kind: "interval", everyHours: 6 } },
    project: { X1: { kind: "onWrite" } },
  };
  assert.deepEqual(resolveCadence(config, {}), { kind: "interval", everyHours: 24 });
  assert.deepEqual(resolveCadence(config, { programmeId: "P1" }), { kind: "interval", everyHours: 6 });
  assert.deepEqual(resolveCadence(config, { programmeId: "P1", projectId: "X1" }), { kind: "onWrite" });
});

test("resolveCadence falls back to org default for an unknown scope", () => {
  assert.deepEqual(resolveCadence(DEFAULT_RETENTION_CONFIG, { projectId: "nope" }), { kind: "interval", everyHours: 24 });
});

test("dueForSnapshot: onWrite always, manual never, interval on elapsed", () => {
  assert.equal(dueForSnapshot("2026-01-01T00:00:00Z", { kind: "onWrite" }, "2026-01-01T00:00:01Z"), true);
  assert.equal(dueForSnapshot(null, { kind: "manual" }, "2026-01-01T00:00:00Z"), false);
  // interval 24h: not due after 1h, due after 25h, always due with no prior snapshot
  assert.equal(dueForSnapshot("2026-01-01T00:00:00Z", { kind: "interval", everyHours: 24 }, "2026-01-01T01:00:00Z"), false);
  assert.equal(dueForSnapshot("2026-01-01T00:00:00Z", { kind: "interval", everyHours: 24 }, "2026-01-02T01:00:00Z"), true);
  assert.equal(dueForSnapshot(null, { kind: "interval", everyHours: 24 }, "2026-01-01T00:00:00Z"), true);
});

test("isValidCadence rejects malformed shapes and non-positive/oversized intervals", () => {
  assert.equal(isValidCadence({ kind: "onWrite" }), true);
  assert.equal(isValidCadence({ kind: "manual" }), true);
  assert.equal(isValidCadence({ kind: "interval", everyHours: 12 }), true);
  assert.equal(isValidCadence({ kind: "interval", everyHours: 0 }), false);
  assert.equal(isValidCadence({ kind: "interval", everyHours: -1 }), false);
  assert.equal(isValidCadence({ kind: "bogus" }), false);
  assert.equal(isValidCadence(null), false);
});
