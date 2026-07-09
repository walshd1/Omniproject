import { test } from "node:test";
import assert from "node:assert/strict";
import { foldTo, materialiseSnapshot, snapshotsAtBoundaries } from "./snapshot";
import type { HistoryEntry } from "./types";

const entry = (field: string, newValue: unknown, changedAt: string): HistoryEntry => ({
  entity: "issue", id: "1", field, oldValue: null, newValue, changedAt, changedBy: null, txnId: changedAt,
});

const journal: HistoryEntry[] = [
  entry("status", "todo", "2026-01-01T00:00:00Z"),
  entry("status", "doing", "2026-02-01T00:00:00Z"),
  entry("status", "done", "2026-03-01T00:00:00Z"),
  entry("percentWorkComplete", 50, "2026-02-01T00:00:00Z"),
];

test("foldTo applies only entries at or before the as-of, in time order", () => {
  assert.equal(foldTo(journal, "2026-01-15T00:00:00Z")["status"], "todo");
  assert.equal(foldTo(journal, "2026-02-15T00:00:00Z")["status"], "doing");
  assert.equal(foldTo(journal, "2026-02-15T00:00:00Z")["percentWorkComplete"], 50);
  assert.equal(foldTo(journal, "2026-03-15T00:00:00Z")["status"], "done");
});

test("foldTo folds over a base state", () => {
  const values = foldTo(journal, "2026-01-15T00:00:00Z", { title: "T" });
  assert.equal(values["title"], "T");
  assert.equal(values["status"], "todo");
});

test("materialiseSnapshot carries the as-of + replayed provenance", () => {
  const snap = materialiseSnapshot("issue", "1", journal, "2026-02-15T00:00:00Z");
  assert.equal(snap.asOf, "2026-02-15T00:00:00Z");
  assert.equal(snap.provenance, "replayed");
  assert.equal(snap.values["status"], "doing");
});

test("snapshotsAtBoundaries yields a snapshot per boundary", () => {
  const snaps = snapshotsAtBoundaries("issue", "1", journal, ["2026-01-15T00:00:00Z", "2026-03-15T00:00:00Z"]);
  assert.equal(snaps.length, 2);
  assert.equal(snaps[0]!.values["status"], "todo");
  assert.equal(snaps[1]!.values["status"], "done");
});
