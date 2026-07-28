import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { wrapWithRetentionCapture, CAPTURED_WRITES } from "./retention-capture";
import { GUARDED_WRITES } from "./autonomous-guard";
import { registerRetentionProvider, resetRetentionProvider, type RetentionSource } from "../history/retention";
import type { EntitySnapshot, HistoryEntry } from "../history/types";
import type { Broker } from "./types";

/** An in-memory retention source with call counters, so a test can assert what capture drove. */
function memorySource() {
  const journal: HistoryEntry[] = [];
  const snapshots: EntitySnapshot[] = [];
  const calls = { appendJournal: 0, writeSnapshot: 0, lastSnapshotAt: 0 };
  const source: RetentionSource = {
    async readSnapshots() { return snapshots; },
    async readJournal() { return journal; },
    async appendJournal(entries) { calls.appendJournal++; journal.push(...entries); },
    async writeSnapshot(s) { calls.writeSnapshot++; snapshots.push(s); },
    async lastSnapshotAt() { calls.lastSnapshotAt++; return null; },
  };
  return { source, journal, snapshots, calls };
}

/** A minimal fake broker exposing a few write methods; each returns its post-image. */
function fakeBroker() {
  return {
    async updateProject(_ctx: unknown, id: string, patch: Record<string, unknown>) { return { id, ...patch }; },
    async writeIssue(_ctx: unknown, _op: string, input: Record<string, unknown>) { return { id: input["issueId"] ?? "i1", ...input }; },
    async addTaskComment(_ctx: unknown, _id: string, _c: Record<string, unknown>) { return { ok: true }; },
  } as unknown as Broker;
}

/** Call broker methods without fighting the concrete Broker signatures. */
interface BrokerCalls {
  updateProject(...a: unknown[]): Promise<unknown>;
  writeIssue(...a: unknown[]): Promise<unknown>;
  addTaskComment(...a: unknown[]): Promise<unknown>;
}
const asCallable = (b: Broker) => b as unknown as BrokerCalls;

const ctx = { sub: "u1" };
const OPTS = { now: () => new Date("2026-01-01T00:00:00.000Z"), uuid: () => "txn-1" };
const settle = () => new Promise((r) => setTimeout(r, 5)); // let the fire-and-forget capture microtask run

afterEach(() => resetRetentionProvider());

test("(a) captures a write to the durable store when a retention source is configured", async () => {
  const mem = memorySource();
  registerRetentionProvider(() => mem.source);
  const b = asCallable(wrapWithRetentionCapture(fakeBroker(), OPTS));
  const result = await b.updateProject(ctx, "p1", { status: "green", health: 3 });
  assert.deepEqual(result, { id: "p1", status: "green", health: 3 }); // the real write result passes through unchanged
  await settle();
  assert.ok(mem.journal.length > 0, "journal captured");
  assert.equal(mem.snapshots.length, 1, "snapshot materialised (no prior snapshot + default cadence ⇒ due)");
  assert.equal(mem.snapshots[0]!.entity, "project");
  assert.equal(mem.snapshots[0]!.id, "p1");
});

test("(b) inert when no source is configured — write passes through, nothing captured, no throw", async () => {
  resetRetentionProvider();
  const mem = memorySource(); // deliberately NOT registered
  const b = asCallable(wrapWithRetentionCapture(fakeBroker(), OPTS));
  const result = await b.updateProject(ctx, "p1", { status: "green" });
  assert.deepEqual(result, { id: "p1", status: "green" });
  await settle();
  assert.equal(mem.calls.appendJournal, 0);
  assert.equal(mem.calls.writeSnapshot, 0);
});

test("(c) a capture failure never fails the write", async () => {
  const failing: RetentionSource = {
    async readSnapshots() { return []; },
    async readJournal() { return []; },
    async appendJournal() { throw new Error("history store down"); },
    async writeSnapshot() {},
    async lastSnapshotAt() { return null; },
  };
  registerRetentionProvider(() => failing);
  const b = asCallable(wrapWithRetentionCapture(fakeBroker(), OPTS));
  // The write resolves with its real result even though the capture's appendJournal rejects (swallowed).
  const result = await b.updateProject(ctx, "p1", { status: "amber" });
  assert.deepEqual(result, { id: "p1", status: "amber" });
  await settle();
});

test("(d) captures exactly once per write (no double-capture across the wrap points)", async () => {
  const mem = memorySource();
  registerRetentionProvider(() => mem.source);
  const b = asCallable(wrapWithRetentionCapture(fakeBroker(), OPTS));
  await b.writeIssue(ctx, "update", { issueId: "i1", projectId: "p1", points: 5 });
  await settle();
  assert.equal(mem.calls.appendJournal, 1);
});

test("(e) an explicit no-capture write (addTaskComment) records nothing", async () => {
  const mem = memorySource();
  registerRetentionProvider(() => mem.source);
  const b = asCallable(wrapWithRetentionCapture(fakeBroker(), OPTS));
  await b.addTaskComment(ctx, "t1", { text: "hi" });
  await settle();
  assert.equal(mem.calls.appendJournal, 0);
});

test("(f) parity: every guarded broker write method has a capture classifier", () => {
  assert.deepEqual([...CAPTURED_WRITES].sort(), [...GUARDED_WRITES].sort());
});
