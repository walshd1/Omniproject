import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { OmniStore } from "./omnistore";
import { BuiltinBroker } from "./builtin-broker";
import { structuralConformance, runReadConformance } from "../conformance";
import type { ActorContext } from "../types";

/**
 * OmniStore — the stateful, event-sourced, encrypted, tamper-evident, portable system-of-record.
 * Proves it is a first-class `BuiltinStore` (passes conformance via BuiltinBroker), preserves
 * optimistic concurrency, keeps its chain provably intact, and moves between instances losslessly.
 */
const root = () => crypto.createHash("sha256").update("store-test-root").digest();
const ctx: ActorContext = { sub: "founder", email: "f@x.test", role: "admin" };
const fresh = () => new OmniStore(root());

test("passes structural + read conformance via BuiltinBroker — a first-class Broker", async () => {
  const b = new BuiltinBroker(fresh());
  const p = await b.createProject(ctx, { name: "Seed" });
  await b.writeIssue(ctx, "create", { projectId: p.id, title: "Seed issue", status: "todo" });
  const structural = structuralConformance(b);
  assert.ok(structural.ok, `structural: ${JSON.stringify(structural.checks.filter((c) => !c.ok))}`);
  const read = await runReadConformance(b, ctx);
  assert.ok(read.ok, `read: ${JSON.stringify(read.checks.filter((c) => !c.ok))}`);
  assert.equal(b.kind, "builtin:omnistore");
});

test("CRUD round-trips through the projection", async () => {
  const s = fresh();
  const p = await s.createProject({ name: "Alpha" });
  const i = await s.createIssue({ projectId: p.id, title: "First", status: "todo" });
  assert.equal((await s.getProject(p.id))?.name, "Alpha");
  assert.equal((await s.listIssues(p.id)).length, 1);
  await s.updateIssue({ projectId: p.id, issueId: i.id, status: "done" });
  const done = await s.getProject(p.id);
  assert.equal(done?.issueCount, 1);
  assert.equal(done?.completedCount, 1); // recount followed the projection
});

test("optimistic concurrency: a stale expectedVersion returns a conflict, not a write", async () => {
  const s = fresh();
  const p = await s.createProject({ name: "P" });
  const i = await s.createIssue({ projectId: p.id, title: "T" });
  const r = await s.updateIssue({ projectId: p.id, issueId: i.id, status: "done", expectedVersion: 99 });
  assert.deepEqual(r, { conflict: 1 });
  assert.equal((await s.getIssue(p.id, i.id))?.status, i.status); // unchanged
});

test("the log stays provably intact across writes", async () => {
  const s = fresh();
  const p = await s.createProject({ name: "P" });
  await s.createIssue({ projectId: p.id, title: "T" });
  assert.deepEqual(s.verifyIntegrity(), { ok: true });
});

test("at-rest seal → openSealed rebuilds byte-identical state (deterministic replay)", async () => {
  const s = fresh();
  const p = await s.createProject({ name: "Alpha" });
  await s.createIssue({ projectId: p.id, title: "One", status: "todo" });
  await s.createIssue({ projectId: p.id, title: "Two", status: "done" });
  const token = s.sealed();

  const reopened = OmniStore.openSealed(token, root());
  assert.deepEqual(await reopened.listProjects(), await s.listProjects());
  assert.deepEqual(await reopened.listIssues(p.id), await s.listIssues(p.id));
  assert.deepEqual(reopened.verifyIntegrity(), { ok: true });
});

test("portable bundle moves the store between instances (sealed log + travelling root key)", async () => {
  const source = fresh();
  const p = await source.createProject({ name: "Portable" });
  await source.createIssue({ projectId: p.id, title: "Carry me", status: "todo" });

  const { bundle, rootKey } = source.exportBundle();
  // Target instance receives ONLY the bundle + the key — no shared memory.
  const target = OmniStore.importBundle(bundle, rootKey);
  assert.deepEqual(await target.listProjects(), await source.listProjects());
  assert.deepEqual(await target.listIssues(p.id), await source.listIssues(p.id));
  assert.deepEqual(target.verifyIntegrity(), { ok: true });

  // A wrong key can't decrypt/adopt it — fail-closed.
  assert.throws(() => OmniStore.importBundle(bundle, crypto.randomBytes(32).toString("base64")));

  // The target can keep writing on its own chain, still intact.
  await target.createIssue({ projectId: p.id, title: "Added after move", status: "todo" });
  assert.equal((await target.listIssues(p.id)).length, 2);
  assert.deepEqual(target.verifyIntegrity(), { ok: true });
});
