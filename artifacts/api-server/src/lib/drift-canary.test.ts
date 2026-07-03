import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  diffSnapshots,
  runDriftCanary,
  recentDriftFindings,
  __resetDriftCanaryState,
  driftCanaryIntervalHours,
  startDriftCanaryScheduler,
  __stopDriftCanaryScheduler,
  type CanarySnapshot,
} from "./drift-canary";
import type { Broker, VerifyReport } from "../broker/types";

/**
 * Drift canary: diffs the broker's read-only verify probe (and, where supported,
 * describeFields) between runs and alerts only on a TRANSITION — a previously-passing
 * action failing, or a previously-enumerated field disappearing — never on the raw
 * first-run state (that's just the baseline).
 */
afterEach(() => {
  __resetDriftCanaryState();
  __stopDriftCanaryScheduler();
  delete process.env["DRIFT_CANARY_INTERVAL_HOURS"];
});

const snap = (actions: CanarySnapshot["actions"], fields?: CanarySnapshot["fields"]): CanarySnapshot => ({
  at: 0,
  actions,
  ...(fields ? { fields } : {}),
});

test("no prior snapshot ⇒ no findings (first run is just the baseline)", () => {
  assert.deepEqual(diffSnapshots(null, snap({ list_projects: { ok: true, status: 200, note: null } })), []);
});

test("an action that was passing and now fails is flagged action_broke", () => {
  const prev = snap({ list_projects: { ok: true, status: 200, note: null } });
  const next = snap({ list_projects: { ok: false, status: 500, note: "boom" } });
  const findings = diffSnapshots(prev, next);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, "action_broke");
  assert.equal(findings[0]!.subject, "list_projects");
  assert.match(findings[0]!.detail, /list_projects/);
  assert.match(findings[0]!.detail, /500/);
});

test("an action that was failing and is now passing is flagged action_recovered", () => {
  const prev = snap({ list_projects: { ok: false, status: 500, note: "boom" } });
  const next = snap({ list_projects: { ok: true, status: 200, note: null } });
  const findings = diffSnapshots(prev, next);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, "action_recovered");
});

test("an unchanged action produces no findings", () => {
  const a = { ok: true, status: 200, note: null };
  assert.deepEqual(diffSnapshots(snap({ list_projects: a }), snap({ list_projects: { ...a } })), []);
});

test("a field that was known and is now missing is flagged field_disappeared", () => {
  const prev = snap({}, { known: ["dueDate"], unknown: [], missing: [] });
  const next = snap({}, { known: [], unknown: [], missing: ["dueDate"] });
  const findings = diffSnapshots(prev, next);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, "field_disappeared");
  assert.equal(findings[0]!.subject, "dueDate");
});

test("a field that is newly missing but was NEVER known is not flagged (nothing to regress from)", () => {
  const prev = snap({}, { known: [], unknown: [], missing: ["storyPoints"] });
  const next = snap({}, { known: [], unknown: [], missing: ["storyPoints", "dueDate"] });
  assert.deepEqual(diffSnapshots(prev, next), []);
});

test("a newly-unknown (custom) field is not flagged — that's new data, not breakage", () => {
  const prev = snap({}, { known: ["dueDate"], unknown: [], missing: [] });
  const next = snap({}, { known: ["dueDate"], unknown: ["custom_field_1"], missing: [] });
  assert.deepEqual(diffSnapshots(prev, next), []);
});

function report(actions: Array<{ name: string; ok: boolean; status: number; note?: string | null }>): VerifyReport {
  return { ok: actions.every((a) => a.ok), actions: actions.map((a) => ({ ms: 1, note: null, ...a })) };
}

test("runDriftCanary: first run establishes the baseline and dispatches nothing", async () => {
  const broker = { verify: async () => report([{ name: "list_projects", ok: true, status: 200 }]) } as unknown as Broker;
  let published = 0;
  const result = await runDriftCanary({ broker, now: 1000, publish: () => { published++; } });
  assert.equal(result.dispatched, false);
  assert.deepEqual(result.findings, []);
  assert.equal(published, 0);
});

test("runDriftCanary: a regression on the second run dispatches an integration_drift alert", async () => {
  let ok = true;
  const broker = { verify: async () => report([{ name: "list_projects", ok, status: ok ? 200 : 503, note: ok ? null : "unreachable" }]) } as unknown as Broker;
  await runDriftCanary({ broker, now: 1000 });
  ok = false;
  const published: Array<{ kind: string; title: string; body: string }> = [];
  const result = await runDriftCanary({ broker, now: 2000, publish: (n) => { published.push(n); } });
  assert.equal(result.dispatched, true);
  assert.equal(published.length, 1);
  assert.equal(published[0]!.kind, "integration_drift");
  assert.match(published[0]!.body, /list_projects/);
  assert.equal(result.findings[0]!.kind, "action_broke");
});

test("runDriftCanary: a recovery-only run does not dispatch (not alert-worthy)", async () => {
  let ok = false;
  const broker = { verify: async () => report([{ name: "list_projects", ok, status: ok ? 200 : 503 }]) } as unknown as Broker;
  await runDriftCanary({ broker, now: 1000 });
  ok = true;
  let published = 0;
  const result = await runDriftCanary({ broker, now: 2000, publish: () => { published++; } });
  assert.equal(result.dispatched, false);
  assert.equal(published, 0);
  assert.equal(result.findings[0]!.kind, "action_recovered");
});

test("runDriftCanary: findings land in the recent-findings ring", async () => {
  let ok = true;
  const broker = { verify: async () => report([{ name: "list_projects", ok, status: ok ? 200 : 500 }]) } as unknown as Broker;
  await runDriftCanary({ broker, now: 1000 });
  ok = false;
  await runDriftCanary({ broker, now: 2000, publish: () => {} });
  const ring = recentDriftFindings();
  assert.equal(ring.length, 1);
  assert.equal(ring[0]!.kind, "action_broke");
});

test("runDriftCanary: a broker without describeFields is unaffected (field arm just doesn't run)", async () => {
  const broker = { verify: async () => report([{ name: "list_projects", ok: true, status: 200 }]) } as unknown as Broker;
  const result = await runDriftCanary({ broker, now: 1000 });
  assert.equal(result.snapshot.fields, undefined);
});

test("runDriftCanary: describeFields drift is diffed when the broker supports it", async () => {
  let hasField = true;
  const broker = {
    verify: async () => report([{ name: "list_projects", ok: true, status: 200 }]),
    describeFields: async () => (hasField ? [{ key: "dueDate" }] : []),
  } as unknown as Broker;
  await runDriftCanary({ broker, now: 1000 });
  hasField = false;
  const published: Array<{ kind: string; body: string }> = [];
  const result = await runDriftCanary({ broker, now: 2000, publish: (n) => { published.push(n); } });
  assert.equal(result.dispatched, true);
  assert.match(published[0]!.body, /dueDate/);
});

test("runDriftCanary: injectable snapshot storage is used instead of the module-level default", async () => {
  const broker = { verify: async () => report([{ name: "list_projects", ok: false, status: 500 }]) } as unknown as Broker;
  let stored: CanarySnapshot | null = null;
  await runDriftCanary({
    broker, now: 1000,
    getSnapshot: () => snap({ list_projects: { ok: true, status: 200, note: null } }),
    saveSnapshot: (s) => { stored = s; },
  });
  assert.ok(stored);
  // The module-level (default) baseline was never touched by the injected-storage run.
  const direct = await runDriftCanary({ broker, now: 2000 });
  assert.deepEqual(direct.findings, []); // first run against the REAL module state, still a baseline
});

test("driftCanaryIntervalHours: defaults to 6, respects env, falls back on garbage", () => {
  assert.equal(driftCanaryIntervalHours(), 6);
  process.env["DRIFT_CANARY_INTERVAL_HOURS"] = "12";
  assert.equal(driftCanaryIntervalHours(), 12);
  process.env["DRIFT_CANARY_INTERVAL_HOURS"] = "not-a-number";
  assert.equal(driftCanaryIntervalHours(), 6);
});

test("startDriftCanaryScheduler: 0 hours opts out; a positive value starts the timer", () => {
  process.env["DRIFT_CANARY_INTERVAL_HOURS"] = "0";
  assert.equal(startDriftCanaryScheduler(async () => {}), false);
  process.env["DRIFT_CANARY_INTERVAL_HOURS"] = "1";
  assert.equal(startDriftCanaryScheduler(async () => {}), true);
});
