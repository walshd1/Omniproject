import { test } from "node:test";
import assert from "node:assert/strict";
import {
  keyResultAttainment, goalProgress, sanitizeGoalWrite, sanitizeKeyResults,
  sanitizeCheckInWrite, applyCheckIn, GOAL_LIMITS,
  sanitizeGoalLink, addGoalLink, removeGoalLink, goalLinkKey,
  dueGoalCheckins, advanceGoalCadence, runGoalCheckinSweep, goalCheckinFireKey,
  makeGoalId, parseGoalId, newGoalRow, mergeGoalRow, goalMeta, GoalError, type KeyResult, type Goal,
} from "./goal";
import type { ActorContext } from "../broker/types";

/** Goal/OKR model: key-result attainment, progress roll-up, write sanitising, ids, and the row lifecycle. */

const ctx: ActorContext = { sub: "u1", name: "Ada", email: "ada@x.io" } as ActorContext;
const kr = (over: Partial<KeyResult>): KeyResult => ({ id: "k", label: "KR", startValue: 0, target: 100, current: 0, ...over });

test("keyResultAttainment: 0 at start, 100 at target, clamped, sign-symmetric for decreasing targets", () => {
  assert.equal(keyResultAttainment(kr({ current: 0 })), 0);
  assert.equal(keyResultAttainment(kr({ current: 50 })), 50);
  assert.equal(keyResultAttainment(kr({ current: 100 })), 100);
  assert.equal(keyResultAttainment(kr({ current: 150 })), 100); // clamp above target
  assert.equal(keyResultAttainment(kr({ current: -10 })), 0); // clamp below start
  // A "reduce" goal: 200 → 100, currently 150 = halfway.
  assert.equal(keyResultAttainment(kr({ startValue: 200, target: 100, current: 150 })), 50);
  // start == target: met only when reached.
  assert.equal(keyResultAttainment(kr({ startValue: 5, target: 5, current: 5 })), 100);
  assert.equal(keyResultAttainment(kr({ startValue: 5, target: 5, current: 4 })), 0);
});

test("goalProgress: mean of key-result attainment, 0 when none", () => {
  assert.equal(goalProgress([]), 0);
  assert.equal(goalProgress([kr({ current: 100 }), kr({ current: 0 })]), 50);
  assert.equal(goalProgress([kr({ current: 100 }), kr({ current: 50 }), kr({ current: 50 })]), 67);
});

test("sanitizeGoalWrite: requires a title, defaults status/storage, keeps clean fields", () => {
  const w = sanitizeGoalWrite({ title: "  Grow revenue  ", description: "FY26", keyResults: [{ label: "ARR", target: 1_000_000, current: 250_000, unit: "$" }] });
  assert.equal(w.title, "Grow revenue");
  assert.equal(w.status, "on_track");
  assert.equal(w.storage, "user");
  assert.equal(w.keyResults[0]!.id, "kr-1"); // id stamped when absent
  assert.equal(w.keyResults[0]!.unit, "$");
  assert.throws(() => sanitizeGoalWrite({ title: "" }), (e) => e instanceof GoalError);
  assert.throws(() => sanitizeGoalWrite({ title: "x", keyResults: [{ target: 1 }] }), (e) => e instanceof GoalError && /label/.test((e as Error).message));
  assert.throws(() => sanitizeGoalWrite({ title: "x", storage: "project" }), (e) => e instanceof GoalError && /projectId/.test((e as Error).message));
});

test("sanitizeKeyResults: bounds the count and rejects a non-array", () => {
  assert.throws(() => sanitizeKeyResults({}), (e) => e instanceof GoalError);
  const many = Array.from({ length: 21 }, (_, i) => ({ label: `k${i}`, target: 1 }));
  assert.throws(() => sanitizeKeyResults(many), (e) => e instanceof GoalError && /at most/.test((e as Error).message));
});

test("ids are self-describing and round-trip", () => {
  const id = makeGoalId("project", "abc", "P1");
  assert.match(id, /^project~/);
  assert.deepEqual(parseGoalId(id), { storage: "project", projectId: "P1", localId: "abc" });
  assert.equal(parseGoalId("sidecar~x~y"), null); // not a JSON target
});

test("newGoalRow stamps owner + derives progress; mergeGoalRow bumps version + recomputes", () => {
  const w = sanitizeGoalWrite({ title: "Ship", keyResults: [{ label: "beta users", target: 100, current: 40 }] });
  const row = newGoalRow(makeGoalId("user", "g1"), w, ctx, "2026-01-01T00:00:00Z");
  assert.equal(row.ownerSub, "u1");
  assert.equal(row.progressPct, 40);
  assert.equal(row.version, 1);
  assert.equal(goalMeta(row).keyResultCount, 1);

  const w2 = sanitizeGoalWrite({ title: "Ship", keyResults: [{ label: "beta users", target: 100, current: 90 }] });
  const merged = mergeGoalRow(row, w2, ctx, "2026-02-01T00:00:00Z");
  assert.equal(merged.version, 2);
  assert.equal(merged.progressPct, 90);
  assert.equal(merged.createdAt, row.createdAt); // preserved
});

test("sanitizeCheckInWrite: caps the note, keeps a valid status, coerces numeric KR values", () => {
  const ci = sanitizeCheckInWrite({ note: "  going well  ", status: "at_risk", krValues: { "kr-1": "60", "kr-2": 30, bad: "x" } });
  assert.equal(ci.note, "going well");
  assert.equal(ci.status, "at_risk");
  assert.deepEqual(ci.krValues, { "kr-1": 60, "kr-2": 30 }); // non-numeric dropped
  assert.equal(sanitizeCheckInWrite({}).status, undefined);
  assert.throws(() => sanitizeCheckInWrite({ krValues: [] }), (e) => e instanceof GoalError);
});

test("applyCheckIn: updates KR values, recomputes progress, sets status, appends bounded history", () => {
  const w = sanitizeGoalWrite({ title: "Adopt", keyResults: [{ id: "kr-1", label: "teams", target: 100, current: 0 }] });
  let row = newGoalRow(makeGoalId("user", "g"), w, ctx, "2026-01-01T00:00:00Z");
  row = applyCheckIn(row, sanitizeCheckInWrite({ note: "kickoff", status: "at_risk", krValues: { "kr-1": 40 } }), "ci-1", ctx, "2026-01-08T00:00:00Z");
  assert.equal(row.keyResults[0]!.current, 40);
  assert.equal(row.progressPct, 40);
  assert.equal(row.status, "at_risk");
  assert.equal(row.version, 2);
  assert.equal(row.checkins.length, 1);
  assert.deepEqual(row.checkins[0], { id: "ci-1", at: "2026-01-08T00:00:00Z", by: "ada@x.io", note: "kickoff", status: "at_risk", progressPct: 40, krValues: { "kr-1": 40 } });
  assert.equal(goalMeta(row).checkInCount, 1);
  assert.equal(goalMeta(row).lastCheckInAt, "2026-01-08T00:00:00Z");

  // History is bounded to the last maxCheckIns.
  for (let i = 0; i < GOAL_LIMITS.maxCheckIns + 5; i++) row = applyCheckIn(row, sanitizeCheckInWrite({ krValues: { "kr-1": i } }), `x-${i}`, ctx, "2026-02-01T00:00:00Z");
  assert.equal(row.checkins.length, GOAL_LIMITS.maxCheckIns);
});

test("goal links: sanitise, idempotent add, keyed remove", () => {
  const now = "2026-01-01T00:00:00Z";
  assert.throws(() => sanitizeGoalLink({ system: "jira" }, now), (e) => e instanceof GoalError); // missing refs
  const link = sanitizeGoalLink({ system: "jira", projectRef: "OMNI", itemRef: "OMNI-42", label: "Ship it" }, now);
  assert.equal(link.key, goalLinkKey("jira", "OMNI", "OMNI-42"));
  assert.equal(link.label, "Ship it");

  const w = sanitizeGoalWrite({ title: "G", keyResults: [] });
  let row = newGoalRow(makeGoalId("user", "g"), w, ctx, now);
  row = addGoalLink(row, link, ctx, now);
  assert.equal(row.links.length, 1);
  assert.equal(row.version, 2);
  assert.equal(goalMeta(row).linkCount, 1);

  // Re-linking the same item is a no-op (idempotent — same key, no version bump).
  const same = addGoalLink(row, sanitizeGoalLink({ system: "jira", projectRef: "OMNI", itemRef: "OMNI-42" }, now), ctx, now);
  assert.equal(same.links.length, 1);
  assert.equal(same.version, 2);

  const removed = removeGoalLink(row, link.key, ctx, now);
  assert.equal(removed.links.length, 0);
  assert.equal(removed.version, 3);
  // Removing an unknown key is a no-op (no version bump).
  assert.equal(removeGoalLink(row, "nope", ctx, now).version, row.version);
});

test("cadence seeds nextCheckInAt on create and advances it on check-in", () => {
  const w = sanitizeGoalWrite({ title: "Weekly review", cadence: "every week", keyResults: [{ id: "kr-1", label: "x", target: 1, current: 0 }] });
  assert.equal(w.cadence, "every week");
  const row = newGoalRow(makeGoalId("user", "g"), w, ctx, "2026-01-01T00:00:00Z");
  assert.match(row.nextCheckInAt ?? "", /^\d{4}-\d{2}-\d{2}$/);
  const first = row.nextCheckInAt!;
  // A check-in a fortnight later rolls the schedule forward past that date.
  const after = applyCheckIn(row, sanitizeCheckInWrite({ krValues: { "kr-1": 1 } }), "ci", ctx, "2026-01-15T00:00:00Z");
  assert.match(after.nextCheckInAt ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Date.parse(after.nextCheckInAt!) > Date.parse(first), "check-in advances the cadence");
});

test("dueGoalCheckins selects past-due, non-achieved, not-yet-fired goals", () => {
  const base: Goal = newGoalRow(makeGoalId("user", "g"), sanitizeGoalWrite({ title: "G", cadence: "every week", keyResults: [] }), ctx, "2026-01-01T00:00:00Z");
  const due: Goal = { ...base, id: "due", nextCheckInAt: "2026-01-01" };
  const future: Goal = { ...base, id: "future", nextCheckInAt: "2999-01-01" };
  const achieved: Goal = { ...base, id: "achieved", nextCheckInAt: "2026-01-01", status: "achieved" };
  const now = Date.parse("2026-06-01T00:00:00Z");
  const picked = dueGoalCheckins([due, future, achieved], now, () => false).map((g) => g.id);
  assert.deepEqual(picked, ["due"]);
  // A fired goal is skipped.
  assert.equal(dueGoalCheckins([due], now, (k) => k === goalCheckinFireKey(due)).length, 0);
});

test("advanceGoalCadence rolls forward (or clears when no cadence)", () => {
  const g: Goal = { ...newGoalRow(makeGoalId("user", "g"), sanitizeGoalWrite({ title: "G", cadence: "every week", keyResults: [] }), ctx, "2026-01-01T00:00:00Z"), nextCheckInAt: "2026-01-01" };
  assert.ok(Date.parse(advanceGoalCadence(g, "2026-06-01T00:00:00Z").nextCheckInAt!) > Date.parse("2026-06-01"));
  assert.equal(advanceGoalCadence({ ...g, cadence: null }, "2026-06-01T00:00:00Z").nextCheckInAt, null);
});

test("runGoalCheckinSweep nudges the owner once and reschedules", async () => {
  const base = newGoalRow(makeGoalId("user", "g"), sanitizeGoalWrite({ title: "Review", cadence: "every week", keyResults: [] }), { sub: "owner-1" } as ActorContext, "2026-01-01T00:00:00Z");
  const due: Goal = { ...base, id: "due", nextCheckInAt: "2026-01-01" };
  const notified: Array<{ sub: string | undefined; title: string }> = [];
  const rescheduled: string[] = [];
  const fired = new Set<string>();
  const result = await runGoalCheckinSweep({
    goals: [due],
    nowMs: Date.parse("2026-06-01T00:00:00Z"),
    nowISO: "2026-06-01T00:00:00Z",
    isFired: (k) => fired.has(k),
    markFired: (k) => { fired.add(k); },
    notify: (n, target) => { notified.push({ sub: target.sub, title: n.title }); },
    reschedule: (g) => { rescheduled.push(g.nextCheckInAt ?? ""); },
  });
  assert.equal(result.nudged, 1);
  assert.equal(notified[0]!.sub, "owner-1");
  assert.match(notified[0]!.title, /Check-in due: Review/);
  assert.match(rescheduled[0]!, /^\d{4}-\d{2}-\d{2}$/); // rolled forward
});
