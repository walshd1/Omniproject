import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewAccess, type GrantAssignment } from "./access-review";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000; // fixed epoch ms — no Date() anywhere
const daysAgo = (n: number) => NOW - n * DAY;

test("a recently-reviewed standard grant is current, with days-until-due", () => {
  const r = reviewAccess([{ id: "g", subjectId: "u", grantLabel: "viewer", grantedAt: daysAgo(400), lastReviewedAt: daysAgo(10) }], { now: NOW });
  const item = r.items[0]!;
  assert.equal(item.status, "current");
  assert.equal(item.maxAgeDays, 180); // standard default cadence
  assert.equal(item.dueInDays, 170);
});

test("a grant within the due window is 'due'", () => {
  const r = reviewAccess([{ id: "g", subjectId: "u", grantLabel: "viewer", grantedAt: daysAgo(400), lastReviewedAt: daysAgo(170) }], { now: NOW });
  assert.equal(r.items[0]!.status, "due"); // 170 ≥ 180−14
  assert.equal(r.items[0]!.dueInDays, 10);
});

test("a grant past its cadence is overdue", () => {
  const r = reviewAccess([{ id: "g", subjectId: "u", grantLabel: "viewer", grantedAt: daysAgo(400), lastReviewedAt: daysAgo(200) }], { now: NOW });
  assert.equal(r.items[0]!.status, "overdue");
  assert.equal(r.items[0]!.dueInDays, null);
});

test("a grant that was never reviewed is 'never-reviewed' regardless of age", () => {
  const r = reviewAccess([{ id: "g", subjectId: "u", grantLabel: "admin", grantedAt: daysAgo(5) }], { now: NOW });
  assert.equal(r.items[0]!.status, "never-reviewed");
  assert.equal(r.items[0]!.dueInDays, null);
});

test("privileged grants get a shorter cadence than standard", () => {
  const assignments: GrantAssignment[] = [
    { id: "priv", subjectId: "u", grantLabel: "admin", sensitivity: "privileged", grantedAt: daysAgo(400), lastReviewedAt: daysAgo(100) },
    { id: "std", subjectId: "u", grantLabel: "viewer", sensitivity: "standard", grantedAt: daysAgo(400), lastReviewedAt: daysAgo(100) },
  ];
  const r = reviewAccess(assignments, { now: NOW });
  assert.equal(r.items.find((i) => i.id === "priv")!.status, "overdue"); // 100 > 90
  assert.equal(r.items.find((i) => i.id === "std")!.status, "current"); // 100 < 166
});

test("worklist is worst-first: overdue (most-overdue) → never-reviewed → due; current excluded", () => {
  const assignments: GrantAssignment[] = [
    { id: "o1", subjectId: "u", grantLabel: "r", grantedAt: daysAgo(400), lastReviewedAt: daysAgo(200) },
    { id: "o2", subjectId: "u", grantLabel: "r", grantedAt: daysAgo(400), lastReviewedAt: daysAgo(300) },
    { id: "n1", subjectId: "u", grantLabel: "r", grantedAt: daysAgo(5) },
    { id: "d1", subjectId: "u", grantLabel: "r", grantedAt: daysAgo(400), lastReviewedAt: daysAgo(170) },
    { id: "c1", subjectId: "u", grantLabel: "r", grantedAt: daysAgo(400), lastReviewedAt: daysAgo(10) },
  ];
  const r = reviewAccess(assignments, { now: NOW });
  assert.deepEqual(r.worklist.map((i) => i.id), ["o2", "o1", "n1", "d1"]); // c1 (current) excluded
  assert.deepEqual(r.counts, { current: 1, due: 1, overdue: 2, "never-reviewed": 1 });
});

test("worklist batches per reviewer, with an 'unassigned' bucket, reviewer-id sorted", () => {
  const assignments: GrantAssignment[] = [
    { id: "o1", subjectId: "u", grantLabel: "r", grantedAt: daysAgo(400), lastReviewedAt: daysAgo(200), reviewerId: "r-b" },
    { id: "o2", subjectId: "u", grantLabel: "r", grantedAt: daysAgo(400), lastReviewedAt: daysAgo(300), reviewerId: "r-b" },
    { id: "n1", subjectId: "u", grantLabel: "r", grantedAt: daysAgo(5), reviewerId: "r-a" },
    { id: "d1", subjectId: "u", grantLabel: "r", grantedAt: daysAgo(400), lastReviewedAt: daysAgo(170) }, // no reviewer
  ];
  const r = reviewAccess(assignments, { now: NOW });
  assert.deepEqual(
    r.byReviewer.map((b) => [b.reviewerId, b.items.map((i) => i.id)]),
    [["r-a", ["n1"]], ["r-b", ["o2", "o1"]], ["unassigned", ["d1"]]],
  );
});

test("custom cadence overrides the defaults", () => {
  const r = reviewAccess(
    [{ id: "g", subjectId: "u", grantLabel: "viewer", sensitivity: "standard", grantedAt: daysAgo(400), lastReviewedAt: daysAgo(40) }],
    { now: NOW, maxAgeDaysBySensitivity: { standard: 30 } },
  );
  assert.equal(r.items[0]!.status, "overdue"); // 40 > custom 30
});

test("empty input ⇒ empty worklist and zero counts", () => {
  const r = reviewAccess([], { now: NOW });
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.worklist, []);
  assert.deepEqual(r.byReviewer, []);
  assert.deepEqual(r.counts, { current: 0, due: 0, overdue: 0, "never-reviewed": 0 });
});

test("dirty / future / non-finite timestamps are coerced; age clamps ≥ 0, never NaN", () => {
  const r = reviewAccess(
    [
      { id: "future", subjectId: "u", grantLabel: "r", grantedAt: daysAgo(10), lastReviewedAt: NOW + 10 * DAY }, // reviewed "in the future"
      { id: "dirty", subjectId: "u", grantLabel: "r", grantedAt: "bad" as unknown as number, lastReviewedAt: NaN as unknown as number },
    ],
    { now: NOW },
  );
  const future = r.items.find((i) => i.id === "future")!;
  assert.equal(future.ageDays, 0); // clamped, not negative
  assert.equal(future.status, "current");
  const dirty = r.items.find((i) => i.id === "dirty")!;
  assert.equal(Number.isNaN(dirty.ageDays), false); // NaN lastReviewedAt → numLoose 0, age computed, finite
});
