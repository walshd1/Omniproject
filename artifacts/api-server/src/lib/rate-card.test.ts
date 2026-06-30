import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashIdentity,
  resolveTitleHash,
  resolveRate,
  staffCost,
  emptyRateCard,
  emptyIdentityMap,
  type RateCard,
  type IdentityMap,
} from "./rate-card";

const SENIOR = hashIdentity("Senior Engineer");
const JUNIOR = hashIdentity("Junior Engineer");

const CARD: RateCard = {
  titles: { [SENIOR]: "Senior Engineer", [JUNIOR]: "Junior Engineer" },
  rates: {
    [SENIOR]: { delivery: { client: 150, internal: 90 }, "*": { client: 120, internal: 80 } },
    [JUNIOR]: { "*": { client: 80, internal: 50 } },
  },
};

const MAP: IdentityMap = {
  central: { [hashIdentity("alice")]: SENIOR, [hashIdentity("bob")]: JUNIOR },
  programme: { "prog-1": { [hashIdentity("bob")]: SENIOR } }, // bob is senior on this programme
  project: { "proj-9": { [hashIdentity("alice")]: JUNIOR } }, // alice graded down on this project
};

test("hashIdentity is stable, case/space-insensitive, and not the raw value", () => {
  assert.equal(hashIdentity("Alice"), hashIdentity(" alice "));
  assert.notEqual(hashIdentity("alice"), "alice");
  assert.notEqual(hashIdentity("alice"), hashIdentity("bob"));
});

test("title resolution: project override beats programme beats central", () => {
  assert.equal(resolveTitleHash(MAP, "alice"), SENIOR); // central
  assert.equal(resolveTitleHash(MAP, "bob", { programmeId: "prog-1" }), SENIOR); // programme override
  assert.equal(resolveTitleHash(MAP, "alice", { programmeId: "prog-1", projectId: "proj-9" }), JUNIOR); // project wins
  assert.equal(resolveTitleHash(MAP, "nobody"), null);
});

test("rate resolution: exact project-type+facing, then default project type, never crossing facing", () => {
  assert.equal(resolveRate(CARD, SENIOR, "delivery", "client"), 150);
  assert.equal(resolveRate(CARD, SENIOR, "delivery", "internal"), 90);
  assert.equal(resolveRate(CARD, SENIOR, "support", "client"), 120); // falls back to "*"
  assert.equal(resolveRate(CARD, JUNIOR, "delivery", "internal"), 50); // junior only has "*"
  assert.equal(resolveRate(CARD, null, "delivery", "client"), null); // unmapped role
  assert.equal(resolveRate(emptyRateCard(), SENIOR, "delivery", "client"), null);
});

test("staffCost splits client vs internal, breaks down by role, and flags unrated hours", () => {
  const items = [
    { assignee: "alice", loggedHours: 10, billable: true }, // senior client @150 = 1500
    { assignee: "alice", loggedHours: 4, billable: false }, // senior internal @90 = 360
    { assignee: "bob", loggedHours: 8, billable: true }, // junior client @80 = 640
    { assignee: "ghost", loggedHours: 5, billable: true }, // unmapped → unrated
    { assignee: "alice", loggedHours: 0, billable: true }, // zero hours → ignored
  ];
  const c = staffCost(items, CARD, MAP, "delivery");
  assert.equal(c.client, 1500 + 640);
  assert.equal(c.internal, 360);
  assert.equal(c.total, 1500 + 640 + 360);
  assert.equal(c.unratedHours, 5);
  assert.equal(c.byTitle[0]!.titleLabel, "Senior Engineer"); // highest cost first
  assert.equal(c.byTitle[0]!.cost, 1860);
});

test("staffCost honours scope overrides when costing", () => {
  // On proj-9 alice is graded JUNIOR → her client time costs at the junior rate.
  const c = staffCost([{ assignee: "alice", loggedHours: 10, billable: true }], CARD, MAP, "delivery", { projectId: "proj-9" });
  assert.equal(c.client, 800); // 10 × junior "*" client 80
});

test("empty inputs cost nothing", () => {
  const c = staffCost([], emptyRateCard(), emptyIdentityMap(), "*");
  assert.deepEqual([c.total, c.unratedHours, c.byTitle.length], [0, 0, 0]);
});
