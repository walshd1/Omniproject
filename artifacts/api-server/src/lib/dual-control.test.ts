import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { requiresDualControl, propose, approve, reject, listProposals, registerExecutor, __resetDualControl } from "./dual-control";

afterEach(async () => { delete process.env["DUAL_CONTROL_ACTIONS"]; await __resetDualControl(); });

const NOW = "2026-06-28T00:00:00Z";

test("off by default; on when listed", () => {
  assert.equal(requiresDualControl("key.revoke"), false);
  process.env["DUAL_CONTROL_ACTIONS"] = "key.revoke, maintenance.engage";
  assert.equal(requiresDualControl("key.revoke"), true);
  assert.equal(requiresDualControl("something.else"), false);
});

test("four-eyes: a different admin must approve; the proposer can't", async () => {
  let applied: unknown = null;
  registerExecutor("test.action", (params) => { applied = params; });
  const p = await propose("test.action", { x: 1 }, { sub: "alice", email: "a@co" }, NOW);
  assert.equal((await listProposals()).length, 1);

  // Proposer approving themselves is refused; nothing executes.
  const self = await approve(p.id, { sub: "alice" }, NOW);
  assert.equal(self.ok, false);
  assert.match(self.error!, /different admin/i);
  assert.equal(applied, null);

  // A different admin approves → the executor runs with the proposal's params.
  const other = await approve(p.id, { sub: "bob" }, NOW);
  assert.equal(other.ok, true);
  assert.deepEqual(applied, { x: 1 });
  assert.equal((await listProposals()).length, 0); // no longer pending
});

test("a missing executor is reported, not silently dropped", async () => {
  const p = await propose("no.executor", {}, { sub: "alice" }, NOW);
  const r = await approve(p.id, { sub: "bob" }, NOW);
  assert.equal(r.ok, false);
  assert.match(r.error!, /executor/i);
});

test("reject removes a proposal from the queue without executing", async () => {
  let ran = false;
  registerExecutor("rej.action", () => { ran = true; });
  const p = await propose("rej.action", {}, { sub: "alice" }, NOW);
  const r = await reject(p.id, { sub: "bob" }, NOW);
  assert.equal(r.ok, true);
  assert.equal(ran, false);
  assert.equal((await listProposals()).length, 0);
  // A second decision on the same proposal is a no-op.
  assert.equal((await approve(p.id, { sub: "carol" }, NOW)).ok, false);
});
