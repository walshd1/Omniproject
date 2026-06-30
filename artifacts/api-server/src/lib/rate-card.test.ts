import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashIdentity,
  resolveTitleHash,
  resolveRate,
  staffCost,
  valueColumns,
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

test("staffCost splits client vs internal cost, breaks down by role, and flags unrated hours", () => {
  const items = [
    { assignee: "alice", loggedHours: 10, billable: true }, // senior client @150 = 1500
    { assignee: "alice", loggedHours: 4, billable: false }, // senior internal @90 = 360
    { assignee: "bob", loggedHours: 8, billable: true }, // junior client @80 = 640
    { assignee: "ghost", loggedHours: 5, billable: true }, // unmapped → unrated
    { assignee: "alice", loggedHours: 0, billable: true }, // zero hours → ignored
  ];
  const c = staffCost(items, CARD, MAP, "delivery"); // no uplift → charge == client cost, margin 0
  assert.equal(c.clientCost, 1500 + 640);
  assert.equal(c.internalCost, 360);
  assert.equal(c.totalCost, 1500 + 640 + 360);
  assert.equal(c.charge, 1500 + 640);
  assert.equal(c.margin, 0);
  assert.equal(c.unratedHours, 5);
  assert.equal(c.byTitle[0]!.titleLabel, "Senior Engineer"); // highest cost first
  assert.equal(c.byTitle[0]!.cost, 1860);
});

test("staffCost applies overhead + margin to client-facing time only (the second value)", () => {
  // 10h senior client @150 = 1500 cost; uplift 20% overhead + 30% margin → ×1.5 → charge 2250.
  // 4h senior internal @90 = 360 cost — never billed, so it doesn't add to charge.
  const items = [
    { assignee: "alice", loggedHours: 10, billable: true },
    { assignee: "alice", loggedHours: 4, billable: false },
  ];
  const c = staffCost(items, CARD, MAP, "delivery", { overhead: 0.2, margin: 0.3 });
  assert.equal(c.clientCost, 1500);
  assert.equal(c.internalCost, 360);
  assert.equal(c.charge, 2250); // 1500 × (1 + 0.2 + 0.3); internal time isn't billed
  assert.equal(c.margin, 2250 - 1500);
  assert.equal(c.byTitle[0]!.charge, 2250);
});

test("staffCost honours scope overrides when costing", () => {
  // On proj-9 alice is graded JUNIOR → her client time costs at the junior rate.
  const c = staffCost([{ assignee: "alice", loggedHours: 10, billable: true }], CARD, MAP, "delivery", { overhead: 0, margin: 0 }, { projectId: "proj-9" });
  assert.equal(c.clientCost, 800); // 10 × junior "*" client 80
});

test("empty inputs cost nothing", () => {
  const c = staffCost([], emptyRateCard(), emptyIdentityMap(), "*");
  assert.deepEqual([c.totalCost, c.charge, c.margin, c.unratedHours, c.byTitle.length], [0, 0, 0, 0, 0]);
});

test("valueColumns computes any number of PMO-defined columns from one roll-up", () => {
  // 10h alice client @150 → clientCost 1500, totalCost 1500; scope uplift 10% overhead + 20% margin.
  const staff = staffCost([{ assignee: "alice", loggedHours: 10, billable: true }], CARD, MAP, "delivery", { overhead: 0.1, margin: 0.2 });
  const cols = valueColumns(staff, [
    { id: "cost", label: "Cost", kind: "cost" },
    { id: "charge", label: "Standard charge", kind: "charge" }, // uses scope uplift → ×1.3 = 1950
    { id: "intra", label: "Intra-company", kind: "charge", uplift: { margin: 0, overhead: 0 } }, // own uplift → ×1 = 1500
  ], { overhead: 0.1, margin: 0.2 });
  assert.deepEqual(cols.map((c) => [c.id, c.total]), [["cost", 1500], ["charge", 1950], ["intra", 1500]]);
});
