import { test } from "node:test";
import assert from "node:assert/strict";
import { planMyDay, type PlanTask } from "./plan-my-day";

// All times are literal epoch-ms (no Date/clock). DAY0 is an arbitrary UTC-day-aligned epoch; NOW is noon
// of that day, so the engine's day floor is exactly DAY0.
const DAY = 86_400_000;
const DAY0 = 20_000 * DAY; // day-aligned epoch
const NOON = DAY / 2;
const NOW = DAY0 + NOON;
/** A timestamp `dayOffset` days from DAY0, `msIntoDay` into that day (default noon). */
const at = (dayOffset: number, msIntoDay: number = NOON): number => DAY0 + dayOffset * DAY + msIntoDay;

const t = (id: string, extra: Partial<PlanTask> = {}): PlanTask => ({ id, status: "next", ...extra });

test("selects overdue, due-today, flagged and high-priority open tasks; ignores the rest", () => {
  const tasks = [
    t("overdue", { dueDate: at(-3) }),
    t("today", { dueDate: at(0) }),
    t("flagged", { flagged: true }),
    t("high", { priority: "high" }),
    t("urgent", { priority: "urgent" }),
    t("future-low", { dueDate: at(5), priority: "low" }), // not due, not flagged, not high ⇒ excluded
  ];
  const { plan, excluded, summary } = planMyDay(tasks, { now: NOW });
  const ids = plan.map((p) => p.id);
  assert.deepEqual([...ids].sort(), ["flagged", "high", "overdue", "today", "urgent"]);
  assert.equal(summary.picked, 5);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueToday, 1);
  assert.ok(excluded.some((e) => e.id === "future-low" && e.reason === "not due or flagged"));
});

test("ranks worst-first: most-overdue, then due-today, then priority, then id", () => {
  const tasks = [
    t("z-high", { priority: "high" }),
    t("a-high", { priority: "high" }),
    t("today", { dueDate: at(0) }),
    t("od1", { dueDate: at(-1) }),
    t("od5", { dueDate: at(-5) }),
    t("urgent", { priority: "urgent" }),
  ];
  const plan = planMyDay(tasks, { now: NOW }).plan;
  // overdue (5d then 1d) → due-today → priority-only by rank desc (urgent>high) then id (a-high<z-high).
  assert.deepEqual(plan.map((p) => p.id), ["od5", "od1", "today", "urgent", "a-high", "z-high"]);
  assert.equal(plan[0]!.reason, "overdue 5d");
  assert.equal(plan[1]!.reason, "overdue 1d");
  assert.equal(plan[2]!.reason, "due today");
  assert.equal(plan[3]!.reason, "high priority");
});

test("overdue days count whole calendar days regardless of time-of-day", () => {
  // due late "yesterday" (23:00), now early "today" (01:00) ⇒ still a full 1 day overdue by calendar.
  const now = DAY0 + 1 * 3_600_000; // 01:00
  const plan = planMyDay([t("a", { dueDate: DAY0 - 1 * 3_600_000 })], { now }).plan; // 23:00 the day before
  assert.equal(plan[0]!.overdueDays, 1);
  assert.equal(plan[0]!.reason, "overdue 1d");
});

test("maxItems caps the plan; the overflow is excluded 'over daily limit'", () => {
  const tasks = [t("od3", { dueDate: at(-3) }), t("od2", { dueDate: at(-2) }), t("od1", { dueDate: at(-1) })];
  const { plan, excluded } = planMyDay(tasks, { now: NOW, maxItems: 2 });
  assert.deepEqual(plan.map((p) => p.id), ["od3", "od2"]);
  assert.ok(excluded.some((e) => e.id === "od1" && e.reason === "over daily limit"));
});

test("capacityHours caps by running estimate sum but keeps scanning for a task that still fits", () => {
  const tasks = [
    t("big", { dueDate: at(-3), estimateHours: 5 }),
    t("huge", { dueDate: at(-2), estimateHours: 4 }), // would blow the remaining 3h ⇒ skipped, keep scanning
    t("small", { dueDate: at(-1), estimateHours: 2 }), // still fits into the remaining 3h
  ];
  const { plan, excluded, summary } = planMyDay(tasks, { now: NOW, capacityHours: 8 });
  assert.deepEqual(plan.map((p) => p.id), ["big", "small"]);
  assert.equal(summary.totalEstimateHours, 7);
  assert.ok(excluded.some((e) => e.id === "huge" && e.reason === "over capacity"));
});

test("energyBudget caps by running energy ordinal sum", () => {
  const tasks = [
    t("a", { dueDate: at(-3), energy: "high" }), // ordinal 3
    t("b", { dueDate: at(-2), energy: "high" }), // ordinal 3 ⇒ would exceed budget 4
    t("c", { dueDate: at(-1), energy: "low" }), // ordinal 1 ⇒ fits (3+1=4)
  ];
  const { plan, excluded } = planMyDay(tasks, { now: NOW, energyBudget: 4 });
  assert.deepEqual(plan.map((p) => p.id), ["a", "c"]);
  assert.ok(excluded.some((e) => e.id === "b" && e.reason === "over energy budget"));
});

test("closed tasks are excluded, never planned", () => {
  const tasks = [t("done", { status: "done", dueDate: at(-3) }), t("dropped", { status: "dropped", flagged: true }), t("open", { dueDate: at(-1) })];
  const { plan, excluded } = planMyDay(tasks, { now: NOW });
  assert.deepEqual(plan.map((p) => p.id), ["open"]);
  assert.ok(excluded.some((e) => e.id === "done" && e.reason === "closed"));
  assert.ok(excluded.some((e) => e.id === "dropped" && e.reason === "closed"));
});

test("a custom priorityRank overrides the default ladder", () => {
  // Make 'p1' the high band; default ranks would never pick a bare 'p1'.
  const tasks = [t("a", { priority: "p1" }), t("b", { priority: "p0" })];
  const { plan } = planMyDay(tasks, { now: NOW, priorityRank: { p0: 1, p1: 5, high: 3 } });
  assert.deepEqual(plan.map((p) => p.id), ["a"]);
  assert.equal(plan[0]!.reason, "high priority");
});

test("empty in ⇒ empty out", () => {
  const r = planMyDay([], { now: NOW });
  assert.deepEqual(r.plan, []);
  assert.deepEqual(r.excluded, []);
  assert.deepEqual(r.summary, { picked: 0, overdue: 0, dueToday: 0, highPriority: 0, flagged: 0, totalEstimateHours: 0 });
});

test("malformed input is tolerated: non-objects dropped, ids coerced, dirty fields never throw", () => {
  const dirty = [
    null,
    undefined,
    42,
    "nope",
    { id: 7, dueDate: at(-1) }, // numeric id ⇒ coerced to "7"
    { id: "  ", flagged: true }, // blank id ⇒ dropped
    { id: "bad-due", dueDate: "not-a-date", flagged: true }, // dirty due ⇒ no due signal, still flagged
    { id: "bad-est", dueDate: at(-2), estimateHours: "xyz" }, // dirty estimate ⇒ costs 0
  ] as unknown as PlanTask[];
  const { plan, summary } = planMyDay(dirty, { now: NOW, capacityHours: 100 });
  const ids = plan.map((p) => p.id);
  assert.ok(ids.includes("7"));
  assert.ok(ids.includes("bad-due"));
  assert.ok(ids.includes("bad-est"));
  assert.ok(!ids.some((id) => id.trim() === ""));
  assert.equal(summary.totalEstimateHours, 0); // dirty estimate coerced to 0
});

test("deterministic: same input ⇒ identical output across runs", () => {
  const tasks = [t("od2", { dueDate: at(-2) }), t("t", { dueDate: at(0) }), t("h", { priority: "high" }), t("f", { flagged: true })];
  const a = planMyDay(tasks, { now: NOW, maxItems: 3, capacityHours: 10 });
  const b = planMyDay(tasks, { now: NOW, maxItems: 3, capacityHours: 10 });
  assert.deepEqual(a, b);
});

test("day boundary is derived from now, not the wall clock", () => {
  const plan = planMyDay([t("a", { dueDate: NOW - DAY })], { now: NOW }).plan;
  assert.equal(plan[0]!.overdueDays, 1);
});
