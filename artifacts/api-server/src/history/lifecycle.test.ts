import { test } from "node:test";
import assert from "node:assert/strict";
import { updateSettings } from "../lib/settings";
import type { RetentionSource, DisposalResult } from "./retention";
import {
  holdKey,
  isUnderLegalHold,
  disposalCutoff,
  disposeExpired,
  eraseEntityHistory,
  LegalHoldError,
  RetentionUnsupportedError,
} from "./lifecycle";

const NOW = Date.parse("2026-07-01T00:00:00.000Z");

/** A fake source that records calls; disposal/erasure toggle on to test the "unsupported" path. */
function fakeSource(opts: { dispose?: boolean; erase?: boolean } = {}): {
  source: RetentionSource;
  disposeCalls: Array<{ cutoff: string; heldKeys: readonly string[] }>;
  eraseCalls: Array<{ entity: string; id: string }>;
} {
  const disposeCalls: Array<{ cutoff: string; heldKeys: readonly string[] }> = [];
  const eraseCalls: Array<{ entity: string; id: string }> = [];
  const base: RetentionSource = {
    readSnapshots: async () => [],
    readJournal: async () => [],
    appendJournal: async () => {},
    writeSnapshot: async () => {},
    lastSnapshotAt: async () => null,
  };
  const source: RetentionSource = { ...base };
  if (opts.dispose !== false) {
    source.disposeOlderThan = async (cutoff, o): Promise<DisposalResult> => {
      disposeCalls.push({ cutoff, heldKeys: o?.heldKeys ?? [] });
      return { snapshots: 3, journal: 7 };
    };
  }
  if (opts.erase !== false) {
    source.eraseEntity = async (entity, id): Promise<DisposalResult> => {
      eraseCalls.push({ entity, id });
      return { snapshots: 1, journal: 4 };
    };
  }
  return { source, disposeCalls, eraseCalls };
}

test("disposalCutoff is null for infinite retention and an ISO cutoff for a window", () => {
  assert.equal(disposalCutoff(null, NOW), null);
  assert.equal(disposalCutoff(undefined, NOW), null);
  assert.equal(disposalCutoff(0, NOW), null);
  assert.equal(disposalCutoff(30, NOW), new Date(NOW - 30 * 86_400_000).toISOString());
});

test("legal hold is read from settings", () => {
  updateSettings({ historyRetention: { orgDefault: { kind: "manual" }, programme: {}, project: {}, legalHolds: [holdKey("project", "p-9")] } });
  assert.equal(isUnderLegalHold("project", "p-9"), true);
  assert.equal(isUnderLegalHold("project", "p-8"), false);
});

test("disposeExpired is a no-op under infinite retention (never a silent prune)", async () => {
  updateSettings({ historyRetention: { orgDefault: { kind: "manual" }, programme: {}, project: {}, retentionDays: null, legalHolds: [] } });
  const { source, disposeCalls } = fakeSource();
  const run = await disposeExpired(source, NOW);
  assert.equal(run.disposed, false);
  assert.equal(run.cutoff, null);
  assert.equal(disposeCalls.length, 0);
});

test("disposeExpired prunes older-than-window and forwards the legal holds", async () => {
  const holds = [holdKey("project", "keep-me")];
  updateSettings({ historyRetention: { orgDefault: { kind: "manual" }, programme: {}, project: {}, retentionDays: 90, legalHolds: holds } });
  const { source, disposeCalls } = fakeSource();
  const run = await disposeExpired(source, NOW);
  assert.equal(run.disposed, true);
  assert.equal(run.cutoff, new Date(NOW - 90 * 86_400_000).toISOString());
  assert.equal(run.snapshots, 3);
  assert.equal(run.journal, 7);
  assert.equal(disposeCalls.length, 1);
  assert.deepEqual([...disposeCalls[0]!.heldKeys], holds);
});

test("disposeExpired throws RetentionUnsupportedError when the source can't dispose", async () => {
  updateSettings({ historyRetention: { orgDefault: { kind: "manual" }, programme: {}, project: {}, retentionDays: 30, legalHolds: [] } });
  const { source } = fakeSource({ dispose: false });
  await assert.rejects(() => disposeExpired(source, NOW), RetentionUnsupportedError);
});

test("eraseEntityHistory deletes an entity's history when not held", async () => {
  updateSettings({ historyRetention: { orgDefault: { kind: "manual" }, programme: {}, project: {}, legalHolds: [] } });
  const { source, eraseCalls } = fakeSource();
  const r = await eraseEntityHistory(source, "project", "p-1");
  assert.deepEqual(r, { snapshots: 1, journal: 4 });
  assert.deepEqual(eraseCalls, [{ entity: "project", id: "p-1" }]);
});

test("eraseEntityHistory refuses a legally-held entity (hold wins over erasure)", async () => {
  updateSettings({ historyRetention: { orgDefault: { kind: "manual" }, programme: {}, project: {}, legalHolds: [holdKey("project", "p-hold")] } });
  const { source, eraseCalls } = fakeSource();
  await assert.rejects(() => eraseEntityHistory(source, "project", "p-hold"), LegalHoldError);
  assert.equal(eraseCalls.length, 0); // never dispatched below the seam
});

test("eraseEntityHistory throws RetentionUnsupportedError when the source can't erase", async () => {
  updateSettings({ historyRetention: { orgDefault: { kind: "manual" }, programme: {}, project: {}, legalHolds: [] } });
  const { source } = fakeSource({ erase: false });
  await assert.rejects(() => eraseEntityHistory(source, "project", "p-2"), RetentionUnsupportedError);
});
